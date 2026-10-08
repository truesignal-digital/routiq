import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  clientAuthorityKeyPaths,
  commandScopeViolations,
  isClientAuthorityKey,
  isScopeTargetKey,
  scopeFieldsOf,
} from "./client-scope.js";
import { commandEnvelope } from "./envelope.js";

describe("client authority keys", () => {
  it.each([
    "workspaceId",
    "workspace_id",
    "tenantId",
    "tenant",
    "organizationId",
    "actorId",
    "actor",
    "actorPrincipalId",
    "actorRole",
    "authorizedBranchIds",
    "callerBranchScope",
    "sessionWorkspaceId",
    "currentUserId",
  ])("treats %s as the caller's own authority", (key) => {
    expect(isClientAuthorityKey(key)).toBe(true);
    expect(isScopeTargetKey(key)).toBe(false);
  });

  it.each([
    "branchId",
    "toBranchId",
    "branchCode",
    "branchScope",
    "principalId",
    "custodianMembershipId",
    "role",
    "workspace",
    "workspaceSlug",
    "newWorkspaceId",
    "targetTenantId",
  ])("treats %s as a target that must be declared", (key) => {
    expect(isClientAuthorityKey(key)).toBe(false);
    expect(isScopeTargetKey(key)).toBe(true);
  });

  it.each(["assetId", "personId", "name", "code", "active", "commandId", "currentVersion"])(
    "leaves %s alone",
    (key) => {
      expect(isClientAuthorityKey(key)).toBe(false);
      expect(isScopeTargetKey(key)).toBe(false);
    },
  );
});

describe("clientAuthorityKeyPaths", () => {
  it("finds authority keys at any depth and ignores values", () => {
    expect(
      clientAuthorityKeyPaths({
        name: "workspaceId",
        workspaceId: "w",
        crew: [{ personId: "p" }, { personId: "q", actorId: "a" }],
        customValues: { tenant_id: "t" },
      }),
    ).toEqual([["workspaceId"], ["crew", 1, "actorId"], ["customValues", "tenant_id"]]);
  });

  it("finds nothing in an ordinary command", () => {
    expect(clientAuthorityKeyPaths({ branchId: "b", name: "Douala" })).toEqual([]);
  });
});

describe("commandScopeViolations", () => {
  const branchTarget = { path: "branchId", commands: ["rename-thing.v1"], meaning: "the branch renamed" };

  it("passes declared targets and ordinary fields", () => {
    expect(
      commandScopeViolations(
        [{ command: "rename-thing.v1", schema: z.strictObject({ branchId: z.uuid(), name: z.string() }) }],
        [branchTarget],
      ),
    ).toEqual([]);
  });

  it("fails a planted top-level workspace id", () => {
    const planted = z.object({ workspaceId: z.uuid(), name: z.string() });
    expect(commandScopeViolations([{ command: "plant.v1", schema: planted }], [])).toEqual([
      `plant.v1 accepts "workspaceId", which names the caller's own workspace, identity or scope`,
    ]);
  });

  it("fails a planted actor id nested in an array, an optional object, a union and a record", () => {
    const planted = z.object({
      lines: z.array(z.object({ amount: z.number(), actorId: z.uuid() })),
      meta: z.object({ by: z.object({ actorPrincipalId: z.uuid() }) }).optional(),
      target: z.union([z.literal("ALL"), z.object({ tenantId: z.uuid() })]),
      extra: z.record(z.string(), z.object({ authorizedBranchIds: z.array(z.uuid()) })),
    });
    expect(scopeFieldsOf(planted)).toEqual([
      { path: "lines[].actorId", kind: "authority" },
      { path: "meta.by.actorPrincipalId", kind: "authority" },
      { path: "target.tenantId", kind: "authority" },
      { path: "extra{*}.authorizedBranchIds", kind: "authority" },
    ]);
    expect(commandScopeViolations([{ command: "plant.v1", schema: planted }], [])).toHaveLength(4);
  });

  it("follows recursive schemas through their refs", () => {
    type Node = { label: string; children: Node[]; workspaceId?: string | undefined };
    const node: z.ZodType<Node> = z.lazy(() =>
      z.object({ label: z.string(), children: z.array(node), workspaceId: z.uuid().optional() }),
    );
    expect(scopeFieldsOf(z.object({ root: node })).map((field) => field.kind)).toContain("authority");
  });

  it("refuses to let a declaration allow an authority field", () => {
    const planted = z.object({ workspaceId: z.uuid() });
    const violations = commandScopeViolations(
      [{ command: "plant.v1", schema: planted }],
      [{ path: "workspaceId", commands: ["plant.v1"], meaning: "the target workspace" }],
    );
    expect(violations).toContain(
      `declaration "workspaceId" names caller authority, which no declaration can allow`,
    );
    expect(violations).toContain(
      `plant.v1 accepts "workspaceId", which names the caller's own workspace, identity or scope`,
    );
  });

  it("fails an undeclared target and a declaration that matches nothing", () => {
    const schema = z.object({ toBranchId: z.uuid(), branchScope: z.literal("ALL") });
    expect(commandScopeViolations([{ command: "move.v1", schema }], [branchTarget])).toEqual([
      `move.v1 accepts "toBranchId" with no target declaration saying what it points at`,
      `move.v1 accepts "branchScope" with no target declaration saying what it points at`,
      `target declaration "rename-thing.v1:branchId" matches no registered field`,
    ]);
  });

  it("finds no scope field in the command envelope", () => {
    expect(scopeFieldsOf(commandEnvelope)).toEqual([]);
  });
});
