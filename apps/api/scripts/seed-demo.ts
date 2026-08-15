import "dotenv/config";
import type { CommandOutcome } from "../src/commands/dispatcher.js";
import type { AuthContext } from "../src/auth/types.js";
import { eq, inArray } from "drizzle-orm";
import { resolveAuthContext } from "../src/auth/context.js";
import { authDb, authPool, db, pool } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { dispatchCommand } from "../src/commands/dispatcher.js";
import "../src/server.js";
import { deterministicProvisionId, provisionTenant } from "./provision.js";

const demoWorkspaceSlug = "transports-ngwa";
const workspaceSlug = demoWorkspaceSlug;
const branchCode = "DLA";
const demoId = (name: string) =>
  deterministicProvisionId(`seed-demo:${workspaceSlug}:${name}`);

const ids = {
  workspace: demoId("workspace"),
  branch: demoId("branch:douala"),
  emilienne: demoId("user:emilienne"),
  boris: demoId("user:boris"),
  sali: demoId("user:sali"),
  driver: demoId("person:jean-ngwa"),
  vh001: demoId("asset:VH001"),
  vh003: demoId("asset:VH003"),
  tr001: demoId("asset:TR001"),
  garouaJourney: demoId("activity:douala-garoua"),
  garouaPrimarySegment: demoId("segment:douala-garoua:VH003"),
  garouaTrailerSegment: demoId("segment:douala-garoua:TR001"),
  garouaLeg: demoId("leg:douala-garoua"),
  garouaOrigin: demoId("place:douala"),
  garouaDestination: demoId("place:garoua"),
  garouaStartReading: demoId("reading:douala-garoua:start"),
  garouaEndReading: demoId("reading:douala-garoua:end"),
  garouaCrew: demoId("crew:douala-garoua:driver"),
  garouaRevenue: demoId("entry:douala-garoua:revenue"),
  garouaFuel: demoId("entry:douala-garoua:fuel"),
  garouaTolls: demoId("entry:douala-garoua:tolls"),
  garouaAllowance: demoId("entry:douala-garoua:allowance"),
  bafoussamJourney: demoId("activity:douala-bafoussam"),
  bafoussamSegment: demoId("segment:douala-bafoussam:VH001"),
  bafoussamLeg: demoId("leg:douala-bafoussam"),
  bafoussamDestination: demoId("place:bafoussam"),
  yaoundeJourney: demoId("activity:douala-yaounde"),
  yaoundeSegment: demoId("segment:douala-yaounde:VH003"),
  yaoundeLeg: demoId("leg:douala-yaounde"),
  yaoundeDestination: demoId("place:yaounde"),
  repair: demoId("entry:VH003:repair"),
};

interface DemoUser {
  id: string;
  username: string;
  displayName: string;
  pin: string;
  role: "ADMIN" | "OPS_MANAGER" | "FIELD_SUBMITTER";
}

const users: DemoUser[] = [
  {
    id: ids.emilienne,
    username: "emilienne",
    displayName: "Émilienne",
    pin: "111111",
    role: "ADMIN",
  },
  {
    id: ids.boris,
    username: "boris",
    displayName: "Boris",
    pin: "222222",
    role: "OPS_MANAGER",
  },
  {
    id: ids.sali,
    username: "sali",
    displayName: "Sali",
    pin: "333333",
    role: "FIELD_SUBMITTER",
  },
];

function commandId(name: string): string {
  return demoId(`command:${name}`);
}

function idempotencyKey(name: string): string {
  return `seed-demo:${workspaceSlug}:${name}`;
}

