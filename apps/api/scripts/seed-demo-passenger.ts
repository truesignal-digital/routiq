import { and, asc, eq, isNull } from "drizzle-orm";
import { authDb } from "../src/db/client.js";
import * as schema from "../src/db/schema.js";
import { addDays } from "../src/reads/business-date.js";
import { demoKit, demoUtcOffset, type AddedMember, type DemoUser } from "./seed-demo-kit.js";

/**
 * The passenger demo company, beside the trucking one, so testers can try both
 * presets. Everything goes through the same commands an operator's team would
 * send, each as the member who would send it: the driver records fuel, the
 * cashier the ticket takings, Finance and Direction decide what waits for them.
 * Imported by seed-demo.ts, which seeds both workspaces in one run.
 */
const demoWorkspaceSlug = "littoral-voyages";
const kit = demoKit(demoWorkspaceSlug);
const { id, actor, runCommand, assetState, activityState, workOrderRowVersion } = kit;

const DLA = "DLA";
const YDE = "YDE";

const ids = {
  workspace: kit.workspaceId,
  branchDouala: id("branch:douala"),
  branchYaounde: id("branch:yaounde"),
  josiane: id("user:josiane"),
  paul: id("user:paul"),
  eric: id("user:eric"),
  aline: id("user:aline"),
  bertrand: id("user:bertrand"),
  grace: id("user:grace"),
  crewEric: id("person:eric-tchoua"),
  crewJoseph: id("person:joseph-mballa"),
  coach: id("asset:LV-CAR-01"),
  coaster: id("asset:LV-COA-02"),
  minibus: id("asset:LV-MIN-03"),
  placeDouala: id("place:douala"),
  placeYaounde: id("place:yaounde"),
  // The closed voyage: Douala → Yaoundé on the coach, two days back.
  closedVoyage: id("activity:voyage:closed"),
  closedSegment: id("segment:voyage:closed"),
  closedLeg: id("leg:voyage:closed"),
  closedCrew: id("crew:voyage:closed"),
  closedStartReading: id("reading:voyage:closed:start"),
  closedEndReading: id("reading:voyage:closed:end"),
  closedTickets: id("entry:voyage:closed:tickets"),
  closedFuel: id("entry:voyage:closed:fuel"),
  closedTolls: id("entry:voyage:closed:tolls"),
  // The voyage on the road today, on the Coaster.
  roadVoyage: id("activity:voyage:road"),
  roadSegment: id("segment:voyage:road"),
  roadLeg: id("leg:voyage:road"),
  roadCrew: id("crew:voyage:road"),
  roadStartReading: id("reading:voyage:road:start"),
  roadTickets: id("entry:voyage:road:tickets"),
  roadFuel: id("entry:voyage:road:fuel"),
  coachInsurance: id("entry:coach:insurance"),
  // Maintenance: a door seal noted, a steering fault grounding the minibus.
  coasterDoor: id("issue:coaster:door-seal"),
  minibusSteering: id("issue:minibus:steering"),
  minibusSteeringOrder: id("work-order:minibus:steering"),
  minibusIntakeReading: id("reading:minibus:workshop-intake"),
  minibusSteeringParts: id("entry:minibus:steering-parts"),
};

/** Provisioned with the workspace, all branches. Josiane is the first account, so DIRECTOR (ADR-0009). */
const users: DemoUser[] = [
  {
    id: ids.josiane,
    username: "josiane",
    displayName: "Josiane Ndongo",
    pin: "101010",
    role: "DIRECTOR",
  },
  {
    id: ids.paul,
    username: "paul",
    displayName: "Paul Essomba",
    pin: "202020",
    role: "ADMIN",
  },
  {
    id: ids.eric,
    username: "eric",
    displayName: "Éric Tchoua",
    pin: "303030",
    role: "DRIVER",
  },
];

const yaoundeBranch = { id: ids.branchYaounde, key: "yaounde", code: YDE, name: "Yaoundé" };

/** Added after provisioning through add-member, as the trucking demo does. Grace keeps the Douala ticket office. */
const addedMembers: AddedMember[] = [
  {
    id: ids.aline,
    username: "aline",
    displayName: "Aline Mbappe",
    pin: "404040",
    role: "FINANCE",
    branches: "ALL",
  },
  {
    id: ids.bertrand,
    username: "bertrand",
    displayName: "Bertrand Nkeng",
    pin: "505050",
    role: "TECHNICIAN",
    branches: "ALL",
  },
  {
    id: ids.grace,
    username: "grace",
    displayName: "Grace Ebode",
    pin: "606060",
    role: "CASHIER",
    branches: [{ id: ids.branchDouala, code: DLA }],
  },
];

