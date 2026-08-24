import { describe, expect, it } from "vitest";
import {
  dismissIssueCommand,
  reportIssueCommand,
  resolveIssueCommand,
} from "./operational-issues.js";

const envelope = {
  commandId: "0d1f7a3c-0b6e-4a5f-9d2c-7e8b1a2c3d4e",
  idempotencyKey: "8d7c6b5a-4f3e-42d1-9c8b-7a6f5e4d3c2b",
  origin: "HUMAN_UI",
  sourceArtifactIds: [],
} as const;

const validReport = {
  name: "report-issue",
  version: 1,
  envelope,
  payload: {
    issueId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    assetId: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
    categoryCode: "BRAKES",
    description: "Grinding noise on braking, worse when loaded.",
    safetyCritical: true,
    reportedAt: "2026-08-20T07:30:00+01:00",
  },
} as const;

describe("report-issue contract", () => {
  it("accepts a valid safety-critical report", () => {
    const parsed = reportIssueCommand.parse(validReport);
    expect(parsed.payload.safetyCritical).toBe(true);
    expect(parsed.payload.categoryCode).toBe("BRAKES");
  });

  it("defaults safetyCritical to false when omitted", () => {
    const { safetyCritical: _dropped, ...payload } = validReport.payload;
    const parsed = reportIssueCommand.parse({ ...validReport, payload });
    expect(parsed.payload.safetyCritical).toBe(false);
  });

  it("accepts a minimal report without description or timestamp", () => {
    const command = {
      ...validReport,
      payload: {
        issueId: validReport.payload.issueId,
        assetId: validReport.payload.assetId,
        categoryCode: "MECHANICAL",
      },
    };

    expect(reportIssueCommand.safeParse(command).success).toBe(true);
  });

  it("rejects a missing assetId", () => {
    const { assetId: _dropped, ...payload } = validReport.payload;

    expect(reportIssueCommand.safeParse({ ...validReport, payload }).success).toBe(false);
  });

  it("rejects an empty categoryCode", () => {
    const command = {
      ...validReport,
      payload: { ...validReport.payload, categoryCode: "" },
    };

    expect(reportIssueCommand.safeParse(command).success).toBe(false);
  });

  it("rejects a reportedAt without an offset", () => {
    const command = {
      ...validReport,
      payload: { ...validReport.payload, reportedAt: "2026-08-20T07:30:00" },
    };

    expect(reportIssueCommand.safeParse(command).success).toBe(false);
  });
});

describe("resolve-issue contract", () => {
  const validResolve = {
    name: "resolve-issue",
    version: 1,
    envelope,
    payload: {
      issueId: validReport.payload.issueId,
      note: "Tightened on the spot.",
    },
  } as const;

  it("accepts a valid command with an optional note", () => {
    expect(resolveIssueCommand.parse(validResolve).payload.note).toBe(
      "Tightened on the spot.",
    );
  });

  it("rejects an empty note", () => {
    const command = {
      ...validResolve,
      payload: { ...validResolve.payload, note: "" },
    };

    expect(resolveIssueCommand.safeParse(command).success).toBe(false);
  });
});

describe("dismiss-issue contract", () => {
  const validDismiss = {
    name: "dismiss-issue",
    version: 1,
    envelope,
    payload: {
      issueId: validReport.payload.issueId,
      reason: "Duplicate of an earlier report.",
    },
  } as const;

  it("accepts a valid command", () => {
    expect(dismissIssueCommand.parse(validDismiss).payload.reason).toBe(
      "Duplicate of an earlier report.",
    );
  });

  it("rejects a missing reason — dismissal always says why", () => {
    const command = {
      ...validDismiss,
      payload: { issueId: validDismiss.payload.issueId },
    };

    expect(dismissIssueCommand.safeParse(command).success).toBe(false);
  });
});