async function resetDemoWorkspace(slug: string): Promise<boolean> {
  if (slug !== demoWorkspaceSlug) {
    throw new Error(
      `Refusing to reset workspace "${slug}"; only "${demoWorkspaceSlug}" may be reset.`,
    );
  }

  return authDb.transaction(async (tx) => {
    const [workspace] = await tx
      .select({ id: schema.workspaces.id })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.slug, slug))
      .limit(1);
    if (!workspace) return false;

    const [membershipPrincipals, credentialPrincipals] = await Promise.all([
      tx
        .select({ id: schema.memberships.principalId })
        .from(schema.memberships)
        .where(eq(schema.memberships.workspaceId, workspace.id)),
      tx
        .select({ id: schema.credentials.principalId })
        .from(schema.credentials)
        .where(eq(schema.credentials.workspaceId, workspace.id)),
    ]);
    const principalIds = [
      ...new Set(
        [...membershipPrincipals, ...credentialPrincipals].map(({ id }) => id),
      ),
    ];

    // Child tables first. The explicit list mirrors every workspace-scoped
    // export in src/db/schema.ts so a reset does not depend on FK cascades.
    await tx
      .delete(schema.financialPostings)
      .where(eq(schema.financialPostings.workspaceId, workspace.id));
    await tx
      .delete(schema.movementLegs)
      .where(eq(schema.movementLegs.workspaceId, workspace.id));
    await tx
      .delete(schema.activityPeople)
      .where(eq(schema.activityPeople.workspaceId, workspace.id));
    await tx
      .delete(schema.commandSourceArtifacts)
      .where(eq(schema.commandSourceArtifacts.workspaceId, workspace.id));
    await tx
      .delete(schema.documents)
      .where(eq(schema.documents.workspaceId, workspace.id));
    await tx
      .delete(schema.activityAssetSegments)
      .where(eq(schema.activityAssetSegments.workspaceId, workspace.id));
    await tx
      .delete(schema.meterReadings)
      .where(eq(schema.meterReadings.workspaceId, workspace.id));
    await tx
      .delete(schema.financialEntries)
      .where(eq(schema.financialEntries.workspaceId, workspace.id));
    await tx
      .delete(schema.activities)
      .where(eq(schema.activities.workspaceId, workspace.id));
    await tx
      .delete(schema.persons)
      .where(eq(schema.persons.workspaceId, workspace.id));
    await tx
      .delete(schema.places)
      .where(eq(schema.places.workspaceId, workspace.id));
    await tx
      .delete(schema.assets)
      .where(eq(schema.assets.workspaceId, workspace.id));
    await tx
      .delete(schema.postingPeriods)
      .where(eq(schema.postingPeriods.workspaceId, workspace.id));
    // Commands record the approval rule that evaluated them, while rules record
    // the command that created them. Break that nullable cycle before deleting.
    await tx
      .update(schema.commands)
      .set({ approvalRuleId: null })
      .where(eq(schema.commands.workspaceId, workspace.id));
    await tx
      .delete(schema.approvalRules)
      .where(eq(schema.approvalRules.workspaceId, workspace.id));
    await tx
      .delete(schema.categories)
      .where(eq(schema.categories.workspaceId, workspace.id));
    await tx
      .delete(schema.sourceArtifacts)
      .where(eq(schema.sourceArtifacts.workspaceId, workspace.id));
    await tx
      .delete(schema.numberCounters)
      .where(eq(schema.numberCounters.workspaceId, workspace.id));
    await tx
      .delete(schema.workspaceModules)
      .where(eq(schema.workspaceModules.workspaceId, workspace.id));
    await tx
      .delete(schema.workspaceTemplates)
      .where(eq(schema.workspaceTemplates.workspaceId, workspace.id));
    await tx
      .delete(schema.auditEvents)
      .where(eq(schema.auditEvents.workspaceId, workspace.id));
    await tx
      .delete(schema.sessions)
      .where(eq(schema.sessions.workspaceId, workspace.id));
    await tx
      .delete(schema.branches)
      .where(eq(schema.branches.workspaceId, workspace.id));
    await tx
      .delete(schema.commands)
      .where(eq(schema.commands.workspaceId, workspace.id));

    await tx
      .delete(schema.credentials)
      .where(eq(schema.credentials.workspaceId, workspace.id));
    await tx
      .delete(schema.memberships)
      .where(eq(schema.memberships.workspaceId, workspace.id));
    await tx
      .delete(schema.workspaces)
      .where(eq(schema.workspaces.id, workspace.id));
    if (principalIds.length > 0) {
      await tx
        .delete(schema.principals)
        .where(inArray(schema.principals.id, principalIds));
    }

    return true;
  });
}

