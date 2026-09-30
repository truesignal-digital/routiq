import { describe, expect, it } from "vitest";
import { COMMAND_QUEUEABILITY, isQueueable } from "./queueability.js";
import { cancelWorkOrderPayload } from "./cancel-work-order.js";
import { dismissIssueCommand, dismissIssuePayload } from "./dismiss-issue.js";
import { releaseAssetToServicePayload } from "./release-asset-to-service.js";
import {
  rejectWorkOrderCompletionCommand,
  rejectWorkOrderCompletionPayload,
} from "./reject-work-order-completion.js";
import { rejectWorkOrderCommand, rejectWorkOrderPayload } from "./reject-work-order.js";
import { resolveIssueCommand } from "./resolve-issue.js";

const envelope = {
  commandId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  idempotencyKey: "decision-001",
  origin: "HUMAN_UI" as const,
  expectedVersion: 1,
  sourceArtifactIds: [],
};
const issueId = "550e8400-e29b-41d4-a716-446655440000";
const workOrderId = "550e8400-e29b-41d4-a716-446655440001";

describe("resolveIssueCommand", () => {
  const valid = {
    name: "resolve-issue",
    version: 1,
    envelope,
    payload: { issueId },
  };

  it("accepts a resolution with no note — fixed on the spot needs no essay", () => {
    expect(resolveIssueCommand.parse(valid).payload.issueId).toBe(issueId);
  });

  it("accepts an optional note", () => {
    expect(
      resolveIssueCommand.parse({
        ...valid,
        payload: { issueId, note: "Collier resserré" },
      }).payload.note,
    ).toBe("Collier resserré");
  });

  it("rejects an empty or oversized note", () => {
    for (const note of ["", "x".repeat(501)]) {
      expect(
        resolveIssueCommand.safeParse({ ...valid, payload: { issueId, note } }).success,
      ).toBe(false);
    }
  });

  it("rejects an invalid issueId", () => {
    expect(
      resolveIssueCommand.safeParse({ ...valid, payload: { issueId: "nope" } }).success,
    ).toBe(false);
  });
});

describe("dismissIssueCommand", () => {
  const valid = {
    name: "dismiss-issue",
    version: 1,
    envelope,
    payload: { issueId, reason: "Signalé par erreur" },
  };

  it("accepts a dismissal with its reason", () => {
    expect(dismissIssueCommand.parse(valid).payload.reason).toBe("Signalé par erreur");
  });

  it("requires the reason — overruling a report has to say why", () => {
    expect(
      dismissIssueCommand.safeParse({ ...valid, payload: { issueId } }).success,
    ).toBe(false);
    expect(
      dismissIssueCommand.safeParse({ ...valid, payload: { issueId, reason: "" } })
        .success,
    ).toBe(false);
  });
});

describe("work-order refusals", () => {
  for (const [name, schema] of [
    ["reject-work-order", rejectWorkOrderCommand],
    ["reject-work-order-completion", rejectWorkOrderCompletionCommand],
  ] as const) {
    it(`${name} accepts a reasoned refusal`, () => {
      expect(
        schema.parse({
          name,
          version: 1,
          envelope,
          payload: { workOrderId, reason: "Devis trop élevé" },
        }).payload.reason,
      ).toBe("Devis trop élevé");
    });

    it(`${name} requires the reason`, () => {
      expect(
        schema.safeParse({ name, version: 1, envelope, payload: { workOrderId } })
          .success,
      ).toBe(false);
    });

    it(`${name} rejects an oversized reason`, () => {
      expect(
        schema.safeParse({
          name,
          version: 1,
          envelope,
          payload: { workOrderId, reason: "x".repeat(501) },
        }).success,
      ).toBe(false);
    });
  }
});

describe("queueability of the #28 commands", () => {
  it("queues the on-the-spot fix, a fact the server cannot reject", () => {
    expect(isQueueable("resolve-issue")).toBe(true);
  });

  it("never queues a decision", () => {
    for (const name of [
      "dismiss-issue",
      "reject-work-order",
      "reject-work-order-completion",
      "approve-work-order",
      "approve-work-order-closure",
      "cancel-work-order",
      "release-asset-to-service",
    ]) {
      expect(isQueueable(name), name).toBe(false);
      expect(name in COMMAND_QUEUEABILITY, name).toBe(true);
    }
  });
});

/**
 * Review finding 8: a reason is the trail's account of why a decision went
 * against someone, so blanks that only look like text are no reason at all.
 */
describe("required reasons", () => {
  const payloads = [
    ["dismiss-issue", dismissIssuePayload, { issueId }, "reason"],
    ["reject-work-order", rejectWorkOrderPayload, { workOrderId }, "reason"],
    ["reject-work-order-completion", rejectWorkOrderCompletionPayload, { workOrderId }, "reason"],
    ["cancel-work-order", cancelWorkOrderPayload, { workOrderId }, "reason"],
    ["release-asset-to-service", releaseAssetToServicePayload, { assetId: issueId }, "overrideReason"],
  ] as const;

  for (const [name, schema, base, field] of payloads) {
    it(`${name} refuses a whitespace-only ${field} and trims a real one`, () => {
      expect(schema.safeParse({ ...base, [field]: "   \n\t " }).success).toBe(false);
      const parsed = schema.parse({ ...base, [field]: "  Doublon  " }) as Record<string, unknown>;
      expect(parsed[field]).toBe("Doublon");
    });
  }
});
