import {
  CATEGORY_KINDS,
  EVIDENCE_POLICIES,
  MODULE_CODES,
  NOTE_ENTITY_TYPES,
  PRINCIPAL_TYPES,
  PROFITABILITY_LAYERS,
  ROLES,
  TEMPLATE_CODES,
  type ActivityCompletenessCode,
  type CommandWarningCode,
} from "@routiq/contracts";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  date,
  index,
  integer,
  jsonb,
  doublePrecision,
  pgSchema,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export interface StoredCommandOutcomeChild {
  entityType: "financial_entry";
  id: string;
  status: string;
  warnings: CommandWarningCode[];
}

export interface StoredCommandOutcome {
  commandId: string;
  recordId: string;
  rowVersion: number;
  recordStatus?: string;
  warnings: CommandWarningCode[];
  /** Composite commands only — must survive the receipt round trip for replay. */
  children?: StoredCommandOutcomeChild[];
  idempotentReplay: boolean;
}

/**
 * M0 seed schema: tenancy + command spine only.
 * Every tenant table carries workspace_id; composite tenant FKs and RLS
 * are added in SQL migrations (M1) — drizzle-kit generates the base DDL.
 */

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  defaultCurrency: text("default_currency").notNull().default("XAF"),
  timezone: text("timezone").notNull().default("Africa/Douala"),
  defaultLocale: text("default_locale").notNull().default("fr-CM"),
  status: text("status", { enum: ["ACTIVE", "SUSPENDED", "CLOSED"] })
    .notNull()
    .default("ACTIVE"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const branches = pgTable(
  "branches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull().default("Africa/Douala"),
    active: boolean("active").notNull().default(true),
    createdByCommandId: uuid("created_by_command_id").references(() => commands.id),
    rowVersion: integer("row_version").notNull().default(1),
  },
  /**
   * Code and name both identify a branch within its workspace. The name is not
   * merely a label: the ambient-branch shell names the current lens by it (the
   * switcher, the scope line, the switch toast), so two branches called "Centre"
   * would leave a user unable to tell which agency they are scoped to.
   */
  (t) => [
    uniqueIndex("branches_ws_code_uq").on(t.workspaceId, t.code),
    uniqueIndex("branches_ws_name_uq").on(t.workspaceId, t.name),
  ],
);

