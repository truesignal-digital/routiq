import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { z } from "zod";
import {
  ACTIVITY_MISSING_FILTERS,
  activityCompleteness,
  activityStatus,
  ASSET_AVAILABILITY_FILTERS,
  financialEntryFilters,
  issueStatus,
  VEHICLE_HISTORY_KINDS,
  workOrderStatus,
} from "@routiq/contracts";
import { sessionStore } from "./auth/store.js";
import { LoginScreen } from "./screens/LoginScreen.js";
import { PANEL_PATTERN } from "./vehicle/model.js";
import { queryClient } from "./lib/query-client.js";
import { FLEET_DOCUMENT_FILTERS } from "./overview/fleet-documents.js";
import { ScreenError, ScreenPending, SectionError, SectionPending } from "./shell/RoutePending.js";
import { lazyScreen, retryFailedScreens } from "./shell/lazy-screen.js";

/**
 * Every screen but sign-in loads on demand, so the first page a phone opens
 * carries only the login screen (#480). Route definitions stay here: redirects
 * and search validation run before a screen's code arrives.
 */
const AssetRegisterScreen = lazyScreen(() => import("./screens/AssetRegisterScreen.js"), "AssetRegisterScreen");
// The Trucks page's frame, its Overview and its list load as one chunk, like
// the Money tabs (#664); the Documents tab is the Documents module's own file.
const TrucksFrame = lazyScreen(() => import("./assets/TrucksPage.js"), "TrucksFrame");
const TrucksOverview = lazyScreen(() => import("./assets/TrucksPage.js"), "TrucksOverview");
const AssetsStub = lazyScreen(() => import("./assets/TrucksPage.js"), "AssetsStub");
const FleetDocumentsTab = lazyScreen(() => import("./documents/FleetDocumentsTab.js"), "FleetDocumentsTab");
const BranchesScreen = lazyScreen(() => import("./screens/BranchesScreen.js"), "BranchesScreen");
const CompanySettingsScreen = lazyScreen(() => import("./screens/CompanySettingsScreen.js"), "CompanySettingsScreen");
const DashboardScreen = lazyScreen(() => import("./screens/DashboardScreen.js"), "DashboardScreen");
const MySettingsScreen = lazyScreen(() => import("./screens/MySettingsScreen.js"), "MySettingsScreen");
const PersonsScreen = lazyScreen(() => import("./screens/PersonsScreen.js"), "PersonsScreen");
const UsersScreen = lazyScreen(() => import("./screens/UsersScreen.js"), "UsersScreen");
const FinanceRecordScreen = lazyScreen(() => import("./screens/FinancePage.js"), "FinanceRecordScreen");
const FinanceEntriesScreen = lazyScreen(() => import("./screens/FinancePage.js"), "FinanceEntriesScreen");
const FinanceScreen = lazyScreen(() => import("./screens/FinancePage.js"), "FinanceScreen");
const FinanceOverviewScreen = lazyScreen(() => import("./screens/FinancePage.js"), "FinanceOverviewScreen");
const FinanceApproveScreen = lazyScreen(() => import("./screens/FinancePage.js"), "FinanceApproveScreen");
const TripsFrame = lazyScreen(() => import("./activities/TripsPage.js"), "TripsFrame");
const TripsOverview = lazyScreen(() => import("./activities/TripsPage.js"), "TripsOverview");
const ActivitiesScreen = lazyScreen(() => import("./activities/TripsPage.js"), "ActivitiesScreen");
const PlanningTab = lazyScreen(() => import("./scheduling/PlanningTab.js"), "PlanningTab");
const MaintenanceScreen = lazyScreen(() => import("./screens/MaintenanceScreen.js"), "MaintenanceScreen");
const ActivityDetailScreen = lazyScreen(() => import("./screens/ActivityDetailScreen.js"), "ActivityDetailScreen");
const ActivitySheetScreen = lazyScreen(() => import("./screens/ActivitySheetScreen.js"), "ActivitySheetScreen");
const FinanceEntryDetailScreen = lazyScreen(() => import("./screens/FinanceEntryDetailScreen.js"), "FinanceEntryDetailScreen");
const FinancePeriodsScreen = lazyScreen(() => import("./screens/FinancePeriodsScreen.js"), "FinancePeriodsScreen");
// The shell arrives with the installed module manifests (`modules/app-shell.ts`): sign-in needs neither.
const AppShell = lazyScreen(() => import("./modules/app-shell.js"), "AppShell");
// On demand like the shell: the sign-in page carries neither (#495).
const ShellPending = lazyScreen(() => import("./shell/ShellPending.js"), "ShellPending");
const VehicleWorkspaceScreen = lazyScreen(() => import("./vehicle/VehicleWorkspaceScreen.js"), "VehicleWorkspaceScreen");
const DetailsTab = lazyScreen(() => import("./vehicle/tabs/DetailsTab.js"), "DetailsTab");
const DocumentsTab = lazyScreen(() => import("./vehicle/tabs/DocumentsTab.js"), "DocumentsTab");
const HistoryTab = lazyScreen(() => import("./vehicle/tabs/HistoryTab.js"), "HistoryTab");
const MaintenanceTab = lazyScreen(() => import("./vehicle/tabs/MaintenanceTab.js"), "MaintenanceTab");
const MoneyTab = lazyScreen(() => import("./vehicle/tabs/MoneyTab.js"), "MoneyTab");
const NowTab = lazyScreen(() => import("./vehicle/tabs/NowTab.js"), "NowTab");
const TripsTab = lazyScreen(() => import("./vehicle/tabs/TripsTab.js"), "TripsTab");

