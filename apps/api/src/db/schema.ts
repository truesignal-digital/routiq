import { MODULE_CODES, PRINCIPAL_TYPES, ROLES } from "@asset/contracts";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export interface StoredCommandOutcome {
  commandId: string;
  recordId: string;
  rowVersion: number;
  warnings: string[];
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
  },
  (t) => [uniqueIndex("branches_ws_code_uq").on(t.workspaceId, t.code)],
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
    origin: text("origin", {
      enum: ["HUMAN_UI", "CSV_IMPORT", "OFFLINE_SYNC", "API", "AI_AGENT"],
    }).notNull(),
    status: text("status", {
      enum: ["EXECUTED", "REJECTED", "FAILED"],
    }).notNull(),
    initiatedByPrincipalId: uuid("initiated_by_principal_id")
      .notNull()
      .references(() => principals.id),
    idempotencyKey: text("idempotency_key").notNull(),
    clientOccurredAt: timestamp("client_occurred_at", { withTimezone: true }),
    payload: jsonb("payload").notNull(),
    result: jsonb("result").$type<StoredCommandOutcome>(),
    failureCode: text("failure_code"),
    approvalOutcome: text("approval_outcome", {
      enum: ["AUTO_APPROVED", "APPROVAL_REQUIRED"],
    }),
    approvalRuleId: uuid("approval_rule_id"),
    executedAt: timestamp("executed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("commands_ws_idem_uq").on(t.workspaceId, t.idempotencyKey)],
);

export const auditEvents = pgTable("audit_events", {
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
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  beforeState: jsonb("before_state"),
  afterState: jsonb("after_state"),
  changedFields: text("changed_fields").array(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
});

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
    rowVersion: integer("row_version").notNull().default(1),
    createdByCommandId: uuid("created_by_command_id")
      .notNull()
      .references(() => commands.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("assets_ws_code_uq").on(t.workspaceId, t.assetCode)],
);
