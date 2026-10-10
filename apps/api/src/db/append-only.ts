/**
 * Tables the application never edits or removes rows from (§3.4, §4.1): a
 * correction is a new row, linked to the one it corrects. Keys are the Drizzle
 * exports in schema.ts.
 *
 * Three things hold this list true, so it cannot drift:
 * - guard A27 `append-only-tables` (`pnpm lint`) refuses `.update()`/`.delete()`
 *   on these tables, and raw `update`/`delete from` SQL naming them, in
 *   production code outside the sanctioned writers it lists;
 * - `db/grants.test.ts` checks the runtime role `routiq_app` holds exactly the
 *   privileges written here, and that every table it can neither update nor
 *   delete from is listed;
 * - `db/append-only.test.ts` shows the database itself refusing an edit or a
 *   delete as `routiq_app`, which covers whatever the guard cannot read (a table
 *   passed through a variable, SQL assembled at run time).
 *
 * `update` lists the only columns the runtime role may still set: the link from
 * an original to what superseded it, or the period stamp approval writes on a
 * pending entry's lines. `delete` is `never`, or the one documented path.
 *
 * Not here, deliberately: tables whose rows have a lifecycle but are never
 * deleted (financial_entries, work_orders, asset_availability_intervals,
 * operational_issues, workspace_templates), and principals, sessions and
 * workspaces, which take no UPDATE but are removed by PIN reset and seed reset.
 */
export const APPEND_ONLY_TABLES = {
  auditEvents: { update: [], delete: "never" },
  notes: { update: [], delete: "never" },
  documents: { update: [], delete: "never" },
  sourceArtifacts: { update: [], delete: "never" },
  commandSourceArtifacts: { update: [], delete: "never" },
  approvalRuleChanges: { update: [], delete: "never" },
  approvalRuleAcknowledgements: { update: [], delete: "never" },
  /** Who saw a note from Direction (#98): never withdrawn, never edited. */
  noteAcknowledgements: { update: [], delete: "never" },
  activityPeople: { update: [], delete: "never" },
  movementLegs: { update: [], delete: "never" },
  meterReadings: { update: ["superseded_by_id", "supersede_reason"], delete: "never" },
  /** A person's links to logins (#569): a link is ended, never rewritten or removed. */
  personLogins: { update: ["ended_at", "ended_by_command_id"], delete: "never" },
  /**
   * Posted lines are immutable (trigger financial_postings_immutable). A
   * pending entry's author may replace its lines (#85): the delete trigger
   * financial_postings_pending_delete refuses every other delete (0034).
   */
  financialPostings: { update: ["posting_period_id"], delete: "pending entry lines only" },
} as const satisfies Record<string, { update: readonly string[]; delete: string }>;

export type AppendOnlyTable = keyof typeof APPEND_ONLY_TABLES;
