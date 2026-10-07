import type { CancelledEntryRef, EntryCancellation } from "@routiq/contracts";
import { sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { AuthContext } from "../auth/types.js";
import { commands, financialEntries, postingPeriods, principals } from "../db/schema.js";
import { toActor } from "./actors.js";
import { readableEntrySql } from "./money-scope.js";

const cancellation = alias(financialEntries, "cancellation");
const cancellationPeriod = alias(postingPeriods, "cancellation_period");
const cancellationCommand = alias(commands, "cancellation_command");
const cancellationRecorder = alias(principals, "cancellation_recorder");
const original = alias(financialEntries, "cancelled_original");
const originalPeriod = alias(postingPeriods, "cancelled_original_period");

/**
 * An alias in a FROM clause. Interpolating the alias itself renders only its
 * name, so the table it stands for is spelled out here.
 */
function aliased(
  table: typeof financialEntries | typeof postingPeriods | typeof commands | typeof principals,
  name: string,
): SQL {
  return sql`${table} ${sql.identifier(name)}`;
}

/** `cancelledBySql` as Postgres hands it back: jsonb, timestamps as epoch milliseconds. */
export interface CancellationRow {
  entryId: string;
  entryNumber: string;
  postingPeriodCode: string | null;
  postedAtMs: number | null;
  reasonCode: string | null;
  reasonText: string | null;
  recorderPrincipalId: string | null;
  recorderDisplayName: string | null;
  recorderScope: "WORKSPACE" | "PLATFORM";
}

/**
 * The posted cancellation of the outer `financial_entries` row, if the caller
 * may read it (money read scope applies to both rows, #427). The reason comes
 * from the cancelling command's payload: `reason` on v1, `reasonCode` and
 * `reasonText` from v2 on. jsonb, so a DISTINCT over it still compares.
 */
export function cancelledBySql(auth: AuthContext): SQL<CancellationRow | null> {
  return sql<CancellationRow | null>`(
    select jsonb_build_object(
      'entryId', ${cancellation.id},
      'entryNumber', ${cancellation.entryNumber},
      'postingPeriodCode', ${cancellationPeriod.periodCode},
      'postedAtMs', (extract(epoch from ${cancellation.postedAt}) * 1000)::bigint,
      'reasonCode', ${cancellationCommand.payload}->>'reasonCode',
      'reasonText', coalesce(${cancellationCommand.payload}->>'reasonText', ${cancellationCommand.payload}->>'reason'),
      'recorderPrincipalId', ${cancellationCommand.tenantActorPrincipalId},
      'recorderDisplayName', ${cancellationRecorder.displayName},
      'recorderScope', ${cancellationCommand.scope}
    )
    from ${aliased(financialEntries, "cancellation")}
    inner join ${aliased(commands, "cancellation_command")}
      on ${cancellationCommand.workspaceId} = ${cancellation.workspaceId}
      and ${cancellationCommand.id} = ${cancellation.createdByCommandId}
    left join ${aliased(postingPeriods, "cancellation_period")}
      on ${cancellationPeriod.workspaceId} = ${cancellation.workspaceId}
      and ${cancellationPeriod.id} = ${cancellation.postingPeriodId}
    left join ${aliased(principals, "cancellation_recorder")}
      on ${cancellationRecorder.id} = ${cancellationCommand.tenantActorPrincipalId}
    where ${cancellation.workspaceId} = ${financialEntries.workspaceId}
      and ${cancellation.reversesEntryId} = ${financialEntries.id}
      and ${cancellation.status} = 'POSTED'
      and ${readableEntrySql(auth, cancellation)}
    limit 1
  )`;
}

export function toEntryCancellation(row: CancellationRow, folded: boolean): EntryCancellation {
  return {
    entryId: row.entryId,
    entryNumber: row.entryNumber,
    postingPeriodCode: row.postingPeriodCode,
    postedAt: row.postedAtMs === null ? null : new Date(Number(row.postedAtMs)).toISOString(),
    reasonCode: row.reasonCode,
    reasonText: row.reasonText,
    recordedBy: toActor({
      principalId: row.recorderPrincipalId,
      displayName: row.recorderDisplayName,
      scope: row.recorderScope,
    }),
    folded,
  };
}

/** On a cancellation row: the original it cancels, if the caller may read it. */
export function cancelsSql(auth: AuthContext): SQL<CancelledEntryRef | null> {
  return sql<CancelledEntryRef | null>`(
    select jsonb_build_object(
      'entryId', ${original.id},
      'entryNumber', ${original.entryNumber},
      'postingPeriodCode', ${originalPeriod.periodCode}
    )
    from ${aliased(financialEntries, "cancelled_original")}
    left join ${aliased(postingPeriods, "cancelled_original_period")}
      on ${originalPeriod.workspaceId} = ${original.workspaceId}
      and ${originalPeriod.id} = ${original.postingPeriodId}
    where ${original.workspaceId} = ${financialEntries.workspaceId}
      and ${original.id} = ${financialEntries.reversesEntryId}
      and ${readableEntrySql(auth, original)}
  )`;
}

/**
 * A posted cancellation whose original the caller reads in the same window:
 * the line that one-line-per-event lists leave out (#427). Without a period the
 * whole list is one window; a cancellation shares its original's economic date,
 * so only the posting period can set the two apart.
 */
export function foldedCancellationSql(auth: AuthContext, periodCode: string | undefined): SQL {
  return sql`(
    ${financialEntries.reversesEntryId} is not null
    and ${financialEntries.status} = 'POSTED'
    and exists (
      select 1 from ${aliased(financialEntries, "cancelled_original")}
      left join ${aliased(postingPeriods, "cancelled_original_period")}
        on ${originalPeriod.workspaceId} = ${original.workspaceId}
        and ${originalPeriod.id} = ${original.postingPeriodId}
      where ${original.workspaceId} = ${financialEntries.workspaceId}
        and ${original.id} = ${financialEntries.reversesEntryId}
        and ${readableEntrySql(auth, original)}
        ${periodCode === undefined ? sql`` : sql`and ${originalPeriod.periodCode} = ${periodCode}`}
    )
  )`;
}