export const principals = pgTable("principals", {
  id: uuid("id").primaryKey().defaultRandom(),
  principalType: text("principal_type", { enum: PRINCIPAL_TYPES }).notNull(),
  displayName: text("display_name").notNull(),
  externalSubject: text("external_subject"),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => principals.id),
    role: text("role", { enum: ROLES }).notNull(),
    allBranches: boolean("all_branches").notNull().default(false),
    branchIds: uuid("branch_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /**
     * The authorization boundary: `resolveAuthContext` refuses a deactivated
     * membership, so a revoked member cannot act even holding a live session.
     * Separate from `credentials.disabled_at` (the login boundary) because the
     * two are different doors — a principal may hold a membership without ever
     * holding a credential, and revoking access has to shut both.
     *
     * Deactivation is not deletion (§10): every historical row keeps pointing
     * at the principal.
     */
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    rowVersion: integer("row_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("memberships_ws_principal_uq").on(t.workspaceId, t.principalId)],
);

/** App-owned username/PIN credentials for field roles — no email flow (§6a guard 1). */
export const credentials = pgTable(
  "credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    principalId: uuid("principal_id")
      .notNull()
      .references(() => principals.id),
    username: text("username").notNull(),
    pinHash: text("pin_hash").notNull(),
    failedAttempts: integer("failed_attempts").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("credentials_ws_username_uq").on(t.workspaceId, t.username)],
);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  principalId: uuid("principal_id")
    .notNull()
    .references(() => principals.id),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const commands = pgTable(
  "commands",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    commandType: text("command_type").notNull(),
    commandVersion: text("command_version").notNull().default("1"),
    /**
     * PLATFORM receipts are filed under the workspace their command created and
     * are initiated by a membership-less vendor operator. The column exists so
     * both consequences stay checkable in SQL: the tenant-actor FK is skipped
     * for them (see `tenant_actor_principal_id`) and their idempotency key is
     * unique per operator instead of per workspace.
     */
    scope: text("scope", { enum: ["WORKSPACE", "PLATFORM"] })
      .notNull()
      .default("WORKSPACE"),
    origin: text("origin", {
      enum: ["HUMAN_UI", "CSV_IMPORT", "OFFLINE_SYNC", "API", "AI_AGENT"],
    }).notNull(),
    status: text("status", {
      enum: ["EXECUTED", "REJECTED", "FAILED"],
    }).notNull(),
    initiatedByPrincipalId: uuid("initiated_by_principal_id")
      .notNull()
      .references(() => principals.id),
    /**
     * REJECTED/FAILED receipts get a server-generated id (the client commandId
     * must stay reusable for the retry); the envelope's commandId lands here.
     */
    clientCommandId: uuid("client_command_id"),
    /**
     * NULL exactly for platform receipts. The composite tenant-actor FK hangs
     * off this column instead of `initiated_by_principal_id`: MATCH SIMPLE
     * skips a row with a NULL member, so "the actor is a member of the
     * workspace" stays enforced for every workspace command while a
     * membership-less vendor operator can still own a receipt.
     */
    tenantActorPrincipalId: uuid("tenant_actor_principal_id").generatedAlwaysAs(
      sql`case when scope = 'PLATFORM' then null else initiated_by_principal_id end`,
    ),
    idempotencyKey: text("idempotency_key").notNull(),
    clientOccurredAt: timestamp("client_occurred_at", { withTimezone: true }),
    payload: jsonb("payload").notNull(),
    /**
     * Digest of the payload as it arrived, before redaction. It is what decides
     * whether a reused idempotency key carries the same call again: `payload`
     * has every secret replaced by one marker, so comparing it would read two
     * PIN resets under one key as the same request. NULL on rows written before
     * this column existed, which fall back to comparing payloads.
     */
    payloadHash: text("payload_hash"),
    result: jsonb("result").$type<StoredCommandOutcome>(),
    failureCode: text("failure_code"),
    approvalOutcome: text("approval_outcome", {
      enum: ["AUTO_APPROVED", "APPROVAL_REQUIRED"],
    }),
    approvalRuleId: uuid("approval_rule_id"),
    executedAt: timestamp("executed_at", { withTimezone: true }).notNull().defaultNow(),
    /** Server time from receiving the call to finalising its receipt, before commit. Null on receipts written before 0040. */
    durationMs: integer("duration_ms"),
  },
  // Partial: only success consumes the idempotency key. REJECTED/FAILED rows
  // are a retry/debugging trail and may repeat per key.
  (t) => [
    uniqueIndex("commands_ws_idem_uq")
      .on(t.workspaceId, t.idempotencyKey)
      .where(sql`${t.status} = 'EXECUTED'`),
    // A platform command's workspace is its own output, so a replayed one would
    // land in a fresh workspace and never collide above. The operator is what
    // stays constant across the retry, so the key is unique per operator.
    uniqueIndex("commands_platform_idem_uq")
      .on(t.initiatedByPrincipalId, t.idempotencyKey)
      .where(sql`${t.status} = 'EXECUTED' and ${t.scope} = 'PLATFORM'`),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    commandId: uuid("command_id")
      .notNull()
      .references(() => commands.id),
    eventType: text("event_type").notNull(),
    actorPrincipalId: uuid("actor_principal_id")
      .notNull()
      .references(() => principals.id),
    /** Mirrors `commands.scope`: a platform command's audit trail has a non-member actor. */
    scope: text("scope", { enum: ["WORKSPACE", "PLATFORM"] })
      .notNull()
      .default("WORKSPACE"),
    tenantActorPrincipalId: uuid("tenant_actor_principal_id").generatedAlwaysAs(
      sql`case when scope = 'PLATFORM' then null else actor_principal_id end`,
    ),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    beforeState: jsonb("before_state"),
    afterState: jsonb("after_state"),
    changedFields: text("changed_fields").array(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Covers the per-record history read whole: the three equality columns, then
  // the keyset pair in the order the walk reads them. `nullsFirst` is not
  // cosmetic — it is Postgres's own default for DESC, and the plain `desc`
  // `keysetOrderBy` emits only stays sort-free against an index declared the
  // same way. (`occurred_at` is NOT NULL, so no row ever lands in that tail.)
  (t) => [
    index("audit_events_ws_entity_occurred_idx").on(
      t.workspaceId,
      t.entityType,
      t.entityId,
      t.occurredAt.desc().nullsFirst(),
      t.id,
    ),
  ],
);

export const workspaceModules = pgTable(
  "workspace_modules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    moduleCode: text("module_code", { enum: MODULE_CODES }).notNull(),
    enabled: boolean("enabled").notNull(),
    updatedByCommandId: uuid("updated_by_command_id")
      .notNull()
      .references(() => commands.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (t) => [uniqueIndex("workspace_modules_ws_module_uq").on(t.workspaceId, t.moduleCode)],
);

export const workspaceTemplates = pgTable(
  "workspace_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    presetCode: text("preset_code", { enum: TEMPLATE_CODES }).notNull(),
    enabled: boolean("enabled").notNull(),
    updatedByCommandId: uuid("updated_by_command_id")
      .notNull()
      .references(() => commands.id),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (t) => [uniqueIndex("workspace_templates_ws_preset_uq").on(t.workspaceId, t.presetCode)],
);

/** Tenant-editable approval rules (§5.2). Null filter columns are wildcards. */
export const approvalRules = pgTable("approval_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  commandType: text("command_type").notNull(),
  categoryCode: text("category_code"),
  branchId: uuid("branch_id").references(() => branches.id),
  amountMinMinor: bigint("amount_min_minor", { mode: "bigint" }),
  amountMaxMinor: bigint("amount_max_minor", { mode: "bigint" }),
  requiredRole: text("required_role", { enum: ROLES }).notNull(),
  createdByCommandId: uuid("created_by_command_id").references(() => commands.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  rowVersion: integer("row_version").notNull().default(1),
});

export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    assetCode: text("asset_code").notNull(),
    assetClassCode: text("asset_class_code").notNull(),
    templateCode: text("template_code", {
      enum: ["TRUCKING", "PASSENGER_TRANSPORT"],
    }).notNull(),
    lifecycleStatus: text("lifecycle_status", {
      enum: [
        "REGISTERED",
        "IN_SERVICE",
        "UNDER_MAINTENANCE",
        "SOLD",
        "RETIRED",
        "WRITTEN_OFF",
      ],
    })
      .notNull()
      .default("REGISTERED"),
    registrationNumber: text("registration_number"),
    chassisNumber: text("chassis_number"),
    manufacturer: text("manufacturer"),
    model: text("model"),
    modelYear: integer("model_year"),
    acquisitionDate: date("acquisition_date"),
    acquisitionAmountMinor: bigint("acquisition_amount_minor", { mode: "bigint" }),
    currency: text("currency").notNull().default("XAF"),
    customValues: jsonb("custom_values")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    templateVersion: integer("template_version").notNull().default(1),
    commissionedAt: timestamp("commissioned_at", { withTimezone: true }),
    custodianMembershipId: uuid("custodian_membership_id").references(() => memberships.id),
    rowVersion: integer("row_version").notNull().default(1),
    createdByCommandId: uuid("created_by_command_id")
      .notNull()
      .references(() => commands.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("assets_ws_code_uq").on(t.workspaceId, t.assetCode)],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    kind: text("kind", {
      enum: CATEGORY_KINDS,
    }).notNull(),
    code: text("code").notNull(),
    labelFr: text("label_fr").notNull(),
    labelEn: text("label_en").notNull(),
    /**
     * §4.2: the profitability layer lives on the category only — no second
     * classification column to disagree with it. Required (CHECK in migration)
     * for REVENUE_CATEGORY/EXPENSE_CATEGORY kinds, null for the rest.
     */
    profitabilityLayer: text("profitability_layer", {
      enum: PROFITABILITY_LAYERS,
    }),
    /** §5.4: NO_RECEIPT_EXPECTED categories become declared cash expenses — warned, never blocked. */
    evidencePolicy: text("evidence_policy", {
      enum: EVIDENCE_POLICIES,
    })
      .notNull()
      .default("RECEIPT_EXPECTED"),
    /**
     * ISSUE_TYPE only (#28): picking this kind of fault pre-checks the
     * reporter's safety-critical box. A default, never a decision — the
     * interval opens on the reporter's confirmed flag, not on this column.
     */
    defaultSafetyCritical: boolean("default_safety_critical").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdByCommandId: uuid("created_by_command_id").references(() => commands.id),
    rowVersion: integer("row_version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("categories_ws_kind_code_uq").on(t.workspaceId, t.kind, t.code)],
);

/**
 * Compliance documents (§3.1). Append-only: renewal inserts a new row whose
 * supersedes_document_id points at the original; originals are never edited and
 * supersession state is derived, not stored on the old row.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    documentTypeCode: text("document_type_code").notNull(),
    title: text("title"),
    documentNumber: text("document_number"),
    issuedAt: date("issued_at"),
    expiresAt: date("expires_at"),
    supersedesDocumentId: uuid("supersedes_document_id"),
    createdByCommandId: uuid("created_by_command_id")
      .notNull()
      .references(() => commands.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("documents_supersedes_uq").on(t.workspaceId, t.supersedesDocumentId),
    // The vehicle workspace reads a vehicle's documents for its history and
    // its expiry attention; nothing indexed them by asset before.
    index("documents_ws_asset_idx").on(t.workspaceId, t.assetId),
  ],
);

/** Immutable, hashed evidence blobs (§3.4). No update path exists by design. */
export const sourceArtifacts = pgTable("source_artifacts", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id),
  storageKey: text("storage_key").notNull().unique(),
  sha256: text("sha256").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "bigint" }).notNull(),
  originalFileName: text("original_file_name"),
  uploadedByPrincipalId: uuid("uploaded_by_principal_id")
    .notNull()
    .references(() => principals.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const commandSourceArtifacts = pgTable(
  "command_source_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    commandId: uuid("command_id")
      .notNull()
      .references(() => commands.id),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => sourceArtifacts.id),
  },
  (t) => [uniqueIndex("command_artifacts_uq").on(t.commandId, t.artifactId)],
);

