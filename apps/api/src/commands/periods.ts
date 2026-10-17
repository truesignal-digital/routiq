import { and, eq } from "drizzle-orm";
import { postingPeriods } from "../db/schema.js";
import { workspaceTimezone } from "../reads/workspace-day.js";
import { CommandError } from "./dispatcher.js";
import type { CommandContext, Tx } from "./dispatcher.js";

export interface PeriodResolution {
  periodId: string;
  periodCode: string;
  /** True when the entry posts to a different month than its economic date (§4.2). */
  isLatePosting: boolean;
}

/** 'YYYY-MM' of an ISO date string. economic_date is a plain date — no timezone math. */
export function periodCodeOf(isoDate: string): string {
  return isoDate.slice(0, 7);
}

/** 'YYYY-MM' of the current instant in the workspace timezone. */
export function currentPeriodCode(now: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  if (!year || !month) throw new Error(`unresolvable timezone: ${timezone}`);
  return `${year}-${month}`;
}

/**
 * Find-or-create a period row (auto-create OPEN on first post — locked
 * decision, financial-core spec). Concurrency-safe via the (workspace,
 * period_code) unique index: on conflict we re-select.
 */
export async function ensurePeriod(
  tx: Tx,
  ctx: CommandContext,
  periodCode: string,
  createdByCommandId: string,
): Promise<{ id: string; status: "OPEN" | "LOCKED"; rowVersion: number }> {
  const existing = await findPeriod(tx, ctx, periodCode);
  if (existing) return existing;
  await tx
    .insert(postingPeriods)
    .values({ workspaceId: ctx.workspaceId, periodCode, createdByCommandId })
    .onConflictDoNothing();
  const created = await findPeriod(tx, ctx, periodCode);
  if (!created) throw new Error(`period upsert failed: ${periodCode}`);
  return created;
}

/**
 * Resolve which period an entry posts to, at POSTING time (never at
 * submission). Economic month open (or absent) → post there. Economic month
 * locked → late-post to the current calendar month (workspace timezone),
 * auto-created if absent. Current month itself locked → PERIOD_LOCKED: locking
 * the live month deliberately halts posting, and there is no bypass flag.
 */
export async function resolvePostingPeriod(
  tx: Tx,
  ctx: CommandContext,
  economicDate: string,
  createdByCommandId: string,
): Promise<PeriodResolution> {
  const economicCode = periodCodeOf(economicDate);
  const economicPeriod = await ensurePeriod(tx, ctx, economicCode, createdByCommandId);
  if (economicPeriod.status === "OPEN") {
    return { periodId: economicPeriod.id, periodCode: economicCode, isLatePosting: false };
  }

  const currentCode = currentPeriodCode(new Date(), await workspaceTimezone(tx, ctx.workspaceId));
  if (currentCode === economicCode) {
    throw new CommandError(409, "PERIOD_LOCKED", { periodCode: economicCode });
  }
  const currentPeriod = await ensurePeriod(tx, ctx, currentCode, createdByCommandId);
  if (currentPeriod.status === "LOCKED") {
    throw new CommandError(409, "PERIOD_LOCKED", { periodCode: currentCode });
  }
  return { periodId: currentPeriod.id, periodCode: currentCode, isLatePosting: true };
}

async function findPeriod(
  tx: Tx,
  ctx: CommandContext,
  periodCode: string,
): Promise<{ id: string; status: "OPEN" | "LOCKED"; rowVersion: number } | undefined> {
  const [row] = await tx
    .select({
      id: postingPeriods.id,
      status: postingPeriods.status,
      rowVersion: postingPeriods.rowVersion,
    })
    .from(postingPeriods)
    .where(
      and(
        eq(postingPeriods.workspaceId, ctx.workspaceId),
        eq(postingPeriods.periodCode, periodCode),
      ),
    )
    // Serializes posting with LockPeriod: both paths resolve the period through
    // this helper, so a lock cannot slip between an OPEN read and insertion.
    .for("update")
    .limit(1);
  return row;
}
