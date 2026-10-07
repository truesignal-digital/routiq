import {
  activityDetail,
  activityListQuery,
  activityListResponse,
  canReadEntries,
  personListQuery,
  personListResponse,
  placeListResponse,
  type ListSort,
} from "@routiq/contracts";
import {
  and,
  asc,
  eq,
  exists,
  gte,
  ilike,
  inArray,
  lte,
  sql,
  type SQL,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RequireAuth } from "../auth/plugin.js";
import type { AuthContext } from "../auth/types.js";
import type { Db } from "../db/client.js";
import {
  activities,
  activityAssetSegments,
  activityPeople,
  assets,
  branches,
  categories,
  commands,
  financialEntries,
  financialPostings,
  meterReadings,
  movementLegs,
  persons,
  places,
} from "../db/schema.js";
import { cancelledBySql, toEntryCancellation } from "./entry-cancellation.js";
import {
  afterKeyset,
  bindText,
  decodeColumnCursor,
  encodeKeysetCursor,
  keysetOrderBy,
  microsecondKey,
  timestampKeyset,
  type KeysetColumn,
  type KeysetValue,
} from "./cursor.js";
import { serializeMinor } from "./serialize-minor.js";
import { ANY_ROLE, defineRead, type ReadTx } from "./define-read.js";
import { readableEntrySql } from "./money-scope.js";

const defaultActivitySort: ListSort<"startedAt"> = {
  field: "startedAt",
  direction: "desc",
};

type ActivitySortField = "startedAt" | "activityNumber";

const activitySortColumns: Record<ActivitySortField, KeysetColumn> = {
  startedAt: timestampKeyset(activities.startedAt, { nullable: true }),
  activityNumber: { column: activities.activityNumber, bind: bindText },
};

interface ActivitySortRow {
  /** `startedAt` as microsecond keyset text. */
  startedAtKey: string | null;
  activityNumber: string;
}

function activitySortValue(
  field: ActivitySortField,
  row: ActivitySortRow,
): KeysetValue {
  return field === "startedAt" ? row.startedAtKey : row.activityNumber;
}

function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function serializeReadingValue(value: bigint): number {
  const serialized = Number(value);
  if (!Number.isSafeInteger(serialized)) {
    throw new Error(`Reading value ${value} exceeds MAX_SAFE_INTEGER`);
  }
  return serialized;
}

function primaryAssetCodeSql(): SQL<string | null> {
  return sql<string | null>`(
    select ${assets.assetCode}
    from ${activityAssetSegments}
    inner join ${assets}
      on ${assets.workspaceId} = ${activityAssetSegments.workspaceId}
      and ${assets.id} = ${activityAssetSegments.assetId}
    where ${activityAssetSegments.workspaceId} = ${activities.workspaceId}
      and ${activityAssetSegments.activityId} = ${activities.id}
      and ${activityAssetSegments.role} = 'PRIMARY'
    order by ${activityAssetSegments.startedAt} asc, ${activityAssetSegments.id} asc
    limit 1
  )`;
}

function legCountSql(): SQL<number> {
  return sql<number>`(
    select count(*)::integer
    from ${movementLegs}
    where ${movementLegs.workspaceId} = ${activities.workspaceId}
      and ${movementLegs.activityId} = ${activities.id}
  )`;
}

/**
 * One end of the trip: the first leg's origin or the last leg's destination,
 * as the detail read names it — the place, else the text typed for an ad-hoc
 * stop. Null for an activity with no legs.
 */
function legEndSql(end: "origin" | "destination"): SQL<string | null> {
  const placeId = end === "origin" ? movementLegs.originPlaceId : movementLegs.destinationPlaceId;
  const text = end === "origin" ? movementLegs.originText : movementLegs.destinationText;
  const order = end === "origin" ? sql`asc` : sql`desc`;
  return sql<string | null>`(
    select coalesce(${places.name}, ${text})
    from ${movementLegs}
    left join ${places}
      on ${places.workspaceId} = ${movementLegs.workspaceId}
      and ${places.id} = ${placeId}
    where ${movementLegs.workspaceId} = ${activities.workspaceId}
      and ${movementLegs.activityId} = ${activities.id}
    order by ${movementLegs.legNo} ${order}
    limit 1
  )`;
}

