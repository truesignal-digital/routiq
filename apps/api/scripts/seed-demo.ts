import "dotenv/config";
import { DOCUMENT_EXPIRING_WINDOW_DAYS } from "@routiq/contracts";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { authDb, authPool, pool } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { addDays } from "../src/reads/business-date.js";
import "../src/server.js";
import {
  demoKit,
  demoUtcOffset,
  type AddedMember,
  type DemoUser,
} from "./seed-demo-kit.js";
import { seedLittoralVoyages } from "./seed-demo-passenger.js";
import { assertResettable, DEMO_WORKSPACE_SLUGS } from "./seed-demo-slugs.js";

const demoWorkspaceSlug = "transports-ngwa";
const workspaceSlug = demoWorkspaceSlug;
const branchCode = "DLA";
const kit = demoKit(workspaceSlug);
const demoId = kit.id;
const {
  actor,
  runCommand,
  assetState,
  assetRowVersion,
  workOrderRowVersion,
} = kit;

const ids = {
  workspace: demoId("workspace"),
  branch: demoId("branch:douala"),
  branchYaounde: demoId("branch:yaounde"),
  branchBafoussam: demoId("branch:bafoussam"),
  emilienne: demoId("user:emilienne"),
  boris: demoId("user:boris"),
  sali: demoId("user:sali"),
  patrice: demoId("user:patrice"),
  herve: demoId("user:herve"),
  nadege: demoId("user:nadege"),
  amadou: demoId("user:amadou"),
  clarisse: demoId("user:clarisse"),
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
  bafoussamFuel: demoId("entry:douala-bafoussam:fuel"),
  // The vehicle workspace story (#44): VH003 grounded, VH001 repaired.
  inspectionType: demoId("category:document-type:TECHNICAL_INSPECTION"),
  registrationType: demoId("category:document-type:REGISTRATION"),
  vh003Brakes: demoId("issue:VH003:brakes"),
  vh003BrakesOrder: demoId("work-order:VH003:brakes"),
  vh003BrakeParts: demoId("entry:VH003:brake-parts"),
  vh003IntakeReading: demoId("reading:VH003:workshop-intake"),
  vh003Bodywork: demoId("issue:VH003:bodywork"),
  vh003HandoverNote: demoId("note:VH003:handover"),
  vh003InspectionPrevious: demoId("document:VH003:inspection:previous"),
  vh003Inspection: demoId("document:VH003:inspection"),
  vh003Insurance: demoId("document:VH003:insurance"),
  vh003Permit: demoId("document:VH003:permit"),
  vh003Registration: demoId("document:VH003:registration"),
  vh001AirCon: demoId("issue:VH001:air-conditioning"),
  vh001AirConOrder: demoId("work-order:VH001:air-conditioning"),
  vh001AirConCost: demoId("entry:VH001:air-conditioning"),
};

/**
 * Provisioned with the workspace; all three see every branch. Émilienne is the
 * provisioned first account, so she is the workspace's DIRECTOR (ADR-0009).
 */
const users: DemoUser[] = [
  {
    id: ids.emilienne,
    username: "emilienne",
    displayName: "Émilienne",
    pin: "111111",
    role: "DIRECTOR",
  },
  {
    id: ids.boris,
    username: "boris",
    displayName: "Boris",
    pin: "222222",
    role: "ADMIN",
  },
  {
    id: ids.sali,
    username: "sali",
    displayName: "Sali",
    pin: "333333",
    role: "DRIVER",
  },
];

/**
 * The two branches Douala did not open with, and the members added below. All
 * of them arrive after provisioning rather than inside it: the provision
 * payload is frozen behind its idempotency key (see the `.v2` note below), so
 * anything the demo gains from here on has to come through the day-2 commands —
 * which is also the truer demo, since opening an agency and hiring a mechanic
 * are things an operator does on a Tuesday, not at signup.
 */
const yaoundeBranch = { id: ids.branchYaounde, key: "yaounde", code: "YDE", name: "Yaoundé" };
const bafoussamBranch = {
  id: ids.branchBafoussam,
  key: "bafoussam",
  code: "BAF",
  name: "Bafoussam",
};
const extraBranches = [yaoundeBranch, bafoussamBranch];