/**
 * Monthly posting periods (§4.3) — the strict boundary. Auto-created OPEN by
 * the first command that posts into the month; LockPeriod is the ceremony.
 * A locked month is only reopened via ReopenPeriod (finance role + reason).
 */
export const postingPeriods = pgTable(
  "posting_periods",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    /** Calendar month in the workspace timezone, 'YYYY-MM'. */
    periodCode: text("period_code").notNull(),
    status: text("status", { enum: ["OPEN", "LOCKED"] })
      .notNull()
      .default("OPEN"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedByCommandId: uuid("locked_by_command_id").references(() => commands.id),
    rowVersion: integer("row_version").notNull().default(1),
    createdByCommandId: uuid("created_by_command_id")
      .notNull()
      .references(() => commands.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("posting_periods_ws_code_uq").on(t.workspaceId, t.periodCode)],
);

/**
 * Financial entries (§4.2) — the part that must be right. Status transitions
 * are the only edits after insert; posted amounts are corrected exclusively by
 * reversal (reverses_entry_id), never edited. DRAFT is a client-side concept:
 * the server never stores drafts.
 */
export const financialEntries = pgTable(
  "financial_entries",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    /** Human-readable `{branchCode}-{year}-{seq5}`, assigned server-side from number_counters. */
    entryNumber: text("entry_number").notNull(),
    direction: text("direction", { enum: ["REVENUE", "EXPENSE"] }).notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    /** When it economically happened — may differ from the posting period (late postings). */
    economicDate: date("economic_date").notNull(),
    /** Null until POSTED; period resolved at posting time, never at submission. */
    postingPeriodId: uuid("posting_period_id").references(() => postingPeriods.id),
    isLatePosting: boolean("is_late_posting").notNull().default(false),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    /** Counterparty entity deferred — free text at MTP. */
    counterpartyName: text("counterparty_name"),
    description: text("description"),
    /** SIGNED minor units (XAF exponent 0). Reversal entries carry the negated amount. */
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("XAF"),
    paymentMethod: text("payment_method", {
      enum: ["CASH", "MOMO", "OM", "BANK", "OTHER"],
    }).notNull(),
    /** MoMo/OM transaction refs count as evidence (§5.4). */
    paymentReference: text("payment_reference"),
    sourceReference: text("source_reference"),
    estimateStatus: text("estimate_status", { enum: ["ACTUAL", "ESTIMATED"] })
      .notNull()
      .default("ACTUAL"),
    status: text("status", {
      enum: ["SUBMITTED", "POSTED", "REJECTED", "REVERSED"],
    }).notNull(),
    rejectedReason: text("rejected_reason"),
    reversesEntryId: uuid("reverses_entry_id").references((): AnyPgColumn => financialEntries.id),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    rowVersion: integer("row_version").notNull().default(1),
    createdByCommandId: uuid("created_by_command_id")
      .notNull()
      .references(() => commands.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("financial_entries_ws_number_uq").on(t.workspaceId, t.entryNumber),
    // An entry is reversed at most once — structural backstop for ENTRY_ALREADY_REVERSED.
    uniqueIndex("financial_entries_reverses_uq").on(t.workspaceId, t.reversesEntryId),
    index("financial_entries_ws_period_idx").on(t.workspaceId, t.postingPeriodId),
  ],
);

/**
 * Signed posting lines (§4.2). Immutable after insert (UPDATE/DELETE revoked
 * from routiq_app) except the period-assignment update at approval time, done
 * via the owner path inside the command transaction — corrections are new
 * negated rows via reversal entries. Sum of a POSTED entry's postings equals
 * the entry amount (command-layer invariant). activity_id, work_order_id and
 * person_id are the attribution dimensions: what a cost was for. A posting
 * carries at most one of each, and the work-order dimension is how labour and
 * parts costs reach the chronologie of the order that incurred them.
 */
export const financialPostings = pgTable(
  "financial_postings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    financialEntryId: uuid("financial_entry_id")
      .notNull()
      .references(() => financialEntries.id),
    lineNo: integer("line_no").notNull(),
    // Indexing copies of entry fields — kept in sync by the command layer.
    economicDate: date("economic_date").notNull(),
    postingPeriodId: uuid("posting_period_id").references(() => postingPeriods.id),
    direction: text("direction", { enum: ["REVENUE", "EXPENSE"] }).notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    assetId: uuid("asset_id").references(() => assets.id),
    activityId: uuid("activity_id").references((): AnyPgColumn => activities.id),
    workOrderId: uuid("work_order_id").references((): AnyPgColumn => workOrders.id),
    personId: uuid("person_id").references((): AnyPgColumn => persons.id),
    /** SIGNED minor units: reversals subtract, sums can't double-count. */
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    assetAttribution: text("asset_attribution", { enum: ["DIRECT", "ALLOCATED"] })
      .notNull()
      .default("DIRECT"),
    activityAttribution: text("activity_attribution", { enum: ["DIRECT", "ALLOCATED"] })
      .notNull()
      .default("DIRECT"),
    createdByCommandId: uuid("created_by_command_id")
      .notNull()
      .references(() => commands.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("financial_postings_entry_line_uq").on(t.financialEntryId, t.lineNo),
    index("financial_postings_ws_asset_date_idx").on(t.workspaceId, t.assetId, t.economicDate),
    index("financial_postings_ws_period_idx").on(t.workspaceId, t.postingPeriodId),
    index("financial_postings_ws_activity_idx").on(t.workspaceId, t.activityId),
    index("financial_postings_ws_work_order_idx").on(t.workspaceId, t.workOrderId),
    index("financial_postings_ws_person_idx").on(t.workspaceId, t.personId),
  ],
);

/** Per-scope sequences for human-readable numbering (e.g. 'ENTRY:{branchId}:{year}'). */
export const numberCounters = pgTable(
  "number_counters",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    scope: text("scope").notNull(),
    nextValue: bigint("next_value", { mode: "bigint" }).notNull().default(sql`1`),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.scope] })],
);

