import {
  createCategoryPayload,
  deactivateCategoryPayload,
  reactivateCategoryPayload,
  relabelCategoryPayload,
  type CreateCategoryPayload,
  type DeactivateCategoryPayload,
  type RelabelCategoryPayload,
} from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { categories } from "../db/schema.js";
import {
  appendAuditEvent,
  checkOptimisticVersion,
  CommandError,
  registerCommand,
  type CommandContext,
  type CommandDefinition,
  type Tx,
} from "./dispatcher.js";

type CategoryRow = typeof categories.$inferSelect;

const FULL_FIELDS = [
  "id",
  "workspaceId",
  "kind",
  "code",
  "labelFr",
  "labelEn",
  "profitabilityLayer",
  "evidencePolicy",
  "defaultSafetyCritical",
  "active",
  "createdByCommandId",
  "rowVersion",
];

/** §4.2, mirrored by `categories_profitability_layer_ck`. */
const FINANCIAL_KINDS = ["REVENUE_CATEGORY", "EXPENSE_CATEGORY"] as const;

function isFinancialKind(kind: CategoryRow["kind"]): boolean {
  return (FINANCIAL_KINDS as readonly string[]).includes(kind);
}

async function requireCategory(
  tx: Tx,
  ctx: CommandContext,
  categoryId: string,
): Promise<CategoryRow> {
  const [row] = await tx
    .select()
    .from(categories)
    .where(and(eq(categories.workspaceId, ctx.workspaceId), eq(categories.id, categoryId)))
    .limit(1);
  if (!row) {
    throw new CommandError(422, "REFERENCE_NOT_FOUND", {
      referenceType: "category",
      referenceId: categoryId,
    });
  }
  return row;
}

function categoryState(row: CategoryRow): Record<string, unknown> {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    kind: row.kind,
    code: row.code,
    labelFr: row.labelFr,
    labelEn: row.labelEn,
    profitabilityLayer: row.profitabilityLayer,
    evidencePolicy: row.evidencePolicy,
    defaultSafetyCritical: row.defaultSafetyCritical,
    active: row.active,
    createdByCommandId: row.createdByCommandId,
    rowVersion: row.rowVersion,
  };
}

const createCategory: CommandDefinition<CreateCategoryPayload> = {
  name: "create-category",
  version: 1,
  module: "CORE",
  allowedRoles: ["DIRECTOR"],
  payloadSchema: createCategoryPayload,
  branchAuthorization: { kind: "workspace" },

  async execute(tx, ctx, envelope, payload) {
    // §4.2 as a business rule rather than a 500 from the CHECK constraint: a
    // financial category without a layer would silently fall out of every
    // profitability report, and a layer on a document type means nothing.
    if (isFinancialKind(payload.kind) !== (payload.profitabilityLayer !== undefined)) {
      throw new CommandError(422, "CATEGORY_LAYER_INVALID", {
        kind: payload.kind,
        profitabilityLayer: payload.profitabilityLayer ?? null,
      });
    }

    // A safety-critical default only means something where a reporter picks a
    // fault type; on any other kind it would be a flag nothing ever reads.
    if (payload.defaultSafetyCritical !== undefined && payload.kind !== "ISSUE_TYPE") {
      throw new CommandError(400, "VALIDATION_FAILED", {
        issues: [{ code: "custom", path: ["defaultSafetyCritical"] }],
      });
    }

    // Pre-check for the readable code; the unique index stays the race backstop.
    const [duplicate] = await tx
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.workspaceId, ctx.workspaceId),
          eq(categories.kind, payload.kind),
          eq(categories.code, payload.code),
        ),
      )
      .limit(1);
    if (duplicate) {
      throw new CommandError(409, "DUPLICATE_CATEGORY_CODE", {
        kind: payload.kind,
        code: payload.code,
      });
    }

    const [row] = await tx
      .insert(categories)
      .values({
        id: payload.id,
        workspaceId: ctx.workspaceId,
        kind: payload.kind,
        code: payload.code,
        labelFr: payload.labelFr,
        labelEn: payload.labelEn,
        ...(payload.profitabilityLayer === undefined
          ? {}
          : { profitabilityLayer: payload.profitabilityLayer }),
        ...(payload.evidencePolicy === undefined
          ? {}
          : { evidencePolicy: payload.evidencePolicy }),
        ...(payload.defaultSafetyCritical === undefined
          ? {}
          : { defaultSafetyCritical: payload.defaultSafetyCritical }),
        active: true,
        createdByCommandId: envelope.commandId,
      })
      .returning();
    if (!row) throw new Error("categories insert returned no row");

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "category.created",
      entityType: "category",
      entityId: row.id,
      afterState: categoryState(row),
      changedFields: FULL_FIELDS,
    });

    return { recordId: row.id, rowVersion: row.rowVersion };
  },
};