const vehicles = [
  {
    key: "coach",
    assetId: ids.coach,
    assetCode: "LV-CAR-01",
    registrationNumber: "LT 731 CE",
    assetClassCode: "BUS",
    manufacturer: "Yutong",
    model: "ZK6122",
    modelYear: 2021,
    seatCount: 70,
    branchCode: DLA,
    commissionedAt: "2022-02-14T08:00:00+01:00",
  },
  {
    key: "coaster",
    assetId: ids.coaster,
    assetCode: "LV-COA-02",
    registrationNumber: "CE 214 LT",
    assetClassCode: "BUS",
    manufacturer: "Toyota",
    model: "Coaster",
    modelYear: 2019,
    seatCount: 30,
    branchCode: DLA,
    commissionedAt: "2020-06-01T08:00:00+01:00",
  },
  {
    key: "minibus",
    assetId: ids.minibus,
    assetCode: "LV-MIN-03",
    registrationNumber: "CE 908 YD",
    assetClassCode: "VAN",
    manufacturer: "Mercedes-Benz",
    model: "Sprinter 516",
    modelYear: 2018,
    seatCount: 22,
    branchCode: YDE,
    commissionedAt: "2021-11-08T08:00:00+01:00",
  },
] as const;

/** One fare on the Douala–Yaoundé line, in XAF (exponent 0: one franc, one minor unit). */
const FARE = 6_000;

/** The first dated command: its receipt anchors the story's "today". */
const storyAnchorOperation = "record-journey-sheet:voyage:closed";

/** What one vehicle shows after seeding, read back from the database. */
async function vehicleSummary(assetId: string) {
  const ws = ids.workspace;
  const { lifecycleStatus, registrationNumber } = await assetState(assetId);
  const [asset] = await authDb
    .select({ assetCode: schema.assets.assetCode, customValues: schema.assets.customValues })
    .from(schema.assets)
    .where(and(eq(schema.assets.workspaceId, ws), eq(schema.assets.id, assetId)));
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
  const issues = await authDb
    .select({
      category: schema.operationalIssues.category,
      safetyCritical: schema.operationalIssues.safetyCritical,
      status: schema.operationalIssues.status,
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
      status: schema.workOrders.status,
      expectedCostMinor: schema.workOrders.expectedCostMinor,
    })
    .from(schema.workOrders)
    .where(and(eq(schema.workOrders.workspaceId, ws), eq(schema.workOrders.assetId, assetId)))
    .orderBy(asc(schema.workOrders.id));
  return {
    assetCode: asset?.assetCode,
    registrationNumber,
    seatCount: (asset?.customValues as Record<string, unknown> | undefined)?.["seatCount"] ?? null,
    lifecycleStatus,
    groundedSince: openInterval?.openedAt.toISOString() ?? null,
    issues,
    workOrders: orders.map((order) => ({
      status: order.status,
      expectedCostMinor: order.expectedCostMinor?.toString() ?? null,
    })),
  };
}

/** Every money entry in the workspace, with the state the approval queues show. */
async function entriesSummary() {
  const rows = await authDb
    .select({
      direction: schema.financialEntries.direction,
      categoryCode: schema.categories.code,
      amountMinor: schema.financialEntries.amountMinor,
      status: schema.financialEntries.status,
      paymentReference: schema.financialEntries.paymentReference,
      description: schema.financialEntries.description,
    })
    .from(schema.financialEntries)
    .innerJoin(
      schema.categories,
      and(
        eq(schema.categories.workspaceId, schema.financialEntries.workspaceId),
        eq(schema.categories.id, schema.financialEntries.categoryId),
      ),
    )
    .where(eq(schema.financialEntries.workspaceId, ids.workspace))
    .orderBy(asc(schema.financialEntries.economicDate), asc(schema.financialEntries.description));
  return rows.map((row) => ({ ...row, amountMinor: row.amountMinor.toString() }));
}