/*
 * ---------------------------------------------------------------------------
 * Activities (§3.1, §3.2) — the unit of work connecting movements, people,
 * revenue and cost. Composite tenant FKs, RLS policies, runtime grants, the
 * carrier-overlap EXCLUDE constraint and the place-or-text CHECKs live in the
 * migration; drizzle-kit generates only the base DDL.
 * ---------------------------------------------------------------------------
 */

/**
 * Driver, conductor, mechanic, clerk. Deliberately NOT a membership: §3.1 says a
 * person may exist without a login, and most drivers never get one. Compensation
 * postings attribute money here, so rows are created by an explicit command —
 * never resolved by name, because a typo would silently split one worker's pay.
 */
export const persons = pgTable(
  "persons",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    /** Home depot. Cross-branch crewing is allowed; the activity's branch governs. */
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    displayName: text("display_name").notNull(),
    /** Operator's own staff number, if they use one. NULLs are distinct, so blanks don't collide. */
    personCode: text("person_code"),
    phone: text("phone"),
    defaultRole: text("default_role", {
      enum: ["DRIVER", "CONDUCTOR", "ASSISTANT", "RELIEF", "MECHANIC", "CLERK", "OTHER"],
    }),
    membershipId: uuid("membership_id").references(() => memberships.id),
    active: boolean("active").notNull().default(true),
    rowVersion: integer("row_version").notNull().default(1),
    createdByCommandId: uuid("created_by_command_id")
      .notNull()
      .references(() => commands.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("persons_ws_code_uq").on(t.workspaceId, t.personCode),
    index("persons_ws_branch_idx").on(t.workspaceId, t.branchId),
  ],
);