/** Kilometres over the legs that carry them; null when none does. */
function distanceKmSql(): SQL<number | null> {
  return sql<number | null>`(
    select sum(${movementLegs.distanceKm})::integer
    from ${movementLegs}
    where ${movementLegs.workspaceId} = ${activities.workspaceId}
      and ${movementLegs.activityId} = ${activities.id}
  )`;
}

/**
 * The first DRIVER put on the crew; the trip row names one driver. Crew given
 * in one command shares a timestamp, so the name breaks the tie — the order
 * the detail read lists the crew in.
 */
function driverNameSql(): SQL<string | null> {
  return sql<string | null>`(
    select ${persons.displayName}
    from ${activityPeople}
    inner join ${persons}
      on ${persons.workspaceId} = ${activityPeople.workspaceId}
      and ${persons.id} = ${activityPeople.personId}
    where ${activityPeople.workspaceId} = ${activities.workspaceId}
      and ${activityPeople.activityId} = ${activities.id}
      and ${activityPeople.role} = 'DRIVER'
    order by ${activityPeople.createdAt} asc, ${persons.displayName} asc, ${activityPeople.id} asc
    limit 1
  )`;
}

function crewCountSql(): SQL<number> {
  return sql<number>`(
    select count(*)::integer
    from ${activityPeople}
    where ${activityPeople.workspaceId} = ${activities.workspaceId}
      and ${activityPeople.activityId} = ${activities.id}
  )`;
}

