import { z } from "zod";
import { workOrderStatus } from "../commands/work-orders.js";
import { listQuery, listResponse } from "./list.js";

export const issueStatuses = ["OPEN", "RESOLVED", "DISMISSED"] as const;
export const issueStatus = z.enum(issueStatuses);

const queryBoolean = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const issueCategoryRead = z.object({
  code: z.string(),
  labelFr: z.string(),
  labelEn: z.string(),
});

export const issueListSortFields = ["reportedAt", "issueNumber"] as const;

export const issueListQuery = listQuery(
  {
    status: issueStatus.optional(),
    branchId: z.uuid().optional(),
    assetId: z.uuid().optional(),
    categoryCode: z.string().min(1).optional(),
    safetyCritical: queryBoolean.optional(),
  },
  { sortFields: issueListSortFields },
);

export const issueListItem = z.object({
  id: z.uuid(),
  issueNumber: z.string(),
  category: issueCategoryRead,
  assetId: z.uuid(),
  assetCode: z.string(),
  branchId: z.uuid(),
  description: z.string().nullable(),
  safetyCritical: z.boolean(),
  status: issueStatus,
  reportedAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  dismissedReason: z.string().nullable(),
  workOrderCount: z.number().int().nonnegative(),
  /** The downtime interval THIS issue opened is still open — release pending. */
  assetUnavailable: z.boolean(),
  rowVersion: z.number().int().positive(),
});

export const issueListResponse = listResponse(issueListItem);

export const workOrderListSortFields = ["openedAt", "workOrderNumber"] as const;

export const workOrderListQuery = listQuery(
  {
    status: workOrderStatus.optional(),
    branchId: z.uuid().optional(),
    assetId: z.uuid().optional(),
    issueId: z.uuid().optional(),
  },
  { sortFields: workOrderListSortFields },
);

export const workOrderListItem = z.object({
  id: z.uuid(),
  workOrderNumber: z.string(),
  assetId: z.uuid(),
  assetCode: z.string(),
  branchId: z.uuid(),
  operationalIssueId: z.uuid().nullable(),
  description: z.string(),
  status: workOrderStatus,
  expectedCostMinor: z.number().int().nonnegative(),
  /** Live signed sum of the WO's ledger postings — derived, never stored. */
  postedCostMinor: z.number().int(),
  currency: z.string(),
  openedAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  rowVersion: z.number().int().positive(),
});

export const workOrderListResponse = listResponse(workOrderListItem);

export const workOrderCostEntryRead = z.object({
  entryId: z.uuid(),
  entryNumber: z.string(),
  categoryCode: z.string(),
  /** This entry's postings against the WO, signed — not the whole entry amount. */
  amountMinor: z.number().int(),
  status: z.enum(["SUBMITTED", "POSTED", "REJECTED", "REVERSED"]),
});

const workOrderIssueRead = z.object({
  id: z.uuid(),
  issueNumber: z.string(),
  status: issueStatus,
  safetyCritical: z.boolean(),
  description: z.string().nullable(),
});

export const workOrderDetail = workOrderListItem.extend({
  branchCode: z.string(),
  /** What the completion gate matched on; null until a completion is submitted. */
  actualCostMinor: z.number().int().nullable(),
  completionNotes: z.string().nullable(),
  resolveLinkedIssue: z.boolean().nullable(),
  rejectedReason: z.string().nullable(),
  cancelledReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** §3.4 provenance: the command that first wrote the row, shown on the record. */
  createdByCommandId: z.uuid().nullable(),
  issue: workOrderIssueRead.nullable(),
  /** The asset currently sits in an open downtime interval. */
  assetUnavailable: z.boolean(),
  costEntries: z.array(workOrderCostEntryRead),
});

export type IssueStatus = (typeof issueStatuses)[number];
export type IssueListQuery = z.infer<typeof issueListQuery>;
export type IssueListItem = z.infer<typeof issueListItem>;
export type WorkOrderListQuery = z.infer<typeof workOrderListQuery>;
export type WorkOrderListItem = z.infer<typeof workOrderListItem>;
export type WorkOrderDetail = z.infer<typeof workOrderDetail>;