/**
 * Reusable origins/destinations (§3.1) so route profitability doesn't degrade to
 * string matching. Resolved-or-created by normalized name inside the handler —
 * no command of its own; the vocabulary grows by use. Legs keep a free-text
 * fallback for ad-hoc stops.
 */
export const places = pgTable(
  "places",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    name: text("name").notNull(),
    /** lower(trim(name)) — the resolve-or-create key, stored so the index is plain. */
    normalizedName: text("normalized_name").notNull(),
    placeType: text("place_type", {
      enum: ["CITY", "DEPOT", "CUSTOMER_SITE", "BORDER", "OTHER"],
    }),
    active: boolean("active").notNull().default(true),
    rowVersion: integer("row_version").notNull().default(1),
    createdByCommandId: uuid("created_by_command_id")
      .notNull()
      .references(() => commands.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("places_ws_normalized_uq").on(t.workspaceId, t.normalizedName)],
);

/**
 * A haulage job, scheduled journey, charter, or plant hire. Closing warns rather
 * than blocks (§3.4 inv. 6): `completeness_codes` records what was missing, using
 * the same vocabulary the command returns as warnings.
 */
export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    branchId: uuid("branch_id")
      .notNull()
      .references(() => branches.id),
    activityNumber: text("activity_number").notNull(),
    /** categories.kind = 'ACTIVITY_TYPE'. */
    activityTypeId: uuid("activity_type_id")
      .notNull()
      .references(() => categories.id),
    templateCode: text("template_code", {
      enum: ["TRUCKING", "PASSENGER_TRANSPORT"],
    }).notNull(),
    templateVersion: integer("template_version").notNull().default(1),
    customValues: jsonb("custom_values")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    status: text("status", { enum: ["OPEN", "CLOSED"] })
      .notNull()
      .default("OPEN"),
    /** NULL while OPEN; set once by close. */
    completeness: text("completeness", {
      enum: ["COMPLETE", "COMPLETE_WITH_EXCEPTIONS"],
    }),
    completenessCodes: text("completeness_codes")
      .array()
      .$type<ActivityCompletenessCode[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Party entity deferred, same precedent as financial_entries.counterparty_name. */
    customerName: text("customer_name"),
    /** The number written on the paper waybill, when it differs from ours (§6). */
    clientReference: text("client_reference"),
    description: text("description"),
    plannedStartAt: timestamp("planned_start_at", { withTimezone: true }),
    plannedEndAt: timestamp("planned_end_at", { withTimezone: true }),
    /** Actual dates — the only completeness hard-block besides having a segment. */
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedByCommandId: uuid("closed_by_command_id").references(() => commands.id),
    rowVersion: integer("row_version").notNull().default(1),
    createdByCommandId: uuid("created_by_command_id")
      .notNull()
      .references(() => commands.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("activities_ws_number_uq").on(t.workspaceId, t.activityNumber),
    index("activities_ws_branch_started_idx").on(t.workspaceId, t.branchId, t.startedAt),
    index("activities_ws_status_idx").on(t.workspaceId, t.status),
  ],
);

