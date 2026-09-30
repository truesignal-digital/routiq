import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

export const reportIssuePayload = z.object({
  issueId: z.uuid(),
  assetId: z.uuid(),
  description: z.string().min(1).max(500),
  safetyCritical: z.boolean(),
  category: z.string().min(1).max(80).optional(),
});

export const reportIssueCommand = z.object({
  name: z.literal("report-issue"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: reportIssuePayload,
});

export type ReportIssueCommand = z.infer<typeof reportIssueCommand>;
