import {
  boolean,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

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
  principalType: text("principal_type", {
    enum: ["HUMAN", "AI_AGENT", "INTEGRATION"],
  }).notNull(),
  displayName: text("display_name").notNull(),
  externalSubject: text("external_subject"),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
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
    result: jsonb("result"),
    failureCode: text("failure_code"),
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