const relabelCategory: CommandDefinition<RelabelCategoryPayload> = {
  name: "relabel-category",
  version: 1,
  module: "CORE",
  allowedRoles: ["DIRECTOR"],
  payloadSchema: relabelCategoryPayload,
  branchAuthorization: { kind: "workspace" },

  async execute(tx, ctx, envelope, payload) {
    const before = await requireCategory(tx, ctx, payload.categoryId);
    // Relabel overwrites free text a concurrent admin may have just written, so
    // expectedVersion is mandatory here (unlike the state flips below, whose
    // ALREADY_* refusals already tell a stale client its picture is old).
    checkOptimisticVersion(envelope, before.rowVersion);

    const [row] = await tx
      .update(categories)
      .set({
        labelFr: payload.labelFr,
        labelEn: payload.labelEn,
        rowVersion: before.rowVersion + 1,
      })
      .where(eq(categories.id, before.id))
      .returning();
    if (!row) throw new Error("categories update returned no row");

    await appendAuditEvent(tx, ctx, envelope, {
      eventType: "category.relabeled",
      entityType: "category",
      entityId: row.id,
      beforeState: categoryState(before),
      afterState: categoryState(row),
      changedFields: ["labelFr", "labelEn", "rowVersion"],
    });

    return { recordId: row.id, rowVersion: row.rowVersion };
  },
};

/**
 * Categories are never deleted — a record that referenced one must keep
 * resolving — so retiring one flips `active` and the pickers stop offering it.
 * Reactivate is the honest inverse: the unique (workspace, kind, code) index
 * means a retired code can never be re-created, so archiving has to be
 * reversible or a typo is permanent.
 *
 * A flip that would change nothing is refused rather than swallowed: the caller
 * is acting on a list it fetched earlier, and "already inactive" is information
 * it needs, not noise. The refusal is stable and cheap to handle — the client
 * refetches.
 */
function categoryStateFlip(opts: {
  name: string;
  active: boolean;
  eventType: string;
  noopCode: "CATEGORY_ALREADY_INACTIVE" | "CATEGORY_ALREADY_ACTIVE";
  payloadSchema: z.ZodType<DeactivateCategoryPayload>;
}): CommandDefinition<DeactivateCategoryPayload> {
  return {
    name: opts.name,
    version: 1,
    module: "CORE",
    allowedRoles: ["DIRECTOR"],
    payloadSchema: opts.payloadSchema,
    branchAuthorization: { kind: "workspace" },

    async execute(tx, ctx, envelope, payload) {
      const before = await requireCategory(tx, ctx, payload.categoryId);
      if (before.active === opts.active) {
        throw new CommandError(409, opts.noopCode, { categoryId: before.id });
      }
      // Optional here, honored when sent: the no-op refusal above already
      // catches the stale-client case this would otherwise have to catch.
      if (envelope.expectedVersion !== undefined) {
        checkOptimisticVersion(envelope, before.rowVersion);
      }

      const [row] = await tx
        .update(categories)
        .set({ active: opts.active, rowVersion: before.rowVersion + 1 })
        .where(eq(categories.id, before.id))
        .returning();
      if (!row) throw new Error("categories update returned no row");

      await appendAuditEvent(tx, ctx, envelope, {
        eventType: opts.eventType,
        entityType: "category",
        entityId: row.id,
        beforeState: categoryState(before),
        afterState: categoryState(row),
        changedFields: ["active", "rowVersion"],
      });

      return { recordId: row.id, rowVersion: row.rowVersion };
    },
  };
}

registerCommand(createCategory);
registerCommand(relabelCategory);
registerCommand(
  categoryStateFlip({
    name: "deactivate-category",
    active: false,
    eventType: "category.deactivated",
    noopCode: "CATEGORY_ALREADY_INACTIVE",
    payloadSchema: deactivateCategoryPayload,
  }),
);
registerCommand(
  categoryStateFlip({
    name: "reactivate-category",
    active: true,
    eventType: "category.reactivated",
    noopCode: "CATEGORY_ALREADY_ACTIVE",
    payloadSchema: reactivateCategoryPayload,
  }),
);