/**
 * Members added after provisioning, one for every role the three provisioned
 * users leave without a login. Patrice and Amadou are scoped to Yaoundé alone,
 * so the demo has a branch-scoped driver and a branch-scoped Administrateur to
 * set beside the ALL-scope ones; Clarisse keeps the Douala till.
 */
const addedMembers: AddedMember[] = [
  {
    id: ids.patrice,
    username: "patrice",
    displayName: "Patrice",
    pin: "444444",
    role: "DRIVER",
    branches: [yaoundeBranch],
  },
  {
    id: ids.herve,
    username: "herve",
    displayName: "Hervé Mbarga",
    pin: "666666",
    role: "TECHNICIAN",
    branches: "ALL",
  },
  {
    id: ids.nadege,
    username: "nadege",
    displayName: "Nadège Fotso",
    pin: "777777",
    role: "FINANCE",
    branches: "ALL",
  },
  {
    id: ids.amadou,
    username: "amadou",
    displayName: "Amadou Bello",
    pin: "555555",
    role: "ADMIN",
    branches: [yaoundeBranch],
  },
  {
    id: ids.clarisse,
    username: "clarisse",
    displayName: "Clarisse Ewane",
    pin: "888888",
    role: "CASHIER",
    branches: [{ id: ids.branch, code: branchCode }],
  },
];