export function registerActivityReadRoutes(
  app: FastifyInstance,
  db: Db,
  requireAuth: RequireAuth,
) {
  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/activities", module: "ACTIVITIES", roles: ANY_ROLE, branchScope: "per-record" },
    async ({ req, reply, auth, read }) => {
      try {
        const parsedQuery = activityListQuery.safeParse(req.query);
        if (!parsedQuery.success) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }

        const {
          status,
          completeness,
          branchId,
          assetId,
          activityTypeCode,
          from,
          to,
          cursor,
          limit,
        } = parsedQuery.data;
        const sort = parsedQuery.data.sort ?? defaultActivitySort;
        const sortColumn = activitySortColumns[sort.field];

        const result = await read(async (tx) => {
          const decodedCursor = cursor
            ? decodeColumnCursor(cursor, sort, sortColumn)
            : undefined;
          if (cursor && !decodedCursor) {
            return { error: "VALIDATION_FAILED" as const };
          }

          const conditions: SQL[] = [
            eq(activities.workspaceId, auth.workspaceId),
          ];
          if (auth.branchScope !== "ALL") {
            conditions.push(inArray(activities.branchId, auth.branchScope));
          }
          if (branchId) conditions.push(eq(activities.branchId, branchId));
          if (status) conditions.push(eq(activities.status, status));
          if (completeness) {
            conditions.push(eq(activities.completeness, completeness));
          }
          if (activityTypeCode) {
            conditions.push(eq(categories.code, activityTypeCode));
          }
          if (from) conditions.push(gte(activities.startedAt, new Date(from)));
          if (to) conditions.push(lte(activities.startedAt, new Date(to)));

          if (assetId) {
            conditions.push(
              exists(
                tx
                  .select({ one: sql`1` })
                  .from(activityAssetSegments)
                  .where(
                    and(
                      eq(
                        activityAssetSegments.workspaceId,
                        activities.workspaceId,
                      ),
                      eq(activityAssetSegments.activityId, activities.id),
                      eq(activityAssetSegments.assetId, assetId),
                    ),
                  ),
              ),
            );
          }

          if (decodedCursor) {
            conditions.push(
              afterKeyset(
                sortColumn,
                sort.direction,
                activities.id,
                decodedCursor,
              ),
            );
          }

          const rows = await tx
            .select({
              id: activities.id,
              activityNumber: activities.activityNumber,
              activityTypeCode: categories.code,
              activityTypeLabelFr: categories.labelFr,
              activityTypeLabelEn: categories.labelEn,
              status: activities.status,
              completeness: activities.completeness,
              completenessCodes: activities.completenessCodes,
              startedAt: activities.startedAt,
              startedAtKey: microsecondKey(activities.startedAt),
              endedAt: activities.endedAt,
              customerName: activities.customerName,
              clientReference: activities.clientReference,
              branchId: activities.branchId,
              primaryAssetCode: primaryAssetCodeSql(),
              legCount: legCountSql(),
              crewCount: crewCountSql(),
              originName: legEndSql("origin"),
              destinationName: legEndSql("destination"),
              distanceKm: distanceKmSql(),
              driverName: driverNameSql(),
            })
            .from(activities)
            .innerJoin(
              categories,
              and(
                eq(categories.workspaceId, activities.workspaceId),
                eq(categories.id, activities.activityTypeId),
                eq(categories.kind, "ACTIVITY_TYPE"),
              ),
            )
            .where(and(...conditions))
            .orderBy(
              ...keysetOrderBy(sortColumn, sort.direction, activities.id),
            )
            .limit(limit + 1);

          return { rows };
        });

        if ("error" in result) {
          return reply.status(400).send({ error: { code: result.error } });
        }

        const hasNextPage = result.rows.length > limit;
        const pageRows = result.rows.slice(0, limit);
        const items = pageRows.map((row) => ({
          id: row.id,
          activityNumber: row.activityNumber,
          activityType: {
            code: row.activityTypeCode,
            labelFr: row.activityTypeLabelFr,
            labelEn: row.activityTypeLabelEn,
          },
          status: row.status,
          completeness: row.completeness,
          completenessCodes: row.completenessCodes,
          startedAt: row.startedAt?.toISOString() ?? null,
          endedAt: row.endedAt?.toISOString() ?? null,
          customerName: row.customerName,
          clientReference: row.clientReference,
          branchId: row.branchId,
          primaryAssetCode: row.primaryAssetCode,
          legCount: row.legCount,
          crewCount: row.crewCount,
          originName: row.originName,
          destinationName: row.destinationName,
          distanceKm: row.distanceKm,
          driverName: row.driverName,
        }));

        let nextCursor: string | null = null;
        if (hasNextPage && pageRows.length > 0) {
          const lastRow = pageRows[pageRows.length - 1]!;
          nextCursor = encodeKeysetCursor(
            sort,
            activitySortValue(sort.field, lastRow),
            lastRow.id,
          );
        }

        return activityListResponse.parse({ items, nextCursor });
      } catch (error) {
        req.log.error({ err: error }, "activities list read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );

  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/activities/:activityId", module: "ACTIVITIES", roles: ANY_ROLE, branchScope: "per-record" },
    async ({ req, reply, auth, modules, read }) => {
      try {
        const parsedParams = z
          .object({ activityId: z.uuid() })
          .safeParse(req.params);
        if (!parsedParams.success) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }
        const { activityId } = parsedParams.data;
        // The trip's entries, as many as the caller's money scope reads (#264):
        // all of them for the ledger and the counter, a driver's own, none for
        // the workshop.
        const entriesVisible = canReadEntries(auth.role) && modules.has("FINANCE");

        const result = await read(async (tx) => {
          const conditions: SQL[] = [
            eq(activities.workspaceId, auth.workspaceId),
            eq(activities.id, activityId),
          ];
          if (auth.branchScope !== "ALL") {
            conditions.push(inArray(activities.branchId, auth.branchScope));
          }

          const [header] = await tx
            .select({
              id: activities.id,
              activityNumber: activities.activityNumber,
              activityTypeCode: categories.code,
              activityTypeLabelFr: categories.labelFr,
              activityTypeLabelEn: categories.labelEn,
              templateCode: activities.templateCode,
              templateVersion: activities.templateVersion,
              customValues: activities.customValues,
              status: activities.status,
              completeness: activities.completeness,
              completenessCodes: activities.completenessCodes,
              customerName: activities.customerName,
              clientReference: activities.clientReference,
              description: activities.description,
              plannedStartAt: activities.plannedStartAt,
              plannedEndAt: activities.plannedEndAt,
              startedAt: activities.startedAt,
              endedAt: activities.endedAt,
              closedAt: activities.closedAt,
              createdAt: activities.createdAt,
              createdByCommandId: activities.createdByCommandId,
              recordedByPrincipalId: commands.initiatedByPrincipalId,
              branchId: activities.branchId,
              branchCode: branches.code,
              rowVersion: activities.rowVersion,
              // Same expressions as the list, so a trip row and its detail
              // can never name a different route or driver.
              originName: legEndSql("origin"),
              destinationName: legEndSql("destination"),
              distanceKm: distanceKmSql(),
              driverName: driverNameSql(),
            })
            .from(activities)
            .innerJoin(
              categories,
              and(
                eq(categories.workspaceId, activities.workspaceId),
                eq(categories.id, activities.activityTypeId),
                eq(categories.kind, "ACTIVITY_TYPE"),
              ),
            )
            .innerJoin(
              branches,
              and(
                eq(branches.workspaceId, activities.workspaceId),
                eq(branches.id, activities.branchId),
              ),
            )
            .leftJoin(
              commands,
              and(
                eq(commands.workspaceId, activities.workspaceId),
                eq(commands.id, activities.createdByCommandId),
              ),
            )
            .where(and(...conditions))
            .limit(1);

          if (!header) return undefined;

          const originPlace = alias(places, "activity_origin_place");
          const destinationPlace = alias(
            places,
            "activity_destination_place",
          );

          // A transaction owns one pg connection; keep the child reads
          // sequential so the driver never receives overlapping queries.
          const segmentRows = await tx
            .select({
              id: activityAssetSegments.id,
              assetId: activityAssetSegments.assetId,
              assetCode: assets.assetCode,
              role: activityAssetSegments.role,
              startedAt: activityAssetSegments.startedAt,
              endedAt: activityAssetSegments.endedAt,
              substitutesSegmentId: activityAssetSegments.substitutesSegmentId,
              rowVersion: activityAssetSegments.rowVersion,
            })
            .from(activityAssetSegments)
            .innerJoin(
              assets,
              and(
                eq(assets.workspaceId, activityAssetSegments.workspaceId),
                eq(assets.id, activityAssetSegments.assetId),
              ),
            )
            .where(
              and(
                eq(activityAssetSegments.workspaceId, auth.workspaceId),
                eq(activityAssetSegments.activityId, activityId),
              ),
            )
            .orderBy(
              asc(activityAssetSegments.startedAt),
              asc(activityAssetSegments.id),
            );

          const crewRows = await tx
            .select({
              personId: activityPeople.personId,
              displayName: persons.displayName,
              role: activityPeople.role,
            })
            .from(activityPeople)
            .innerJoin(
              persons,
              and(
                eq(persons.workspaceId, activityPeople.workspaceId),
                eq(persons.id, activityPeople.personId),
              ),
            )
            .where(
              and(
                eq(activityPeople.workspaceId, auth.workspaceId),
                eq(activityPeople.activityId, activityId),
              ),
            )
            .orderBy(asc(persons.displayName), asc(activityPeople.id));

          const legRows = await tx
            .select({
              id: movementLegs.id,
              legNo: movementLegs.legNo,
              segmentId: movementLegs.segmentId,
              originPlaceId: movementLegs.originPlaceId,
              originName: sql<string>`coalesce(${originPlace.name}, ${movementLegs.originText})`,
              destinationPlaceId: movementLegs.destinationPlaceId,
              destinationName: sql<string>`coalesce(${destinationPlace.name}, ${movementLegs.destinationText})`,
              departedAt: movementLegs.departedAt,
              arrivedAt: movementLegs.arrivedAt,
              distanceKm: movementLegs.distanceKm,
              loadState: movementLegs.loadState,
              passengerCount: movementLegs.passengerCount,
              customValues: movementLegs.customValues,
            })
            .from(movementLegs)
            .leftJoin(
              originPlace,
              and(
                eq(originPlace.workspaceId, movementLegs.workspaceId),
                eq(originPlace.id, movementLegs.originPlaceId),
              ),
            )
            .leftJoin(
              destinationPlace,
              and(
                eq(destinationPlace.workspaceId, movementLegs.workspaceId),
                eq(destinationPlace.id, movementLegs.destinationPlaceId),
              ),
            )
            .where(
              and(
                eq(movementLegs.workspaceId, auth.workspaceId),
                eq(movementLegs.activityId, activityId),
              ),
            )
            .orderBy(asc(movementLegs.legNo), asc(movementLegs.id));

          const readingRows = await tx
            .select({
              id: meterReadings.id,
              assetId: meterReadings.assetId,
              assetCode: assets.assetCode,
              readingType: meterReadings.readingType,
              value: meterReadings.value,
              observedAt: meterReadings.observedAt,
              source: meterReadings.source,
              supersededById: meterReadings.supersededById,
            })
            .from(meterReadings)
            .innerJoin(
              assets,
              and(
                eq(assets.workspaceId, meterReadings.workspaceId),
                eq(assets.id, meterReadings.assetId),
              ),
            )
            .where(
              and(
                eq(meterReadings.workspaceId, auth.workspaceId),
                eq(meterReadings.activityId, activityId),
              ),
            )
            .orderBy(asc(meterReadings.observedAt), asc(meterReadings.id));

          // Every role reads the trip, not its money (#103). Null, never an
          // empty list, so a hidden ledger cannot pass for a trip with no money.
          const financialRows = entriesVisible
            ? await activityFinancialRows(tx, auth, activityId)
            : null;

          return {
            header,
            segmentRows,
            crewRows,
            legRows,
            readingRows,
            financialRows,
          };
        });

        if (!result) {
          return reply
            .status(404)
            .send({ error: { code: "REFERENCE_NOT_FOUND" } });
        }

        const {
          header,
          segmentRows,
          crewRows,
          legRows,
          readingRows,
          financialRows,
        } = result;
        const primaryAssetCode =
          segmentRows.find((segment) => segment.role === "PRIMARY")?.assetCode ??
          null;

        return activityDetail.parse({
          id: header.id,
          activityNumber: header.activityNumber,
          activityType: {
            code: header.activityTypeCode,
            labelFr: header.activityTypeLabelFr,
            labelEn: header.activityTypeLabelEn,
          },
          templateCode: header.templateCode,
          templateVersion: header.templateVersion,
          customValues: header.customValues,
          status: header.status,
          completeness: header.completeness,
          completenessCodes: header.completenessCodes,
          startedAt: header.startedAt?.toISOString() ?? null,
          endedAt: header.endedAt?.toISOString() ?? null,
          customerName: header.customerName,
          clientReference: header.clientReference,
          description: header.description,
          plannedStartAt: header.plannedStartAt?.toISOString() ?? null,
          plannedEndAt: header.plannedEndAt?.toISOString() ?? null,
          closedAt: header.closedAt?.toISOString() ?? null,
          createdAt: header.createdAt.toISOString(),
          createdByCommandId: header.createdByCommandId,
          recordedByPrincipalId: header.recordedByPrincipalId,
          branchId: header.branchId,
          branchCode: header.branchCode,
          primaryAssetCode,
          legCount: legRows.length,
          crewCount: crewRows.length,
          originName: header.originName,
          destinationName: header.destinationName,
          distanceKm: header.distanceKm,
          driverName: header.driverName,
          rowVersion: header.rowVersion,
          segments: segmentRows.map((segment) => ({
            ...segment,
            startedAt: segment.startedAt.toISOString(),
            endedAt: segment.endedAt?.toISOString() ?? null,
          })),
          crew: crewRows,
          legs: legRows.map((leg) => ({
            ...leg,
            departedAt: leg.departedAt?.toISOString() ?? null,
            arrivedAt: leg.arrivedAt?.toISOString() ?? null,
          })),
          readings: readingRows.map((reading) => ({
            ...reading,
            value: serializeReadingValue(reading.value),
            observedAt: reading.observedAt.toISOString(),
          })),
          financialEntries:
            financialRows?.map((entry) => ({
              ...entry,
              amountMinor: serializeMinor(entry.amountMinor),
              // A trip's money is one window: the pair always folds (#427).
              cancelledBy:
                entry.cancelledBy === null ? null : toEntryCancellation(entry.cancelledBy, true),
            })) ?? null,
        });
      } catch (error) {
        req.log.error({ err: error }, "activity detail read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );

  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/persons", module: "ACTIVITIES", roles: ANY_ROLE, branchScope: "per-record" },
    async ({ req, reply, auth, read }) => {
      try {
        const parsedQuery = personListQuery.safeParse(req.query);
        if (!parsedQuery.success) {
          return reply.status(400).send({ error: { code: "VALIDATION_FAILED" } });
        }
        const { branchId, active, search } = parsedQuery.data;

        const conditions: SQL[] = [
          eq(persons.workspaceId, auth.workspaceId),
        ];
        if (auth.branchScope !== "ALL") {
          conditions.push(inArray(persons.branchId, auth.branchScope));
        }
        if (branchId) conditions.push(eq(persons.branchId, branchId));
        if (active !== undefined) conditions.push(eq(persons.active, active));
        if (search) {
          conditions.push(ilike(persons.displayName, likePattern(search)));
        }

        const rows = await read((tx) =>
          tx
            .select({
              id: persons.id,
              displayName: persons.displayName,
              personCode: persons.personCode,
              defaultRole: persons.defaultRole,
              branchId: persons.branchId,
              active: persons.active,
            })
            .from(persons)
            .where(and(...conditions))
            .orderBy(asc(persons.displayName), asc(persons.id)),
        );

        return personListResponse.parse({ items: rows });
      } catch (error) {
        req.log.error({ err: error }, "persons list read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );

  defineRead(
    app,
    { db, requireAuth },
    { path: "/v1/places", module: "ACTIVITIES", roles: ANY_ROLE, branchScope: "workspace" },
    async ({ req, reply, auth, read }) => {
      try {
        const rows = await read((tx) =>
          tx
            .select({ id: places.id, name: places.name })
            .from(places)
            .where(eq(places.workspaceId, auth.workspaceId))
            .orderBy(asc(places.name), asc(places.id)),
        );
        return placeListResponse.parse({ items: rows });
      } catch (error) {
        req.log.error({ err: error }, "places list read failed");
        return reply.status(500).send({ error: { code: "READ_FAILED" } });
      }
    },
  );
}

/**
 * The trip's entries with their amounts: ledger figures, so the detail read
 * loads them only for the roles that read the books, with FINANCE on (#103).
 */
function activityFinancialRows(tx: ReadTx, auth: AuthContext, activityId: string) {
  return tx
    .selectDistinct({
      entryId: financialEntries.id,
      entryNumber: financialEntries.entryNumber,
      direction: financialEntries.direction,
      categoryCode: categories.code,
      categoryLabelFr: categories.labelFr,
      categoryLabelEn: categories.labelEn,
      amountMinor: financialEntries.amountMinor,
      status: financialEntries.status,
      reversesEntryId: financialEntries.reversesEntryId,
      cancelledBy: cancelledBySql(auth),
    })
    .from(financialPostings)
    .innerJoin(
      financialEntries,
      and(
        eq(
          financialEntries.workspaceId,
          financialPostings.workspaceId,
        ),
        eq(financialEntries.id, financialPostings.financialEntryId),
      ),
    )
    .innerJoin(
      categories,
      and(
        eq(categories.workspaceId, financialEntries.workspaceId),
        eq(categories.id, financialEntries.categoryId),
      ),
    )
    .where(
      and(
        eq(financialPostings.workspaceId, auth.workspaceId),
        eq(financialPostings.activityId, activityId),
        readableEntrySql(auth),
      ),
    )
    .orderBy(
      asc(financialEntries.entryNumber),
      asc(financialEntries.id),
    );
}
