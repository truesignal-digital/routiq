import { navCountsResponse, waitsOn } from "@routiq/contracts";
import { and, eq, inArray, notExists, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { RequireAuth } from "../auth/plugin.js";
import type { AuthContext } from "../auth/types.js";
import type { Db } from "../db/client.js";
import { assets, operationalIssues, workOrders } from "../db/schema.js";
import type { TenantTx } from "../db/tenant.js";
import { decidablePendingEntries } from "./approvals-queue.js";
import { ANY_ROLE, defineRead } from "./define-read.js";

/** A work order still moving: the problem behind it is already in hand. */
const ACTIVE_WORK_ORDER_STATUSES = ["SUBMITTED", "APPROVED", "COMPLETION_SUBMITTED"] as const;

/** The Money page's waiting tile, counted the same way (#542). */
async function countMoneyWaiting(tx: TenantTx, auth: AuthContext): Promise<number> {
  return (await decidablePendingEntries(tx, auth)).length;
}

/** OPEN problems on trucks in the caller's branches that no live work order covers. */
async function countMaintenanceNew(tx: TenantTx, auth: AuthContext): Promise<number> {
  const conditions: SQL[] = [
    eq(operationalIssues.workspaceId, auth.workspaceId),
    eq(operationalIssues.status, "OPEN"),
    notExists(
      tx
        .select({ one: sql`1` })
        .from(workOrders)
        .where(
          and(
            eq(workOrders.workspaceId, operationalIssues.workspaceId),
            eq(workOrders.issueId, operationalIssues.id),
            inArray(workOrders.status, [...ACTIVE_WORK_ORDER_STATUSES]),
          ),
        ),
    ),
  ];
  if (auth.branchScope !== "ALL") {
    conditions.push(inArray(assets.branchId, auth.branchScope));
  }
  const [row] = await tx
    .select({ count: sql<number>`count(*)::integer` })
    .from(operationalIssues)
    .innerJoin(
      assets,
      and(eq(assets.workspaceId, operationalIssues.workspaceId), eq(assets.id, operationalIssues.assetId)),
    )
    .where(and(...conditions));
  return row?.count ?? 0;
}

/**
 * The navigation's counts (#322): only work that waits on the caller, counted
 * here so the browser never counts rows. Each count carries the gates of the
 * list it opens: its module, the roles that act there, the caller's branches.
 */
export function registerNavCountsReadRoutes(app: FastifyInstance, db: Db, requireAuth: RequireAuth) {
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/nav-counts", module: "CORE", roles: ANY_ROLE, branchScope: "per-record" },
    async ({ auth, modules, read }) => {
      const counts = await read(async (tx) => ({
        moneyWaiting:
          modules.has("FINANCE") && waitsOn("moneyWaiting", auth.role)
            ? await countMoneyWaiting(tx, auth)
            : null,
        maintenanceNew:
          modules.has("MAINTENANCE") && waitsOn("maintenanceNew", auth.role)
            ? await countMaintenanceNew(tx, auth)
            : null,
      }));
      return navCountsResponse.parse(counts);
    },
  );
}