async function resetDemoWorkspace(slug: string): Promise<boolean> {
  assertResettable(slug);

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
    // Posted lines are append-only for every role (0034): one trigger refuses
    // the delete, and the deferred balance check would fail at COMMIT once the
    // entry is gone too. Only the table owner may switch them off, and only
    // inside this transaction: they are back on before it commits, so no other
    // session ever sees them disabled, and the lock ALTER TABLE takes keeps
    // other writers out of financial_postings until then.
    await tx.execute(sql`
      ALTER TABLE financial_postings
        DISABLE TRIGGER financial_postings_pending_delete,
        DISABLE TRIGGER financial_postings_balance_on_delete
    `);
    await tx
      .delete(schema.financialPostings)
      .where(eq(schema.financialPostings.workspaceId, workspace.id));
    await tx.execute(sql`
      ALTER TABLE financial_postings
        ENABLE TRIGGER financial_postings_pending_delete,
        ENABLE TRIGGER financial_postings_balance_on_delete
    `);
    await tx
      .delete(schema.noteAcknowledgements)
      .where(eq(schema.noteAcknowledgements.workspaceId, workspace.id));
    await tx
      .delete(schema.notes)
      .where(eq(schema.notes.workspaceId, workspace.id));
    await tx
      .delete(schema.approvalRuleAcknowledgements)
      .where(eq(schema.approvalRuleAcknowledgements.workspaceId, workspace.id));
    await tx
      .delete(schema.approvalRuleChanges)
      .where(eq(schema.approvalRuleChanges.workspaceId, workspace.id));
    await tx
      .delete(schema.assetAvailabilityIntervals)
      .where(eq(schema.assetAvailabilityIntervals.workspaceId, workspace.id));
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
    // After postings (which cite work orders) and availability intervals
    // (which cite the signalement that opened them).
    await tx
      .delete(schema.workOrders)
      .where(eq(schema.workOrders.workspaceId, workspace.id));
    await tx
      .delete(schema.operationalIssues)
      .where(eq(schema.operationalIssues.workspaceId, workspace.id));
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

/** The command whose receipt dates the vehicle workspace story. */
const storyAnchorOperation = "report-issue:VH003:brakes";

/** What the vehicle workspace shows for one truck, read back after seeding. */
async function vehicleSummary(assetId: string, today: string) {
  const ws = ids.workspace;
  const { lifecycleStatus, registrationNumber } = await assetState(assetId);
  const [openInterval] = await authDb
    .select({ openedAt: schema.assetAvailabilityIntervals.openedAt })
    .from(schema.assetAvailabilityIntervals)
    .where(
      and(
        eq(schema.assetAvailabilityIntervals.workspaceId, ws),
        eq(schema.assetAvailabilityIntervals.assetId, assetId),
        isNull(schema.assetAvailabilityIntervals.closedAt),
      ),
    );
  const [custodian] = await authDb
    .select({ displayName: schema.principals.displayName })
    .from(schema.assets)
    .innerJoin(schema.memberships, eq(schema.memberships.id, schema.assets.custodianMembershipId))
    .innerJoin(schema.principals, eq(schema.principals.id, schema.memberships.principalId))
    .where(and(eq(schema.assets.workspaceId, ws), eq(schema.assets.id, assetId)));
  const issues = await authDb
    .select({
      category: schema.operationalIssues.category,
      safetyCritical: schema.operationalIssues.safetyCritical,
      status: schema.operationalIssues.status,
      reportedAt: schema.operationalIssues.reportedAt,
    })
    .from(schema.operationalIssues)
    .where(
      and(
        eq(schema.operationalIssues.workspaceId, ws),
        eq(schema.operationalIssues.assetId, assetId),
      ),
    )
    .orderBy(asc(schema.operationalIssues.reportedAt));
  const orders = await authDb
    .select({
      id: schema.workOrders.id,
      description: schema.workOrders.description,
      status: schema.workOrders.status,
      expectedCostMinor: schema.workOrders.expectedCostMinor,
      declaredCostMinor: schema.workOrders.declaredCostMinor,
      costOutcome: schema.workOrders.costOutcome,
    })
    .from(schema.workOrders)
    .where(and(eq(schema.workOrders.workspaceId, ws), eq(schema.workOrders.assetId, assetId)))
    .orderBy(asc(schema.workOrders.description), asc(schema.workOrders.id));
  const costLines =
    orders.length === 0
      ? []
      : await authDb
          .select({
            workOrderId: schema.financialPostings.workOrderId,
            amountMinor: schema.financialPostings.amountMinor,
            status: schema.financialEntries.status,
          })
          .from(schema.financialPostings)
          .innerJoin(
            schema.financialEntries,
            and(
              eq(schema.financialEntries.workspaceId, schema.financialPostings.workspaceId),
              eq(schema.financialEntries.id, schema.financialPostings.financialEntryId),
            ),
          )
          .where(
            and(
              eq(schema.financialPostings.workspaceId, ws),
              inArray(
                schema.financialPostings.workOrderId,
                orders.map((order) => order.id),
              ),
            ),
          )
          .orderBy(asc(schema.financialEntries.entryNumber), asc(schema.financialPostings.id));
  const pending = await authDb
    .select({
      amountMinor: schema.financialPostings.amountMinor,
      description: schema.financialEntries.description,
    })
    .from(schema.financialPostings)
    .innerJoin(
      schema.financialEntries,
      and(
        eq(schema.financialEntries.workspaceId, schema.financialPostings.workspaceId),
        eq(schema.financialEntries.id, schema.financialPostings.financialEntryId),
      ),
    )
    .where(
      and(
        eq(schema.financialPostings.workspaceId, ws),
        eq(schema.financialPostings.assetId, assetId),
        eq(schema.financialEntries.status, "SUBMITTED"),
      ),
    )
    .orderBy(asc(schema.financialEntries.entryNumber), asc(schema.financialPostings.id));
  const documents = await authDb
    .select({
      id: schema.documents.id,
      type: schema.documents.documentTypeCode,
      expiresAt: schema.documents.expiresAt,
      supersedesDocumentId: schema.documents.supersedesDocumentId,
    })
    .from(schema.documents)
    .where(and(eq(schema.documents.workspaceId, ws), eq(schema.documents.assetId, assetId)))
    .orderBy(asc(schema.documents.documentTypeCode), asc(schema.documents.id));
  const superseded = new Set(documents.map((doc) => doc.supersedesDocumentId));

  return {
    registrationNumber,
    lifecycleStatus,
    groundedSince: openInterval?.openedAt.toISOString() ?? null,
    custodian: custodian?.displayName ?? null,
    issues: issues.map((issue) => ({
      ...issue,
      reportedAt: issue.reportedAt.toISOString(),
    })),
    workOrders: orders.map((order) => ({
      description: order.description,
      status: order.status,
      expectedCostMinor: order.expectedCostMinor?.toString() ?? null,
      declaredCostMinor: order.declaredCostMinor?.toString() ?? null,
      costOutcome: order.costOutcome,
      costLines: costLines
        .filter((line) => line.workOrderId === order.id)
        .map((line) => ({ amountMinor: line.amountMinor.toString(), status: line.status })),
    })),
    pendingEntries: pending.map((entry) => ({
      amountMinor: entry.amountMinor.toString(),
      description: entry.description,
    })),
    pendingAmountMinor: pending
      .reduce((sum, entry) => sum + entry.amountMinor, 0n)
      .toString(),
    currentDocuments: documents
      .filter((doc) => !superseded.has(doc.id))
      .map((doc) => ({
        type: doc.type,
        expiresAt: doc.expiresAt,
        state:
          doc.expiresAt === null
            ? "NO_EXPIRY"
            : doc.expiresAt < today
              ? "EXPIRED"
              : doc.expiresAt <= addDays(today, DOCUMENT_EXPIRING_WINDOW_DAYS)
                ? "EXPIRING"
                : "VALID",
      }))
      .sort((left, right) => left.type.localeCompare(right.type)),
  };
}

/**
 * The trucking company. Its provisioning key is versioned on this one command:
 * provisioning changed shape (issue #20, then ADR-0009's roles), and reusing a
 * key across a shape change is a 409 rather than a replay. Every other seed
 * command keeps its key, or a re-seed would write its records a second time.
 */
async function seedTransportsNgwa() {
  await kit.provisionOnce(
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
    "provision-workspace.v3",
  );
  await kit.ensureDirector(ids.emilienne, "emilienne");

  const [emilienne, boris, sali] = await Promise.all([
    actor(ids.emilienne),
    actor(ids.boris),
    actor(ids.sali),
  ]);

  // Through the commands rather than the provisioning payload, which is frozen
  // behind its key.
  await kit.addBranchesAndMembers(emilienne, extraBranches, addedMembers);

  const [herve, nadege] = await Promise.all([actor(ids.herve), actor(ids.nadege)]);

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
      registrationNumber: "LT 482 AB",
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

  // Only register-asset sets a plate, so a workspace registered before the
  // plate joined its payload keeps VH003 blank until a `--reset`.
  if ((await assetState(ids.vh003)).registrationNumber === null) {
    console.warn("VH003 has no registration number: re-seed with --reset to give it LT 482 AB.");
  }

  // In service long before the July trips. The transition is one-way, so a
  // re-seed that finds a truck already commissioned leaves it alone.
  for (const truck of [
    { code: "VH003", assetId: ids.vh003, commissionedAt: "2019-03-18T08:00:00+01:00" },
    { code: "VH001", assetId: ids.vh001, commissionedAt: "2021-09-06T08:00:00+01:00" },
  ]) {
    const { lifecycleStatus, rowVersion } = await assetState(truck.assetId);
    if (lifecycleStatus !== "REGISTERED") continue;
    await runCommand(
      emilienne,
      `commission-asset:${truck.code}`,
      { assetId: truck.assetId, commissionedAt: truck.commissionedAt },
      { expectedVersion: rowVersion },
    );
  }

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

  // Boris is an Administrateur since ADR-0009, and an ADMIN's entries post at
  // any amount, so only what is still waiting is approved here.
  const garouaWaiting = await authDb
    .select({ id: schema.financialEntries.id })
    .from(schema.financialEntries)
    .where(
      and(
        inArray(schema.financialEntries.id, [ids.garouaRevenue, ids.garouaFuel, ids.garouaAllowance]),
        eq(schema.financialEntries.status, "SUBMITTED"),
      ),
    );
  await Promise.all(
    garouaWaiting.map(({ id: entryId }) =>
      runCommand(
        emilienne,
        `approve-entry:${entryId}`,
        { entryId, note: "Approved during deterministic demo seed" },
        { expectedVersion: 1 },
      ),
    ),
  );

  // Sali logs the run herself: she books its fuel below, and a driver puts
  // money only on her own trips (#592).
  await runCommand(sali, "create-activity:douala-bafoussam", {
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

  // ── The vehicle workspace story (#44) ─────────────────────────────────────
  //
  // Everything below is added, never rewritten: the Garoua figures above are
  // what the recorded demos show. Each step goes through its command as the
  // member who would do it in the yard, and dates hang off `today` (see
  // storyToday) so the story reads the same on the day it is shown.
  const today = await kit.storyToday(storyAnchorOperation);
  const day = (offset: number) => addDays(today, offset);
  const at = (offset: number, time: string) => `${day(offset)}T${time}:00${demoUtcOffset}`;

  // VH003: a safety-critical signalement grounds the truck the moment it lands.
  await runCommand(
    sali,
    storyAnchorOperation,
    {
      issueId: ids.vh003Brakes,
      assetId: ids.vh003,
      description: "Brake pressure warning on the Kekem descent",
      safetyCritical: true,
      category: "BRAKES",
    },
    { clientOccurredAt: at(-3, "15:40") },
  );

  // No amount bounds on create-work-order in the catalog defaults, so the
  // order lands APPROVED. The approval step stays in case a workspace's rules
  // hold it for review: then the finance approver authorizes the spend.
  const brakesOrder = await runCommand(
    boris,
    "create-work-order:VH003:brakes",
    {
      workOrderId: ids.vh003BrakesOrder,
      assetId: ids.vh003,
      issueId: ids.vh003Brakes,
      description: "Brake repair: replace pads and air valve, bleed the circuit",
      expectedCostMinor: 450_000,
    },
    { clientOccurredAt: at(-3, "17:05") },
  );
  if (brakesOrder?.recordStatus === "SUBMITTED") {
    // Boris opened the order, so the approval is Émilienne's: nobody approves
    // what they submitted.
    await runCommand(
      emilienne,
      "approve-work-order:VH003:brakes",
      { workOrderId: ids.vh003BrakesOrder, note: "Brakes first: approved as quoted" },
      { expectedVersion: await workOrderRowVersion(ids.vh003BrakesOrder) },
    );
  }

  await runCommand(
    herve,
    "record-meter-reading:VH003:workshop-intake",
    {
      readingId: ids.vh003IntakeReading,
      assetId: ids.vh003,
      readingType: "ODOMETER",
      value: 186_112,
      observedAt: at(-2, "08:10"),
      source: "WORK_ORDER",
    },
    { clientOccurredAt: at(-2, "08:10") },
  );

  // Above the workshop's 100,000 XAF band, so it waits for the finance
  // approver. No receipt: an artifact needs object storage, which a seed
  // cannot count on, so its evidence reads "not supplied".
  await runCommand(
    herve,
    "record-expense:VH003:brake-parts",
    {
      entryId: ids.vh003BrakeParts,
      branchCode,
      categoryCode: "REPAIRS",
      economicDate: day(-2),
      description: "Brake parts: pads, air valve and hoses",
      counterpartyName: "Pièces Poids Lourds Akwa",
      amountMinor: 310_000,
      paymentMethod: "CASH",
      postings: [
        { assetId: ids.vh003, workOrderId: ids.vh003BrakesOrder, amountMinor: 310_000 },
      ],
    },
    { clientOccurredAt: at(-2, "11:30") },
  );

  // A second problem, not safety-critical: the truck is already down, and
  // this one is noted without a work order.
  await runCommand(
    sali,
    "report-issue:VH003:bodywork",
    {
      issueId: ids.vh003Bodywork,
      assetId: ids.vh003,
      description: "Rear mudguard cracked and loose on its bracket",
      safetyCritical: false,
      category: "BODYWORK",
    },
    { clientOccurredAt: at(-1, "10:20") },
  );

  await runCommand(
    boris,
    "assign-asset:VH003:custodian",
    { assetId: ids.vh003, custodianMembershipId: sali.membershipId },
    {
      expectedVersion: await assetRowVersion(ids.vh003),
      clientOccurredAt: at(-1, "09:00"),
    },
  );
  await runCommand(
    boris,
    "add-note:VH003:handover",
    {
      noteId: ids.vh003HandoverNote,
      entityType: "asset",
      entityId: ids.vh003,
      body: "Assigned driver handover checked: tools and spare wheel on board",
    },
    { clientOccurredAt: at(-1, "09:05") },
  );

  // VH003's papers, one in each state the documents tab distinguishes. The
  // core pack types only insurance and permits, so the workspace adds the two
  // other types it files, as an operator would from the categories screen.
  await Promise.all([
    runCommand(emilienne, "create-category:TECHNICAL_INSPECTION", {
      id: ids.inspectionType,
      kind: "DOCUMENT_TYPE",
      code: "TECHNICAL_INSPECTION",
      labelFr: "Visite technique",
      labelEn: "Technical inspection",
    }),
    runCommand(emilienne, "create-category:REGISTRATION", {
      id: ids.registrationType,
      kind: "DOCUMENT_TYPE",
      code: "REGISTRATION",
      labelFr: "Carte grise",
      labelEn: "Registration",
    }),
  ]);
  await runCommand(boris, "add-or-renew-document:VH003:inspection:previous", {
    documentId: ids.vh003InspectionPrevious,
    assetId: ids.vh003,
    documentTypeCode: "TECHNICAL_INSPECTION",
    documentNumber: "VT-DLA-20417",
    issuedAt: day(-366),
    expiresAt: day(-184),
  });
  await Promise.all([
    // Renewed on time six months ago, and now lapsed: expired three days ago.
    runCommand(boris, "add-or-renew-document:VH003:inspection", {
      documentId: ids.vh003Inspection,
      assetId: ids.vh003,
      documentTypeCode: "TECHNICAL_INSPECTION",
      documentNumber: "VT-DLA-23981",
      issuedAt: day(-185),
      expiresAt: day(-3),
      supersedesDocumentId: ids.vh003InspectionPrevious,
    }),
    runCommand(boris, "add-or-renew-document:VH003:insurance", {
      documentId: ids.vh003Insurance,
      assetId: ids.vh003,
      documentTypeCode: "INSURANCE",
      documentNumber: "POL-448210",
      issuedAt: day(-353),
      expiresAt: day(12),
    }),
    runCommand(boris, "add-or-renew-document:VH003:permit", {
      documentId: ids.vh003Permit,
      assetId: ids.vh003,
      documentTypeCode: "PERMIT",
      documentNumber: "LT-DLA-0917",
      issuedAt: day(-330),
      expiresAt: day(400),
    }),
    runCommand(boris, "add-or-renew-document:VH003:registration", {
      documentId: ids.vh003Registration,
      assetId: ids.vh003,
      documentTypeCode: "REGISTRATION",
      documentNumber: "CG-LT-2019-04821",
      issuedAt: "2019-03-12",
    }),
  ]);

  // VH001: finished work a month back, paid by Orange Money, so its evidence
  // is the payment reference. Under the workshop's band, so it posts at once.
  await runCommand(
    sali,
    "report-issue:VH001:air-conditioning",
    {
      issueId: ids.vh001AirCon,
      assetId: ids.vh001,
      description: "Cab air conditioning blows warm air",
      safetyCritical: false,
      category: "OTHER",
    },
    { clientOccurredAt: at(-33, "09:15") },
  );
  await runCommand(
    boris,
    "create-work-order:VH001:air-conditioning",
    {
      workOrderId: ids.vh001AirConOrder,
      assetId: ids.vh001,
      issueId: ids.vh001AirCon,
      description: "A/C recharge and leak check",
      expectedCostMinor: 85_000,
    },
    { clientOccurredAt: at(-32, "08:30") },
  );
  await runCommand(
    herve,
    "record-expense:VH001:air-conditioning",
    {
      entryId: ids.vh001AirConCost,
      branchCode,
      categoryCode: "REPAIRS",
      economicDate: day(-30),
      description: "A/C recharge: refrigerant and labour",
      amountMinor: 85_000,
      paymentMethod: "OM",
      paymentReference: "OM-7T4K2Q9",
      postings: [
        { assetId: ids.vh001, workOrderId: ids.vh001AirConOrder, amountMinor: 85_000 },
      ],
    },
    { clientOccurredAt: at(-30, "15:10") },
  );
  // complete-work-order has no amount bounds in the catalog defaults, so a
  // completion always lands COMPLETED: a completion awaiting sign-off cannot be
  // seeded without changing the workspace's thresholds (DECISIONS 8). The
  // brake parts entry above is the "awaiting review" item instead.
  await runCommand(
    herve,
    "complete-work-order:VH001:air-conditioning",
    {
      workOrderId: ids.vh001AirConOrder,
      // The A/C cost is already in the books (the entry above): the close
      // declares it covered and adds no line (#81).
      costOutcome: "LINES",
      summary: "Recharged the A/C; no leak found",
    },
    {
      version: 2,
      expectedVersion: await workOrderRowVersion(ids.vh001AirConOrder),
      clientOccurredAt: at(-30, "16:30"),
    },
  );

  // Fuel on the Bafoussam run, recorded without a receipt: evidence missing.
  await runCommand(sali, "record-expense:douala-bafoussam:fuel", {
    entryId: ids.bafoussamFuel,
    branchCode,
    categoryCode: "FUEL",
    economicDate: "2026-07-21",
    description: "Fuel: Douala to Bafoussam",
    amountMinor: 86_000,
    paymentMethod: "CASH",
    postings: [
      { assetId: ids.vh001, activityId: ids.bafoussamJourney, amountMinor: 86_000 },
    ],
  });

  return {
    workspace: {
      id: ids.workspace,
      slug: workspaceSlug,
      // Read back rather than assembled from the payloads above, so the
      // line reports what the workspace has and not what was asked for.
      branches: await kit.branchCodes(),
    },
    accounts: await kit.accountsSummary([...users, ...addedMembers]),
    summary: {
      assets: ["VH001", "VH003", "TR001"],
      journeys: [
        {
          route: "Douala → Garoua",
          asset: "VH003",
          status: "CLOSED",
          completeness: garoua?.recordStatus ?? "already-seeded",
        },
        {
          route: "Douala → Bafoussam",
          asset: "VH001",
          status: "CLOSED",
          completeness: bafoussam?.recordStatus ?? "already-seeded",
        },
        {
          route: "Douala → Yaoundé",
          asset: "VH003",
          status: "IN_PROGRESS",
          persistedStatus: yaounde?.recordStatus ?? "already-seeded",
        },
      ],
      garouaFinancials: {
        currency: "XAF",
        revenueMinor: 2_850_000,
        expenseMinor: 1_345_000,
        expenseStatusesBeforeApproval: expenseResults.map(
          (result) => result?.recordStatus ?? "already-seeded",
        ),
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
        status: repair?.recordStatus ?? "already-seeded",
      },
    },
    vehicleWorkspace: {
      storyDate: today,
      VH003: await vehicleSummary(ids.vh003, today),
      VH001: await vehicleSummary(ids.vh001, today),
      notSeeded: [
        "A work order completion awaiting sign-off (COMPLETION_SUBMITTED): complete-work-order has no amount bounds in the default rules, so every completion lands COMPLETED.",
        "A receipt file: attaching one needs object storage; the brake parts entry is left with evidence not supplied.",
      ],
    },
  };
}

try {
  if (process.argv.includes("--reset")) {
    for (const slug of DEMO_WORKSPACE_SLUGS) {
      const deleted = await resetDemoWorkspace(slug);
      console.log(
        deleted
          ? `Reset: deleted existing workspace ${slug}`
          : `Reset: no existing workspace ${slug} to delete`,
      );
    }
  }

  // One JSON document, keyed by workspace slug, after everything is seeded.
  const summary = {
    [workspaceSlug]: await seedTransportsNgwa(),
    "littoral-voyages": await seedLittoralVoyages(),
  };
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await Promise.all([pool.end(), authPool.end()]);
}