/** What every route's loader receives: the one Query cache the screens read too. */
export interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()();

/** The page's own address, not one of its tabs: where an old filtered link used to land. */
function isBarePath(pathname: string, path: string): boolean {
  return pathname === path || pathname === `${path}/`;
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: () => {
    if (sessionStore.getActive()) throw redirect({ to: "/" });
  },
  component: LoginScreen,
});

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: ({ location }) => {
    if (!sessionStore.getActive()) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  loader: ({ context, location }) =>
    import("./shell/shell-loader.js").then(({ loadShell }) => loadShell(context.queryClient, location.href)),
  // The frame shows at once, sized like the shell, so the shell replaces it
  // without moving anything (#495); waiting on a timer would leave a blank page.
  pendingComponent: ShellPending,
  pendingMs: 0,
  pendingMinMs: 0,
  component: AppShell,
});

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
  component: DashboardScreen,
});

/**
 * The Trucks page (#665): one header over Overview, Trucks and Documents, each
 * tab a child route with its own address. The truck's own page and the
 * register form sit outside the frame.
 */
const assetsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/assets",
  // The list's tiles moved into the Overview: an old `/assets?status=…` link
  // lands on the Trucks tab with the same filter.
  beforeLoad: ({ location }) => {
    const search = location.search as { status?: unknown };
    if (isBarePath(location.pathname, "/assets") && (search.status === "IN_SERVICE" || search.status === "ATTENTION")) {
      throw redirect({ to: "/assets/list", search: { status: search.status }, replace: true });
    }
  },
  component: TrucksFrame,
});

const assetsOverviewRoute = createRoute({
  getParentRoute: () => assetsRoute,
  path: "/",
  component: TrucksOverview,
  pendingComponent: SectionPending,
  errorComponent: SectionError,
});

const assetsListRoute = createRoute({
  getParentRoute: () => assetsRoute,
  path: "list",
  // The Overview's tiles filter the list through the URL, so a tile's view is
  // a link that survives reload and back (#302).
  validateSearch: z.object({
    status: z.enum(["IN_SERVICE", "ATTENTION"]).optional().catch(undefined),
    availability: z.enum(ASSET_AVAILABILITY_FILTERS).optional().catch(undefined),
  }),
  component: AssetsStub,
  pendingComponent: SectionPending,
  errorComponent: SectionError,
});

// The Documents module's tab on the Trucks page (`PAGE_TABS`).
const assetsDocumentsRoute = createRoute({
  getParentRoute: () => assetsRoute,
  path: "documents",
  validateSearch: z.object({
    expiry: z.enum(FLEET_DOCUMENT_FILTERS).optional().catch(undefined),
  }),
  component: FleetDocumentsTab,
  pendingComponent: SectionPending,
  errorComponent: SectionError,
});

const assetsNewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/assets/new",
  component: AssetRegisterScreen,
});

/**
 * The vehicle workspace: the page is the vehicle, its sections are child
 * routes, and everything a link should reproduce lives in the URL — the record
 * open in the panel and the month the money is read for. An invalid value is
 * dropped rather than failing the page.
 */
const assetDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/assets/$assetId",
  validateSearch: z.object({
    panel: z.string().regex(PANEL_PATTERN).optional().catch(undefined),
    period: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .optional()
      .catch(undefined),
  }),
  component: VehicleWorkspaceScreen,
});