async function actor(principalId: string): Promise<AuthContext> {
  const context = await resolveAuthContext(authDb, {
    workspaceId: ids.workspace,
    principalId,
  });
  if (!context) throw new Error(`Unable to resolve demo user ${principalId}`);
  return context;
}

async function runCommand(
  context: AuthContext,
  operation: string,
  payload: unknown,
  options: { expectedVersion?: number } = {},
): Promise<CommandOutcome> {
  const name = operation.split(":", 1)[0]!;
  const result = await dispatchCommand(db, context, {
    name,
    version: 1,
    envelope: {
      commandId: commandId(operation),
      idempotencyKey: idempotencyKey(operation),
      origin: "API",
      ...(options.expectedVersion === undefined
        ? {}
        : { expectedVersion: options.expectedVersion }),
    },
    payload,
  });
  if ("error" in result.body) {
    throw new Error(
      `${operation} failed (${result.status} ${result.body.error.code}): ${JSON.stringify(result.body.error.metadata ?? {})}`,
    );
  }
  return result.body;
}

try {
  if (process.argv.includes("--reset")) {
    const deleted = await resetDemoWorkspace(workspaceSlug);
    console.log(
      deleted
        ? "Reset: deleted existing workspace"
        : "Reset: no existing workspace to delete",
    );
  }

  const provisioned = await provisionTenant(
    {
      workspace: {
        id: ids.workspace,
        slug: workspaceSlug,
        name: "Transports Ngwa",
      },
      branches: [
        {
          id: ids.branch,
          code: branchCode,
          name: "Douala",
        },
      ],
      admin: {
        id: ids.emilienne,
        displayName: "Émilienne",
        username: "emilienne",
        pin: "111111",
      },
      users: users.slice(1).map((user) => ({
        ...user,
        branchScope: "ALL",
      })),
      enabledPresets: ["TRUCKING"],
    },
    console.log,
    {
      commandId: commandId("provision-workspace"),
      /**
       * `.v2` only on this one command: provisioning is the only payload whose
       * shape changed (issue #20), and reusing a key across a shape change is a
       * 409 rather than a replay. Every other seed command keeps its key, or a
       * re-seed would write its records a second time.
       */
      idempotencyKey: idempotencyKey("provision-workspace.v2"),
    },
  );

  const [emilienne, boris, sali] = await Promise.all([
    actor(ids.emilienne),
    actor(ids.boris),
    actor(ids.sali),
  ]);

  await Promise.all([
    runCommand(emilienne, "register-asset:VH001", {
      assetId: ids.vh001,
      assetCode: "VH001",
      assetClassCode: "TRUCK",
      templateCode: "TRUCKING",
      branchCode,
    }),
    runCommand(emilienne, "register-asset:VH003", {
      assetId: ids.vh003,
      assetCode: "VH003",
      assetClassCode: "TRUCK",
      templateCode: "TRUCKING",
      branchCode,
    }),
    runCommand(emilienne, "register-asset:TR001", {
      assetId: ids.tr001,
      assetCode: "TR001",
      assetClassCode: "TRAILER",
      templateCode: "TRUCKING",
      branchCode,
    }),
  ]);

  await runCommand(boris, "register-person:jean-ngwa", {
    personId: ids.driver,
    displayName: "Jean Ngwa",
    personCode: "DRV001",
    branchCode,
    defaultRole: "DRIVER",
  });

  const garoua = await runCommand(boris, "record-haulage-job-sheet:douala-garoua", {
    activityId: ids.garouaJourney,
    close: true,
    branchCode,
    activityTypeCode: "HAULAGE_JOB",
    primarySegmentId: ids.garouaPrimarySegment,
    primaryAssetId: ids.vh003,
    startedAt: "2026-07-14T05:30:00Z",
    endedAt: "2026-07-15T18:20:00Z",
    customerName: "Commerce du Nord",
    clientReference: "NGWA-GAR-001",
    cargoDescription: "Marchandises générales",
    startReading: {
      readingId: ids.garouaStartReading,
      readingType: "ODOMETER",
      value: 184_220,
      observedAt: "2026-07-14T05:30:00Z",
    },
    endReading: {
      readingId: ids.garouaEndReading,
      readingType: "ODOMETER",
      value: 185_640,
      observedAt: "2026-07-15T18:20:00Z",
    },
    crew: [
      {
        activityPersonId: ids.garouaCrew,
        personId: ids.driver,
        role: "DRIVER",
      },
    ],
    extraSegments: [
      {
        segmentId: ids.garouaTrailerSegment,
        assetId: ids.tr001,
        role: "TRAILER",
        startedAt: "2026-07-14T05:30:00Z",
        endedAt: "2026-07-15T18:20:00Z",
      },
    ],
    legs: [
      {
        legId: ids.garouaLeg,
        legNo: 1,
        segmentId: ids.garouaPrimarySegment,
        origin: { kind: "place", placeId: ids.garouaOrigin, name: "Douala" },
        destination: {
          kind: "place",
          placeId: ids.garouaDestination,
          name: "Garoua",
        },
        departedAt: "2026-07-14T05:30:00Z",
        arrivedAt: "2026-07-15T18:20:00Z",
        distanceKm: 1_420,
        loadState: "LADEN",
      },
    ],
    entries: [
      {
        entryId: ids.garouaRevenue,
        assetId: ids.vh003,
        direction: "REVENUE",
        categoryCode: "FREIGHT_REVENUE",
        amountMinor: 2_850_000,
        economicDate: "2026-07-15",
        paymentMethod: "BANK",
        paymentReference: "VIR-NGWA-GAR-001",
        counterpartyName: "Commerce du Nord",
      },
    ],
  });

  const expenseResults = await Promise.all([
    runCommand(sali, "record-expense:douala-garoua:fuel", {
      entryId: ids.garouaFuel,
      branchCode,
      categoryCode: "FUEL",
      economicDate: "2026-07-14",
      description: "Carburant — Douala à Garoua",
      amountMinor: 1_180_000,
      paymentMethod: "CASH",
      sourceReference: "NGWA-GAR-001",
      postings: [{ assetId: ids.vh003, amountMinor: 1_180_000 }],
    }),
    runCommand(sali, "record-expense:douala-garoua:tolls", {
      entryId: ids.garouaTolls,
      branchCode,
      categoryCode: "TOLLS",
      economicDate: "2026-07-15",
      description: "Péages — Douala à Garoua",
      amountMinor: 45_000,
      paymentMethod: "CASH",
      sourceReference: "NGWA-GAR-001",
      postings: [{ assetId: ids.vh003, amountMinor: 45_000 }],
    }),
    runCommand(sali, "record-expense:douala-garoua:allowance", {
      entryId: ids.garouaAllowance,
      branchCode,
      categoryCode: "DRIVER_ALLOWANCE",
      economicDate: "2026-07-15",
      description: "Indemnité chauffeur — Douala à Garoua",
      amountMinor: 120_000,
      paymentMethod: "CASH",
      sourceReference: "NGWA-GAR-001",
      postings: [{ assetId: ids.vh003, amountMinor: 120_000 }],
    }),
  ]);

  await Promise.all(
    [ids.garouaRevenue, ids.garouaFuel, ids.garouaAllowance].map((entryId) =>
      runCommand(
        emilienne,
        `approve-entry:${entryId}`,
        { entryId, note: "Approved during deterministic demo seed" },
        { expectedVersion: 1 },
      ),
    ),
  );

  await runCommand(boris, "create-activity:douala-bafoussam", {
    activityId: ids.bafoussamJourney,
    branchCode,
    activityTypeCode: "HAULAGE_JOB",
    templateCode: "TRUCKING",
    primarySegmentId: ids.bafoussamSegment,
    primaryAssetId: ids.vh001,
    startedAt: "2026-07-21T06:00:00Z",
    customerName: "Marché de Bafoussam",
    description: "Livraison Douala à Bafoussam",
  });
  await runCommand(boris, "record-movement-leg:douala-bafoussam", {
    legId: ids.bafoussamLeg,
    activityId: ids.bafoussamJourney,
    legNo: 1,
    segmentId: ids.bafoussamSegment,
    origin: { kind: "place", placeId: ids.garouaOrigin, name: "Douala" },
    destination: {
      kind: "place",
      placeId: ids.bafoussamDestination,
      name: "Bafoussam",
    },
    departedAt: "2026-07-21T06:00:00Z",
    arrivedAt: "2026-07-21T12:15:00Z",
    distanceKm: 295,
    loadState: "LADEN",
  });
  const bafoussam = await runCommand(
    boris,
    "close-activity:douala-bafoussam",
    {
      activityId: ids.bafoussamJourney,
      endedAt: "2026-07-21T12:15:00Z",
      note: "Closed with intentionally incomplete demo data",
    },
    { expectedVersion: 1 },
  );

  const yaounde = await runCommand(boris, "create-activity:douala-yaounde", {
    activityId: ids.yaoundeJourney,
    branchCode,
    activityTypeCode: "HAULAGE_JOB",
    templateCode: "TRUCKING",
    primarySegmentId: ids.yaoundeSegment,
    primaryAssetId: ids.vh003,
    startedAt: "2026-07-29T07:15:00Z",
    plannedEndAt: "2026-07-30T16:00:00Z",
    customerName: "Client Yaoundé",
    description: "Livraison en cours Douala à Yaoundé",
  });
  await runCommand(boris, "record-movement-leg:douala-yaounde", {
    legId: ids.yaoundeLeg,
    activityId: ids.yaoundeJourney,
    legNo: 1,
    segmentId: ids.yaoundeSegment,
    origin: { kind: "place", placeId: ids.garouaOrigin, name: "Douala" },
    destination: {
      kind: "place",
      placeId: ids.yaoundeDestination,
      name: "Yaoundé",
    },
    departedAt: "2026-07-29T07:15:00Z",
    distanceKm: 245,
    loadState: "LADEN",
  });

  const repair = await runCommand(sali, "record-expense:VH003:repair", {
    entryId: ids.repair,
    branchCode,
    categoryCode: "REPAIRS",
    economicDate: "2026-07-29",
    description: "Réparation en attente d’approbation — VH003",
    amountMinor: 450_000,
    paymentMethod: "CASH",
    sourceReference: "REP-VH003-001",
    postings: [{ assetId: ids.vh003, amountMinor: 450_000 }],
  });

  console.log(
    JSON.stringify(
      {
        workspace: {
          id: provisioned.workspaceId,
          slug: provisioned.workspaceSlug,
          branches: provisioned.branchCodes,
          idempotentReplay: provisioned.idempotentReplay,
        },
        users: users.map(({ pin, ...user }) => ({
          ...user,
          branchScope: "ALL",
          pin,
        })),
        summary: {
          assets: ["VH001", "VH003", "TR001"],
          journeys: [
            {
              route: "Douala → Garoua",
              asset: "VH003",
              status: "CLOSED",
              completeness: garoua.recordStatus,
            },
            {
              route: "Douala → Bafoussam",
              asset: "VH001",
              status: "CLOSED",
              completeness: bafoussam.recordStatus,
            },
            {
              route: "Douala → Yaoundé",
              asset: "VH003",
              status: "IN_PROGRESS",
              persistedStatus: yaounde.recordStatus,
            },
          ],
          garouaFinancials: {
            currency: "XAF",
            revenueMinor: 2_850_000,
            expenseMinor: 1_345_000,
            expenseStatusesBeforeApproval: expenseResults.map((result) => result.recordStatus),
            approvedEntryIds: [
              ids.garouaRevenue,
              ids.garouaFuel,
              ids.garouaAllowance,
            ],
          },
          pendingRepair: {
            asset: "VH003",
            amountMinor: 450_000,
            currency: "XAF",
            status: repair.recordStatus,
          },
        },
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await Promise.all([pool.end(), authPool.end()]);
}