/**
 * Which asset carried the activity, and when. PRIMARY and SUBSTITUTE are both
 * carrier roles and cannot overlap in time — enforced by an EXCLUDE USING gist
 * constraint in the migration, not by handler discipline. TRAILER and RECOVERY
 * are concurrent by design and sit outside that predicate.
 */
export const activityAssetSegments = pgTable(
  "activity_asset_segments",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    role: text("role", {
      enum: ["PRIMARY", "TRAILER", "SUBSTITUTE", "RECOVERY"],
    }).notNull(),
    /** Set on the incoming segment of a handover, so "was there a substitution?" is one column. */
    substitutesSegmentId: uuid("substitutes_segment_id").references(
      (): AnyPgColumn => activityAssetSegments.id,
    ),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    /** NULL = still running, and an unbounded range blocks any second carrier. */
    endedAt: timestamp("ended_at", { withTimezone: true }),
    startReadingId: uuid("start_reading_id").references((): AnyPgColumn => meterReadings.id),
    endReadingId: uuid("end_reading_id").references((): AnyPgColumn => meterReadings.id),
    rowVersion: integer("row_version").notNull().default(1),
    createdByCommandId: uuid("created_by_command_id")
      .notNull()
      .references(() => commands.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activity_segments_ws_activity_idx").on(t.workspaceId, t.activityId),
    index("activity_segments_ws_asset_started_idx").on(t.workspaceId, t.assetId, t.startedAt),
  ],
);

/** Crew participation (§3.1). The hook compensation postings hang off. */
export const activityPeople = pgTable(
  "activity_people",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id),
    personId: uuid("person_id")
      .notNull()
      .references(() => persons.id),
    role: text("role", {
      enum: ["DRIVER", "CONDUCTOR", "ASSISTANT", "RELIEF", "MECHANIC", "OTHER"],
    }).notNull(),
    createdByCommandId: uuid("created_by_command_id")
      .notNull()
      .references(() => commands.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("activity_people_activity_person_role_uq").on(
      t.activityId,
      t.personId,
      t.role,
    ),
    index("activity_people_ws_person_idx").on(t.workspaceId, t.personId),
  ],
);

/**
 * An ordered leg of an activity. Endpoints are a place reference OR free text —
 * a CHECK in the migration requires one of each pair (§3.1 ad-hoc stops).
 * Activities that never move (plant hire) simply have no legs; completeness
 * rules are per-template, so that is not an exception.
 */
export const movementLegs = pgTable(
  "movement_legs",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    activityId: uuid("activity_id")
      .notNull()
      .references(() => activities.id),
    /** The carrier segment that ran this leg (§3.2). */
    segmentId: uuid("segment_id").references(() => activityAssetSegments.id),
    legNo: integer("leg_no").notNull(),
    originPlaceId: uuid("origin_place_id").references(() => places.id),
    originText: text("origin_text"),
    destinationPlaceId: uuid("destination_place_id").references(() => places.id),
    destinationText: text("destination_text"),
    departedAt: timestamp("departed_at", { withTimezone: true }),
    arrivedAt: timestamp("arrived_at", { withTimezone: true }),
    /** Whole kilometres — pilot precision; odometers are read to the km. */
    distanceKm: integer("distance_km"),
    loadState: text("load_state", { enum: ["LADEN", "EMPTY", "PARTIAL"] }),
    passengerCount: integer("passenger_count"),
    customValues: jsonb("custom_values")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdByCommandId: uuid("created_by_command_id")
      .notNull()
      .references(() => commands.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("movement_legs_activity_leg_uq").on(t.activityId, t.legNo),
    index("movement_legs_ws_activity_idx").on(t.workspaceId, t.activityId),
  ],
);

/**
 * Immutable odometer/engine-hour observation (§3.1). HOURS is not an afterthought:
 * anything that works standing still — excavator, generator, mixer — measures
 * hours, and that is the meter its service intervals run on. Corrections
 * supersede, never edit; UPDATE and DELETE are revoked from the runtime role.
 */