const vehicleNowRoute = createRoute({
  getParentRoute: () => assetDetailRoute,
  path: "/",
  component: NowTab,
  pendingComponent: SectionPending,
  errorComponent: SectionError,
});

const vehicleMaintenanceRoute = createRoute({
  getParentRoute: () => assetDetailRoute,
  path: "maintenance",
  component: MaintenanceTab,
  pendingComponent: SectionPending,
  errorComponent: SectionError,
});

const vehicleMoneyRoute = createRoute({
  getParentRoute: () => assetDetailRoute,
  path: "money",
  validateSearch: z.object({
    entries: z.enum(["posted", "review", "rejected"]).optional().catch(undefined),
    direction: z.enum(["EXPENSE", "REVENUE"]).optional().catch(undefined),
    evidence: z.literal("missing").optional().catch(undefined),
  }),
  component: MoneyTab,
  pendingComponent: SectionPending,
  errorComponent: SectionError,
});

const vehicleTripsRoute = createRoute({
  getParentRoute: () => assetDetailRoute,
  path: "trips",
  component: TripsTab,
  pendingComponent: SectionPending,
  errorComponent: SectionError,
});

// The old asset documents screen lived at this same URL, so its links and its
// route id keep working as the Documents section.
const vehicleDocumentsRoute = createRoute({
  getParentRoute: () => assetDetailRoute,
  path: "documents",
  component: DocumentsTab,
  pendingComponent: SectionPending,
  errorComponent: SectionError,
});

const vehicleHistoryRoute = createRoute({
  getParentRoute: () => assetDetailRoute,
  path: "history",
  validateSearch: z.object({
    kind: z.enum(VEHICLE_HISTORY_KINDS).optional().catch(undefined),
  }),
  component: HistoryTab,
  pendingComponent: SectionPending,
  errorComponent: SectionError,
});

const vehicleDetailsRoute = createRoute({
  getParentRoute: () => assetDetailRoute,
  path: "details",
  component: DetailsTab,
  pendingComponent: SectionPending,
  errorComponent: SectionError,
});

/**
 * The Money page (#664): one header over its tabs, each tab a child route with
 * its own address — Overview at `/finance`, then Entries and To approve.
 * Recording an entry opens its panel over the Entries tab. The entry page,
 * the accounting months and the old approvals link sit outside the frame.
 */
const financeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/finance",
  // The waiting view became the To approve tab: an old
  // `/finance/entries?view=waiting` link lands there. Here rather than on the
  // Entries route, which then always renders the address it was given.
  beforeLoad: ({ location }) => {
    const search = location.search as { view?: unknown; branch?: unknown };
    if (location.pathname === "/finance/entries" && search.view === "waiting") {
      throw redirect({
        to: "/finance/approve",
        search: search.branch === "all" ? { branch: "all" } : {},
        replace: true,
      });
    }
  },
  component: FinanceScreen,
});

const financeOverviewRoute = createRoute({
  getParentRoute: () => financeRoute,
  path: "/",
  // The range picker; this month is the bare address.
  validateSearch: z.object({
    range: z.enum(["3-months", "12-months"]).optional().catch(undefined),
  }),
  component: FinanceOverviewScreen,
  pendingComponent: SectionPending,
  errorComponent: SectionError,
});

const financeRecordRoute = createRoute({
  getParentRoute: () => financeRoute,
  path: "record",
  component: FinanceRecordScreen,
  pendingComponent: SectionPending,
  errorComponent: SectionError,
});

const financeEntriesRoute = createRoute({
  getParentRoute: () => financeRoute,
  path: "entries",
  // `branch=all` arrives from an overflow line that has already named the
  // work outside the shell's agency. An old `view=waiting` link is sent on to
  // To approve by the Money route above.
  validateSearch: financialEntryFilters.omit({ branchId: true }).extend({
    view: z.enum([...financialEntryFilters.shape.view.unwrap().options, "waiting"]).optional().catch(undefined),
    branch: z.literal("all").optional().catch(undefined),
  }),
  component: FinanceEntriesScreen,
  pendingComponent: SectionPending,
  errorComponent: SectionError,
});

const financeApproveRoute = createRoute({
  getParentRoute: () => financeRoute,
  path: "approve",
  validateSearch: z.object({ branch: z.literal("all").optional().catch(undefined) }),
  component: FinanceApproveScreen,
  pendingComponent: SectionPending,
  errorComponent: SectionError,
});

const TRIP_LIST_FILTERS = ["status", "completeness", "from", "to", "missing"] as const;

