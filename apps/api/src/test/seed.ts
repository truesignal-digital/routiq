import type { PrincipalType, Role } from "@routiq/contracts";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { hashPin } from "../auth/pin.js";
import { eq } from "drizzle-orm";
import {
  approvalRules,
  branches,
  categories,
  credentials,
  financialEntries,
  financialPostings,
  memberships,
  principals,
  workspaces,
} from "../db/schema.js";
import type { Db } from "../db/client.js";
import { defaultApprovalRules } from "../commands/approval-defaults.js";
import { presetCategories } from "../commands/category-presets.js";

export async function seedWorkspace(db: Db, slug = `ws-${randomUUID().slice(0, 8)}`) {
  const [workspace] = await db
    .insert(workspaces)
    .values({ slug, name: slug })
    .returning();
  if (!workspace) throw new Error("workspace insert returned no row");
  const [branch] = await db
    .insert(branches)
    .values({ workspaceId: workspace.id, code: "DLA", name: "Douala" })
    .returning();
  if (!branch) throw new Error("branch insert returned no row");

  // Insert preset categories for this workspace. A migration-replay suite
  // running alongside re-applies backfills (0027's ISSUE_TYPE rows) to every
  // workspace, this fresh one included, so a row may already be there.
  const categoryPresets = presetCategories(workspace.id);
  if (categoryPresets.length > 0) {
    await db.insert(categories).values(categoryPresets).onConflictDoNothing();
  }

  // Insert default approval rules for this workspace
  await db.insert(approvalRules).values(defaultApprovalRules(workspace.id));

  return { workspace, branch };
}

export async function seedMember(
  db: Db,
  opts: {
    workspaceId: string;
    role: Role;
    principalType?: PrincipalType;
    branchIds?: string[];
    allBranches?: boolean;
    username?: string;
    pin?: string;
  },
) {
  const [principal] = await db
    .insert(principals)
    .values({
      principalType: opts.principalType ?? "HUMAN",
      displayName: opts.username ?? `member-${randomUUID().slice(0, 8)}`,
    })
    .returning();
  if (!principal) throw new Error("principal insert returned no row");

  const [membership] = await db
    .insert(memberships)
    .values({
      workspaceId: opts.workspaceId,
      principalId: principal.id,
      role: opts.role,
      allBranches: opts.allBranches ?? false,
      branchIds: opts.branchIds ?? [],
    })
    .returning();
  if (!membership) throw new Error("membership insert returned no row");

  if (opts.username && opts.pin) {
    await db.insert(credentials).values({
      workspaceId: opts.workspaceId,
      principalId: principal.id,
      username: opts.username,
      pinHash: await hashPin(opts.pin),
    });
  }

  return { principal, membership };
}

export async function seedAsset(
  app: FastifyInstance,
  token: string,
  opts: {
    assetCode?: string;
    branchCode?: string;
  } = {},
): Promise<string> {
  const assetId = randomUUID();
  const response = await app.inject({
    method: "POST",
    url: "/v1/commands",
    headers: { authorization: `Bearer ${token}` },
    payload: {
      name: "register-asset",
      version: 1,
      envelope: {
        commandId: randomUUID(),
        idempotencyKey: `idem-${randomUUID()}`,
        origin: "HUMAN_UI",
      },
      payload: {
        assetId,
        assetCode: opts.assetCode ?? `TEST-ASSET-${randomUUID().slice(0, 8)}`,
        assetClassCode: "TRUCK",
        templateCode: "TRUCKING",
        branchCode: opts.branchCode ?? "DLA",
      },
    },
  });
  if (response.statusCode !== 200) {
    throw new Error(`asset seed failed: ${response.statusCode} ${response.body}`);
  }
  return assetId;
}

/**
 * Revenue naming a work order, as record-revenue could write it before #432
 * refused it. No command writes one now and postings are append-only, so the
 * row is a copy of a real revenue entry with the order on its lines, optionally
 * under another recording call.
 */
export async function plantWorkOrderRevenue(
  db: Db,
  opts: { revenueEntryId: string; workOrderId: string; createdByCommandId?: string },
): Promise<string> {
  const [entry] = await db
    .select()
    .from(financialEntries)
    .where(eq(financialEntries.id, opts.revenueEntryId));
  if (!entry || entry.direction !== "REVENUE") throw new Error("plant needs a revenue entry");
  const postings = await db
    .select()
    .from(financialPostings)
    .where(eq(financialPostings.financialEntryId, entry.id));
  const entryId = randomUUID();
  const createdByCommandId = opts.createdByCommandId ?? entry.createdByCommandId;
  await db.transaction(async (tx) => {
    await tx.insert(financialEntries).values({
      ...entry,
      id: entryId,
      entryNumber: `${entry.entryNumber}-${entryId.slice(0, 4)}`,
      createdByCommandId,
    });
    await tx.insert(financialPostings).values(
      postings.map((posting) => ({
        ...posting,
        id: randomUUID(),
        financialEntryId: entryId,
        workOrderId: opts.workOrderId,
        createdByCommandId,
      })),
    );
  });
  return entryId;
}