export const meterReadings = pgTable(
  "meter_readings",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    readingType: text("reading_type", { enum: ["ODOMETER", "HOURS"] }).notNull(),
    /** Kilometres or whole engine-hours, per readingType. */
    value: bigint("value", { mode: "bigint" }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    source: text("source", {
      enum: ["ACTIVITY_START", "ACTIVITY_END", "SUBSTITUTION", "MANUAL", "WORK_ORDER"],
    }).notNull(),
    activityId: uuid("activity_id").references(() => activities.id),
    supersededById: uuid("superseded_by_id").references((): AnyPgColumn => meterReadings.id),
    supersedeReason: text("supersede_reason"),
    createdByCommandId: uuid("created_by_command_id")
      .notNull()
      .references(() => commands.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("meter_readings_ws_asset_observed_idx").on(t.workspaceId, t.assetId, t.observedAt),
    uniqueIndex("meter_readings_superseded_uq").on(t.supersededById),
  ],
);

/**
 * Operational issue (Signalement): captures the initial report of a problem
 * with an asset. An issue is created offline (queueable) and may spawn one or
 * more work orders. State is derived from work orders and availability intervals,
 * never stored. Status column intentionally absent — the issue lifecycle is
 * implicit in its work orders and release-to-service decision.
 */
export const operationalIssues = pgTable(
  "operational_issues",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    description: text("description").notNull(),
    safetyCritical: boolean("safety_critical").notNull(),
    category: text("category"),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull(),
    /**
     * OPEN → RESOLVED | DISMISSED, once (#28). No triage state: what happens
     * next — a work order, a dismissal, nothing yet — is an attribute of the
     * issue's surroundings, not a status. The report columns above never move.
     */
    status: text("status", { enum: ["OPEN", "RESOLVED", "DISMISSED"] })
      .notNull()
      .default("OPEN"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    dismissReason: text("dismiss_reason"),
    createdByCommandId: uuid("created_by_command_id")
      .notNull()
      .references(() => commands.id),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (t) => [
    index("operational_issues_ws_asset_idx").on(t.workspaceId, t.assetId),
  ],
);

/**
 * Maintenance work order (Ordre de travail): planned work to address an issue
 * or preventive maintenance. The owner's state machine (#28): creation lands
 * APPROVED (auto band) or SUBMITTED; SUBMITTED → APPROVED | REJECTED; APPROVED
 * is open work and the only state costs attach to; completion lands COMPLETED
 * or COMPLETION_SUBMITTED, whose rejection returns to APPROVED; CANCELLED from
 * any non-terminal state. COMPLETED, REJECTED and CANCELLED never reopen. An
 * issue may spawn multiple work orders; cancellation does not delete — it
 * records a reason and opens the door for a new order on the same issue.
 * Composite tenant FKs put the work order, its asset and its linked issue in one
 * workspace; that the issue names the same asset is a handler check, not a
 * structural one.
 */
export const workOrders = pgTable(
  "work_orders",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    issueId: uuid("issue_id").references((): AnyPgColumn => operationalIssues.id),
    description: text("description").notNull(),
    /**
     * Plain `text` with no CHECK, as Drizzle emits it; the value set is held by
     * the handlers. 0027 renamed the pre-#28 values in place.
     */
    status: text("status", {
      enum: [
        "SUBMITTED",
        "APPROVED",
        "COMPLETION_SUBMITTED",
        "COMPLETED",
        "REJECTED",
        "CANCELLED",
      ],
    })
      .notNull()
      .default("APPROVED"),
    expectedCostMinor: bigint("expected_cost_minor", { mode: "bigint" }),
    currency: char("currency", { length: 3 }).notNull().default("XAF"),
    /**
     * The amount a complete-work-order v1 close typed (#81). The closer's
     * declaration only: it never reached the books, and the order's actual cost
     * is derived from its cost lines on read. NULL for every v2 close.
     */
    declaredCostMinor: bigint("declared_cost_minor", { mode: "bigint" }),
    /**
     * What the closer said about the cost at completion: LINES, NO_COST or
     * INVOICE_PENDING. Plain `text` like `status`; the value set is held by
     * the contract. NULL before completion and for v1 closes.
     */
    costOutcome: text("cost_outcome", { enum: ["LINES", "NO_COST", "INVOICE_PENDING"] }),
    summary: text("summary"),
    /**
     * The completion's resolve-the-issue flag, held with the other completion
     * facts while COMPLETION_SUBMITTED waits for review, and acted on when the
     * completion is approved.
     */
    resolveLinkedIssue: boolean("resolve_linked_issue").notNull().default(false),
    cancelReason: text("cancel_reason"),
    rejectReason: text("reject_reason"),
    /** The last completion sent back; the workshop reads it before resubmitting. */
    completionRejectReason: text("completion_reject_reason"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    createdByCommandId: uuid("created_by_command_id")
      .notNull()
      .references(() => commands.id),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (t) => [
    index("work_orders_ws_asset_idx").on(t.workspaceId, t.assetId),
    index("work_orders_ws_status_idx").on(t.workspaceId, t.status),
  ],
);

/**
 * Asset availability interval: tracks when an asset transitions to UNAVAILABLE
 * due to safety-critical issues and when it is released back to service.
 * At most one open interval per (workspace_id, asset_id) enforced via PARTIAL
 * UNIQUE constraint. An asset is implicitly AVAILABLE unless it holds an open
 * interval; this separation from lifecycle_status is deliberate (§3 invariants).
 * closed_by_command_id is the release-asset-to-service decision, which requires
 * approval; created_by_command_id tracks the opener (usually report-issue).
 */
export const assetAvailabilityIntervals = pgTable(
  "asset_availability_intervals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => assets.id),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    openedByIssueId: uuid("opened_by_issue_id")
      .notNull()
      .references((): AnyPgColumn => operationalIssues.id),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedByCommandId: uuid("closed_by_command_id").references(() => commands.id),
    createdByCommandId: uuid("created_by_command_id")
      .notNull()
      .references(() => commands.id),
    rowVersion: integer("row_version").notNull().default(1),
  },
  (t) => [
    index("asset_availability_intervals_ws_asset_idx").on(t.workspaceId, t.assetId),
    uniqueIndex("asset_availability_intervals_open_per_asset_uq")
      .on(t.workspaceId, t.assetId)
      .where(sql`${t.closedAt} IS NULL`),
  ],
);

/**
 * A free-text annotation on a record (§3.1). Append-only: UPDATE and DELETE are
 * not granted, so a correction is another note. v1 annotates assets only, and
 * `asset_id` is the exclusive arc the composite tenant FK hangs off — a CHECK
 * in the migration ties it to `entity_id` — so a note can never point into
 * another workspace. `author_membership_id` is the member who wrote it.
 */
export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    entityType: text("entity_type", { enum: NOTE_ENTITY_TYPES }).notNull(),
    entityId: uuid("entity_id").notNull(),
    assetId: uuid("asset_id").references(() => assets.id),
    authorMembershipId: uuid("author_membership_id")
      .notNull()
      .references(() => memberships.id),
    body: text("body").notNull(),
    createdByCommandId: uuid("created_by_command_id")
      .notNull()
      .references(() => commands.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("notes_ws_entity_created_idx").on(t.workspaceId, t.entityType, t.entityId, t.createdAt),
  ],
);

/**
 * A change to the entry approval chain that members must be told about (#422).
 * Written by `update-approval-threshold` beside its audit event, and once per
 * workspace by migration 0039 for the release that changed the chain (0038):
 * a migration cannot write a command receipt or an audit event, so that row
 * carries no `created_by_command_id` and names no member. Append-only.
 * `affected_roles` are the roles whose own entries the change moved.
 */
export const approvalRuleChanges = pgTable(
  "approval_rule_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    affectedRoles: text("affected_roles", { enum: ROLES }).array().notNull(),
    createdByCommandId: uuid("created_by_command_id").references(() => commands.id),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("approval_rule_changes_ws_id_uq").on(t.workspaceId, t.id),
    index("approval_rule_changes_ws_changed_idx").on(t.workspaceId, t.changedAt),
  ],
);