export async function seedLittoralVoyages() {
  await kit.provisionOnce(
    {
      workspace: { id: ids.workspace, slug: demoWorkspaceSlug, name: "Littoral Voyages" },
      branches: [{ id: ids.branchDouala, code: DLA, name: "Douala" }],
      admin: {
        id: ids.josiane,
        displayName: "Josiane Ndongo",
        username: "josiane",
        pin: "101010",
      },
      users: users.slice(1).map((user) => ({ ...user, branchScope: "ALL" })),
      enabledPresets: ["PASSENGER_TRANSPORT"],
    },
    "provision-workspace",
  );
  await kit.ensureDirector(ids.josiane, "josiane");

  const josiane = await actor(ids.josiane);
  await kit.addBranchesAndMembers(josiane, [yaoundeBranch], addedMembers);

  const [paul, eric, aline, bertrand, grace] = await Promise.all([
    actor(ids.paul),
    actor(ids.eric),
    actor(ids.aline),
    actor(ids.bertrand),
    actor(ids.grace),
  ]);

  // The fleet. seatCount is the one field the passenger template requires.
  await Promise.all(
    vehicles.map((vehicle) =>
      runCommand(
        paul,
        `register-asset:${vehicle.key}`,
        {
          assetId: vehicle.assetId,
          assetCode: vehicle.assetCode,
          registrationNumber: vehicle.registrationNumber,
          assetClassCode: vehicle.assetClassCode,
          templateCode: "PASSENGER_TRANSPORT",
          branchCode: vehicle.branchCode,
          manufacturer: vehicle.manufacturer,
          model: vehicle.model,
          modelYear: vehicle.modelYear,
          customValues: { seatCount: vehicle.seatCount },
        },
        { version: 2 },
      ),
    ),
  );
  // One-way, so a re-seed that finds a vehicle already in service leaves it alone.
  for (const vehicle of vehicles) {
    const { lifecycleStatus, rowVersion } = await assetState(vehicle.assetId);
    if (lifecycleStatus !== "REGISTERED") continue;
    await runCommand(
      paul,
      `commission-asset:${vehicle.key}`,
      { assetId: vehicle.assetId, commissionedAt: vehicle.commissionedAt },
      { expectedVersion: rowVersion },
    );
  }

  await Promise.all([
    runCommand(paul, "register-person:eric-tchoua", {
      personId: ids.crewEric,
      displayName: "Éric Tchoua",
      personCode: "CHF001",
      branchCode: DLA,
      defaultRole: "DRIVER",
    }),
    runCommand(paul, "register-person:joseph-mballa", {
      personId: ids.crewJoseph,
      displayName: "Joseph Mballa",
      personCode: "CHF002",
      branchCode: DLA,
      defaultRole: "DRIVER",
    }),
  ]);

  const today = await kit.storyToday(storyAnchorOperation);
  const day = (offset: number) => addDays(today, offset);
  const at = (offset: number, time: string) => `${day(offset)}T${time}:00${demoUtcOffset}`;
  const douala = { kind: "place", placeId: ids.placeDouala, name: "Douala" } as const;
  const yaounde = { kind: "place", placeId: ids.placeYaounde, name: "Yaoundé" } as const;

  // ── The closed voyage ──────────────────────────────────────────────────────
  // Éric files the coach's sheet: readings, crew, the leg and the seats sold.
  // The money comes from the people who handle it, then Paul closes the trip.
  // No command links Éric's account to his Person yet, so the trip is his by
  // recording it: a driver spends only on his own trips (#592).
  await runCommand(eric, storyAnchorOperation, {
    activityId: ids.closedVoyage,
    branchCode: DLA,
    activityTypeCode: "SCHEDULED_JOURNEY",
    primarySegmentId: ids.closedSegment,
    primaryAssetId: ids.coach,
    startedAt: at(-2, "06:30"),
    endedAt: at(-2, "11:10"),
    description: "Départ 06h30 Douala → Yaoundé",
    seatsSold: 64,
    seatsAvailable: 70,
    startReading: {
      readingId: ids.closedStartReading,
      readingType: "ODOMETER",
      value: 412_380,
      observedAt: at(-2, "06:20"),
    },
    endReading: {
      readingId: ids.closedEndReading,
      readingType: "ODOMETER",
      value: 412_628,
      observedAt: at(-2, "11:15"),
    },
    crew: [{ activityPersonId: ids.closedCrew, personId: ids.crewEric, role: "DRIVER" }],
    legs: [
      {
        legId: ids.closedLeg,
        legNo: 1,
        segmentId: ids.closedSegment,
        origin: douala,
        destination: yaounde,
        departedAt: at(-2, "06:30"),
        arrivedAt: at(-2, "11:10"),
        distanceKm: 245,
        passengerCount: 64,
      },
    ],
  });

  // 64 tickets at the Douala counter, banked the same evening. Above the
  // cashier's 100,000 XAF band, so it waits for Finance, and Aline approves it.
  const closedTickets = await runCommand(grace, "record-revenue:voyage:closed:tickets", {
    entryId: ids.closedTickets,
    branchCode: DLA,
    categoryCode: "TICKET_REVENUE",
    economicDate: day(-2),
    description: "Billets — départ 06h30 Douala → Yaoundé (64 places)",
    amountMinor: 64 * FARE,
    paymentMethod: "BANK",
    paymentReference: "VERS-DLA-0612",
    postings: [{ assetId: ids.coach, activityId: ids.closedVoyage, amountMinor: 64 * FARE }],
  });
  if (closedTickets?.recordStatus === "SUBMITTED") {
    await runCommand(
      aline,
      "approve-entry:voyage:closed:tickets",
      { entryId: ids.closedTickets, note: "Versement vérifié sur le relevé" },
      { expectedVersion: closedTickets.rowVersion },
    );
  }

  // Under the band: both post as soon as Éric records them.
  await Promise.all([
    runCommand(eric, "record-expense:voyage:closed:fuel", {
      entryId: ids.closedFuel,
      branchCode: DLA,
      categoryCode: "FUEL",
      economicDate: day(-2),
      description: "Gasoil — départ 06h30 Douala → Yaoundé",
      counterpartyName: "Tradex Bonabéri",
      amountMinor: 92_400,
      paymentMethod: "OM",
      paymentReference: "OM-LV-58Q2K7",
      postings: [{ assetId: ids.coach, activityId: ids.closedVoyage, amountMinor: 92_400 }],
    }),
    runCommand(eric, "record-expense:voyage:closed:tolls", {
      entryId: ids.closedTolls,
      branchCode: DLA,
      categoryCode: "TOLLS",
      economicDate: day(-2),
      description: "Péages Edéa et Boumnyebel",
      amountMinor: 5_000,
      paymentMethod: "CASH",
      postings: [{ assetId: ids.coach, activityId: ids.closedVoyage, amountMinor: 5_000 }],
    }),
  ]);

  const closedState = await activityState(ids.closedVoyage);
  if (closedState.status === "OPEN") {
    await runCommand(
      paul,
      "close-activity:voyage:closed",
      { activityId: ids.closedVoyage, note: "Feuille de route complète" },
      { expectedVersion: closedState.rowVersion },
    );
  }

  // ── The voyage on the road ─────────────────────────────────────────────────
  // Éric starts his own departure, so the fuel he buys below is on his trip (#592).
  await runCommand(
    eric,
    "create-activity:voyage:road",
    {
      activityId: ids.roadVoyage,
      branchCode: DLA,
      activityTypeCode: "SCHEDULED_JOURNEY",
      templateCode: "PASSENGER_TRANSPORT",
      primarySegmentId: ids.roadSegment,
      primaryAssetId: ids.coaster,
      startedAt: at(0, "07:00"),
      plannedEndAt: at(0, "11:45"),
      description: "Départ 07h00 Douala → Yaoundé",
      startReading: {
        readingId: ids.roadStartReading,
        readingType: "ODOMETER",
        value: 186_040,
        observedAt: at(0, "06:50"),
      },
      crew: [{ activityPersonId: ids.roadCrew, personId: ids.crewEric, role: "DRIVER" }],
    },
    { clientOccurredAt: at(0, "06:55") },
  );
  await runCommand(paul, "record-movement-leg:voyage:road", {
    legId: ids.roadLeg,
    activityId: ids.roadVoyage,
    legNo: 1,
    segmentId: ids.roadSegment,
    origin: douala,
    destination: yaounde,
    departedAt: at(0, "07:00"),
    distanceKm: 245,
    passengerCount: 27,
  });

  // 27 seats paid by MTN MoMo: above the cashier's band, waiting for Finance.
  await runCommand(grace, "record-revenue:voyage:road:tickets", {
    entryId: ids.roadTickets,
    branchCode: DLA,
    categoryCode: "TICKET_REVENUE",
    economicDate: day(0),
    description: "Billets — départ 07h00 Douala → Yaoundé (27 places)",
    amountMinor: 27 * FARE,
    paymentMethod: "MOMO",
    paymentReference: "MOMO-LV-7731904",
    postings: [{ assetId: ids.coaster, activityId: ids.roadVoyage, amountMinor: 27 * FARE }],
  });

  // Cash fuel with no receipt and no payment reference: posts under the band,
  // and the entries list shows it with its receipt missing.
  await runCommand(eric, "record-expense:voyage:road:fuel", {
    entryId: ids.roadFuel,
    branchCode: DLA,
    categoryCode: "FUEL",
    economicDate: day(0),
    description: "Gasoil — départ 07h00 Douala → Yaoundé",
    amountMinor: 58_800,
    paymentMethod: "CASH",
    postings: [{ assetId: ids.coaster, activityId: ids.roadVoyage, amountMinor: 58_800 }],
  });

  // The coach's annual cover: above Finance's 1,000,000 XAF ceiling, so it
  // waits for Direction.
  await runCommand(paul, "record-expense:coach:insurance", {
    entryId: ids.coachInsurance,
    branchCode: DLA,
    categoryCode: "INSURANCE",
    economicDate: day(-5),
    description: "Assurance annuelle — Yutong LT 731 CE",
    counterpartyName: "Activa Assurances",
    amountMinor: 1_850_000,
    paymentMethod: "BANK",
    paymentReference: "VIR-ACTIVA-2611",
    postings: [{ assetId: ids.coach, amountMinor: 1_850_000 }],
  });

  // ── Maintenance ────────────────────────────────────────────────────────────
  // Noted, not planned: no work order yet.
  await runCommand(
    eric,
    "report-issue:coaster:door-seal",
    {
      issueId: ids.coasterDoor,
      assetId: ids.coaster,
      description: "Joint de porte passagers décollé : la pluie entre à la marche avant",
      safetyCritical: false,
      category: "BODYWORK",
    },
    { clientOccurredAt: at(-1, "18:30") },
  );

  // Safety-critical: grounds the minibus the moment it lands.
  await runCommand(
    eric,
    "report-issue:minibus:steering",
    {
      issueId: ids.minibusSteering,
      assetId: ids.minibus,
      description: "Jeu dans la direction et claquement du train avant sur le contournement de Yaoundé",
      safetyCritical: true,
      category: "STEERING",
    },
    { clientOccurredAt: at(-3, "16:20") },
  );

  // No amount bounds on create-work-order in the defaults, so the order lands
  // APPROVED; the approval stays in case a workspace's rules hold it.
  const steeringOrder = await runCommand(
    paul,
    "create-work-order:minibus:steering",
    {
      workOrderId: ids.minibusSteeringOrder,
      assetId: ids.minibus,
      issueId: ids.minibusSteering,
      description: "Remplacer les rotules de direction et contrôler le parallélisme",
      expectedCostMinor: 240_000,
    },
    { clientOccurredAt: at(-3, "17:40") },
  );
  if (steeringOrder?.recordStatus === "SUBMITTED") {
    await runCommand(
      josiane,
      "approve-work-order:minibus:steering",
      { workOrderId: ids.minibusSteeringOrder, note: "Sécurité d'abord : approuvé" },
      { expectedVersion: await workOrderRowVersion(ids.minibusSteeringOrder) },
    );
  }

  await runCommand(
    bertrand,
    "record-meter-reading:minibus:workshop-intake",
    {
      readingId: ids.minibusIntakeReading,
      assetId: ids.minibus,
      readingType: "ODOMETER",
      value: 264_515,
      observedAt: at(-2, "08:00"),
      source: "WORK_ORDER",
    },
    { clientOccurredAt: at(-2, "08:00") },
  );

  // The pending cost: above the workshop's band, so it waits for Finance.
  await runCommand(
    bertrand,
    "record-expense:minibus:steering-parts",
    {
      entryId: ids.minibusSteeringParts,
      branchCode: YDE,
      categoryCode: "REPAIRS",
      economicDate: day(-2),
      description: "Rotules de direction et main-d'œuvre — CE 908 YD",
      counterpartyName: "Garage Mvan Auto",
      amountMinor: 185_000,
      paymentMethod: "OM",
      paymentReference: "OM-LV-3J8W1M",
      postings: [
        { assetId: ids.minibus, workOrderId: ids.minibusSteeringOrder, amountMinor: 185_000 },
      ],
    },
    { clientOccurredAt: at(-2, "15:10") },
  );

  const closedAfter = await activityState(ids.closedVoyage);
  const roadAfter = await activityState(ids.roadVoyage);
  return {
    workspace: {
      id: ids.workspace,
      slug: demoWorkspaceSlug,
      branches: await kit.branchCodes(),
    },
    accounts: await kit.accountsSummary([...users, ...addedMembers]),
    storyDate: today,
    vehicles: await Promise.all(vehicles.map((vehicle) => vehicleSummary(vehicle.assetId))),
    voyages: [
      { route: "Douala → Yaoundé", asset: "LT 731 CE", ...closedAfter },
      { route: "Douala → Yaoundé", asset: "CE 214 LT", ...roadAfter },
    ],
    entries: await entriesSummary(),
  };
}