const tripListSearch = z.object({
  status: activityStatus.optional().catch(undefined),
  completeness: activityCompleteness.optional().catch(undefined),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  missing: z.enum(ACTIVITY_MISSING_FILTERS).optional().catch(undefined),
});

/**
 * The Trips page (#665): one header over Overview, Trips and, while
 * Scheduling is on, Planning. A trip's page and its sheet sit outside.
 */
const activitiesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/activities",
  // The list's tiles moved into the Overview: an old filtered link lands on
  // the Trips tab with the same filters.
  beforeLoad: ({ location }) => {
    const search = location.search as Record<string, unknown>;
    if (isBarePath(location.pathname, "/activities") && TRIP_LIST_FILTERS.some((key) => search[key] !== undefined)) {
      throw redirect({ to: "/activities/list", search: tripListSearch.parse(search), replace: true });
    }
  },
  component: TripsFrame,
});

const activitiesOverviewRoute = createRoute({
  getParentRoute: () => activitiesRoute,
  path: "/",
  component: TripsOverview,
  pendingComponent: SectionPending,
  errorComponent: SectionError,
});

const activitiesListRoute = createRoute({
  getParentRoute: () => activitiesRoute,
  path: "list",
  validateSearch: tripListSearch,
  component: ActivitiesScreen,
  pendingComponent: SectionPending,
  errorComponent: SectionError,
});

// The Scheduling module's tab on the Trips page (`PAGE_TABS`).
const activitiesPlanningRoute = createRoute({
  getParentRoute: () => activitiesRoute,
  path: "planning",
  component: PlanningTab,
  pendingComponent: SectionPending,
  errorComponent: SectionError,
});

const activityRecordRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/activities/record",
  // A tile on the home screen can open the sheet already on the right flavour.
  // "Start a trip" on a vehicle names the vehicle, so the sheet opens with it.
  validateSearch: z.object({
    template: z.enum(["journey", "haulage"]).optional(),
    assetId: z.uuid().optional().catch(undefined),
  }),
  component: ActivitySheetScreen,
});

const activityDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/activities/$activityId",
  component: ActivityDetailScreen,
});

/**
 * The Maintenance page (#665): Overview, Problems and Work orders, each with
 * its own address. One screen draws all three, because the header's buttons
 * and the rows' actions open the same dialogs; the child routes carry the
 * addresses and each tab's filters.
 */
const maintenanceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/maintenance",
  // The list's tiles moved into the Overview: an old `?tab=issues` or
  // `?status=` link lands on its tab with the same filter.
  beforeLoad: ({ location }) => {
    const search = location.search as { tab?: unknown; status?: unknown; issueStatus?: unknown };
    if (!isBarePath(location.pathname, "/maintenance")) return;
    if (search.tab === "issues" || search.issueStatus !== undefined) {
      const status = issueStatus.safeParse(search.issueStatus);
      throw redirect({ to: "/maintenance/problems", search: status.success ? { status: status.data } : {}, replace: true });
    }
    if (search.tab === "work-orders" || search.status !== undefined) {
      const status = workOrderStatus.safeParse(search.status);
      throw redirect({ to: "/maintenance/work-orders", search: status.success ? { status: status.data } : {}, replace: true });
    }
  },
  component: MaintenanceScreen,
});

const maintenanceOverviewRoute = createRoute({
  getParentRoute: () => maintenanceRoute,
  path: "/",
});

const maintenanceProblemsRoute = createRoute({
  getParentRoute: () => maintenanceRoute,
  path: "problems",
  validateSearch: z.object({ status: issueStatus.optional().catch(undefined) }),
});

const maintenanceWorkOrdersRoute = createRoute({
  getParentRoute: () => maintenanceRoute,
  path: "work-orders",
  validateSearch: z.object({
    status: workOrderStatus.optional().catch(undefined),
    // A word, not `true`: the router reads a bare `true` as a boolean.
    only: z.literal("open").optional().catch(undefined),
  }),
});

const financeEntryDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/finance/entries/$entryId",
  // The entries list's ⋯ menu sends an operator straight into the reversal
  // dialog rather than carrying a second copy of it.
  validateSearch: z.object({ reverse: z.boolean().optional() }),
  component: FinanceEntryDetailScreen,
});

// The Approvals page became the Money page's To approve tab (#314, #664). Old
// links, notifications and the dashboard keep landing on the same work.
const financeApprovalsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/finance/approvals",
  validateSearch: z.object({ branch: z.literal("all").optional().catch(undefined) }),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/finance/approve",
      search: search.branch === "all" ? { branch: "all" } : {},
      replace: true,
    });
  },
});

const financePeriodsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/finance/periods",
  component: FinancePeriodsScreen,
});

// The More page went with #316: personal settings live in the name menu.
// Old links and bookmarks land on Home rather than on a missing page.
const moreRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/more",
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});

const mySettingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/my-settings",
  component: MySettingsScreen,
});

// The administration pages keep their /more paths so existing links still work.
const personsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/more/persons",
  component: PersonsScreen,
});

const usersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/more/users",
  component: UsersScreen,
});

const branchesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/more/branches",
  component: BranchesScreen,
});

const companySettingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/more/company",
  component: CompanySettingsScreen,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    indexRoute,
    assetsRoute.addChildren([assetsOverviewRoute, assetsListRoute, assetsDocumentsRoute]),
    // Before the $assetId route, or "new" reads as an asset id.
    assetsNewRoute,
    assetDetailRoute.addChildren([
      vehicleNowRoute,
      vehicleMaintenanceRoute,
      vehicleMoneyRoute,
      vehicleTripsRoute,
      vehicleDocumentsRoute,
      vehicleHistoryRoute,
      vehicleDetailsRoute,
    ]),
    activitiesRoute.addChildren([activitiesOverviewRoute, activitiesListRoute, activitiesPlanningRoute]),
    // Before the $activityId route, or "record" reads as an activity id.
    activityRecordRoute,
    activityDetailRoute,
    maintenanceRoute.addChildren([maintenanceOverviewRoute, maintenanceProblemsRoute, maintenanceWorkOrdersRoute]),
    financeRoute.addChildren([
      financeOverviewRoute,
      financeRecordRoute,
      financeEntriesRoute,
      financeApproveRoute,
    ]),
    financeEntryDetailRoute,
    financeApprovalsRoute,
    financePeriodsRoute,
    moreRoute,
    mySettingsRoute,
    personsRoute,
    usersRoute,
    branchesRoute,
    companySettingsRoute,
  ]),
]);

// Inside the shell a slow screen shows its skeleton in the content slot, and a
// screen that cannot open shows a translated error with Retry in the same slot.
export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPendingComponent: ScreenPending,
  defaultErrorComponent: ScreenError,
});

// Every navigation is a fresh chance to fetch a screen whose code failed before.
router.subscribe("onBeforeLoad", () => {
  retryFailedScreens();
});

/**
 * While someone types their PIN, fetch the shell and Home, so signing in does
 * not wait on another download over a slow network.
 */
export const AFTER_SIGN_IN = [AppShell, DashboardScreen];

export function preloadAfterSignIn(): void {
  for (const screen of AFTER_SIGN_IN) void screen.preload();
  // The shell's frame and loader are not screens, but sign-in waits on them too.
  void ShellPending.preload();
  void import("./shell/shell-loader.js").catch(() => undefined);
}

/** Most-visited first, so a slow connection fetches the likely next screen before the rest. */
export const SCREENS_BY_USE = [
  TrucksFrame,
  TrucksOverview,
  AssetsStub,
  VehicleWorkspaceScreen,
  NowTab,
  TripsFrame,
  TripsOverview,
  ActivitiesScreen,
  FinanceScreen,
  FinanceOverviewScreen,
  FinanceEntriesScreen,
  MaintenanceScreen,
  ActivityDetailScreen,
  FinanceEntryDetailScreen,
  MaintenanceTab,
  MoneyTab,
  TripsTab,
  DocumentsTab,
  HistoryTab,
  DetailsTab,
  FleetDocumentsTab,
  PlanningTab,
  FinanceRecordScreen,
  FinanceApproveScreen,
  ActivitySheetScreen,
  AssetRegisterScreen,
  MySettingsScreen,
  FinancePeriodsScreen,
  PersonsScreen,
  UsersScreen,
  BranchesScreen,
  CompanySettingsScreen,
];

/**
 * Once the first screen after sign-in has settled, fetch the other screens'
 * code one at a time, so moving around later does not wait on a download.
 * Before each one it waits while `busy` says the app is loading something of
 * its own, so on a slow connection a screen's data never queues behind code
 * for screens nobody has opened yet. The shell and Home come first: a signed-in
 * start on a deep link never ran `preloadAfterSignIn`.
 */
export async function preloadScreens(busy: () => boolean = () => false): Promise<void> {
  for (const screen of [...AFTER_SIGN_IN, ...SCREENS_BY_USE]) {
    while (busy()) await new Promise((resolve) => setTimeout(resolve, 250));
    await screen.preload();
  }
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