/**
 * A member's acknowledgement of one approval-rule change, written by
 * `acknowledge-approval-rules`. Append-only; one per member and change.
 */
export const approvalRuleAcknowledgements = pgTable(
  "approval_rule_acknowledgements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id),
    changeId: uuid("change_id")
      .notNull()
      .references(() => approvalRuleChanges.id),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id),
    createdByCommandId: uuid("created_by_command_id")
      .notNull()
      .references(() => commands.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("approval_rule_acknowledgements_ws_member_change_uq").on(
      t.workspaceId,
      t.membershipId,
      t.changeId,
    ),
  ],
);

/**
 * Field telemetry from the web app (ADR-0011). Its own schema because it is
 * measurement, not business state: no command writes it, no read serves it to
 * a tenant, and the runtime role may only INSERT (plus DELETE of expired rows,
 * which needs SELECT on `received_at` alone). Operators read it with the owner
 * role through `pnpm observe`.
 */
export const telemetry = pgSchema("telemetry");

export const telemetryEvents = telemetry.table(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    /** From the session that sent it; null before sign-in. Goes with its workspace. */
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    /** The sender's role, never who they are. */
    role: text("role"),
    sessionId: uuid("session_id").notNull(),
    kind: text("kind", { enum: ["session", "error", "vital", "journey"] }).notNull(),
    /** Journey or vital name, or the error's source. */
    name: text("name"),
    /** Journey duration (ms) or vital value. */
    value: doublePrecision("value"),
    serverMs: doublePrecision("server_ms"),
    outcome: text("outcome"),
    route: text("route").notNull(),
    appVersion: text("app_version").notNull(),
    message: text("message"),
    stack: text("stack"),
    /** Groups the same error across sessions: hash of the message shape and first app frame. */
    fingerprint: text("fingerprint"),
    device: jsonb("device"),
    detail: jsonb("detail"),
  },
  (t) => [
    index("telemetry_events_received_idx").on(t.receivedAt),
    index("telemetry_events_kind_name_idx").on(t.kind, t.name, t.receivedAt),
  ],
);
