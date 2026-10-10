import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { z } from "zod";
import {
  activityCompleteness,
  activityStatus,
  financialEntryFilters,
  issueStatus,
  VEHICLE_HISTORY_KINDS,
  workOrderStatus,
} from "@routiq/contracts";
import { sessionStore } from "./auth/store.js";
import { LoginScreen } from "./screens/LoginScreen.js";
import { PANEL_PATTERN } from "./vehicle/model.js";
import { queryClient } from "./lib/query-client.js";
// Static, unlike the shell: a skeleton must draw the moment a screen is
// pending, and these add almost nothing the sign-in page does not carry.
import {
  HomeSkeleton,
  ModuleListSkeleton,
  RecordSkeleton,
  RecordWorkspaceSkeleton,
  SettingsListSkeleton,
  TabSkeleton,
  WideRecordSkeleton,
} from "./components/page-skeletons.js";
import { ScreenError, ScreenPending, SectionError } from "./shell/RoutePending.js";
import { lazyScreen, retryFailedScreens } from "./shell/lazy-screen.js";

/**
 * Every screen but sign-in loads on demand, so the first page a phone opens
 * carries only the login screen (#480). Route definitions stay here: redirects
 * and search validation run before a screen's code arrives.
 */
const AssetRegisterScreen = lazyScreen(() => import("./screens/AssetRegisterScreen.js"), "AssetRegisterScreen");
const AssetsStub = lazyScreen(() => import("./screens/AssetsStub.js"), "AssetsStub");
const BranchesScreen = lazyScreen(() => import("./screens/BranchesScreen.js"), "BranchesScreen");
const CompanySettingsScreen = lazyScreen(() => import("./screens/CompanySettingsScreen.js"), "CompanySettingsScreen");
const DashboardScreen = lazyScreen(() => import("./screens/DashboardScreen.js"), "DashboardScreen");
const MySettingsScreen = lazyScreen(() => import("./screens/MySettingsScreen.js"), "MySettingsScreen");
const PersonsScreen = lazyScreen(() => import("./screens/PersonsScreen.js"), "PersonsScreen");
const UsersScreen = lazyScreen(() => import("./screens/UsersScreen.js"), "UsersScreen");
const FinanceRecordScreen = lazyScreen(() => import("./screens/FinanceRecordScreen.js"), "FinanceRecordScreen");
const FinanceEntriesScreen = lazyScreen(() => import("./screens/FinanceEntriesScreen.js"), "FinanceEntriesScreen");
const ActivitiesScreen = lazyScreen(() => import("./screens/ActivitiesScreen.js"), "ActivitiesScreen");
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

/**
 * Each screen's loader starts its first view's reads (routes/*.loader.ts,
 * #496), its module loaded on demand like the screen and fetched with the
 * screens in the background (preloadScreens), so moving around offline needs
 * no code.
 */
const LOADERS = {
  home: () => import("./routes/home.loader.js"),
  assets: () => import("./routes/assets.loader.js"),
  vehicle: () => import("./routes/vehicle.loader.js"),
  activities: () => import("./routes/activities.loader.js"),
  finance: () => import("./routes/finance.loader.js"),
  maintenance: () => import("./routes/maintenance.loader.js"),
};

/**
 * A loader never fails or holds a navigation. Offline its module may be
 * missing (and a failed fetch stays failed for the page's life) and its reads
 * would wait for the connection, so the screen opens at once and shows its
 * own loading state; a read that fails is left to the screen.
 *
 * A page whose module is off starts no reads: ModulePageGate shows "not
 * included" instead, and every read would be refused (#326). Each loader
 * still checks the member's role for its own reads.
 */
function startReads(args: ReadArgs, run: () => Promise<void>): Promise<void> | undefined {
  if (!navigator.onLine) return undefined;
  return import("./modules/app-shell.js")
    .then(({ pageModuleOn }) => pageModuleOn(args.context.queryClient, args.location.pathname))
    .then((on) => (on ? run() : undefined))
    .catch(() => undefined);
}

interface ReadArgs {
  context: RouterContext;
  location: { pathname: string };
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
  loader: (args) => startReads(args, () => LOADERS.home().then((load) => load.home(args))),
  pendingComponent: HomeSkeleton,
  component: DashboardScreen,
});

const assetsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/assets",
  // The overview tiles filter the list through the URL, so a tile's view is a
  // link that survives reload and back (#302).
  validateSearch: z.object({
    status: z.enum(["IN_SERVICE", "ATTENTION"]).optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => search,
  loader: (args) => startReads(args, () => LOADERS.assets().then((load) => load.assets(args))),
  pendingComponent: ModuleListSkeleton,
  component: AssetsStub,
});

const assetsNewRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/assets/new",
  pendingComponent: ScreenPending,
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
  loader: (args) => startReads(args, () => LOADERS.vehicle().then((load) => load.vehicle(args))),
  pendingComponent: RecordWorkspaceSkeleton,
  component: VehicleWorkspaceScreen,
});

const vehicleNowRoute = createRoute({
  getParentRoute: () => assetDetailRoute,
  path: "/",
  loader: (args) => startReads(args, () => LOADERS.vehicle().then((load) => load.vehicleNow(args))),
  component: NowTab,
  pendingComponent: TabSkeleton,
  errorComponent: SectionError,
});

const vehicleMaintenanceRoute = createRoute({
  getParentRoute: () => assetDetailRoute,
  path: "maintenance",
  component: MaintenanceTab,
  pendingComponent: TabSkeleton,
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
  pendingComponent: TabSkeleton,
  errorComponent: SectionError,
});

const vehicleTripsRoute = createRoute({
  getParentRoute: () => assetDetailRoute,
  path: "trips",
  component: TripsTab,
  pendingComponent: TabSkeleton,
  errorComponent: SectionError,
});

// The old asset documents screen lived at this same URL, so its links and its
// route id keep working as the Documents section.
const vehicleDocumentsRoute = createRoute({
  getParentRoute: () => assetDetailRoute,
  path: "documents",
  component: DocumentsTab,
  pendingComponent: TabSkeleton,
  errorComponent: SectionError,
});

const vehicleHistoryRoute = createRoute({
  getParentRoute: () => assetDetailRoute,
  path: "history",
  validateSearch: z.object({
    kind: z.enum(VEHICLE_HISTORY_KINDS).optional().catch(undefined),
  }),
  component: HistoryTab,
  pendingComponent: TabSkeleton,
  errorComponent: SectionError,
});

const vehicleDetailsRoute = createRoute({
  getParentRoute: () => assetDetailRoute,
  path: "details",
  component: DetailsTab,
  pendingComponent: TabSkeleton,
  errorComponent: SectionError,
});

const financeRecordRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/finance/record",
  pendingComponent: ModuleListSkeleton,
  component: FinanceRecordScreen,
});

const financeEntriesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/finance/entries",
  // `view=waiting` is the "Waiting for your approval" view (#314), beside the
  // read's own events / books views (#427). `branch=all` arrives from an
  // overflow line that has already named the work outside the shell's agency,
  // so the queue opens widened.
  validateSearch: financialEntryFilters.omit({ branchId: true }).extend({
    view: z.enum([...financialEntryFilters.shape.view.unwrap().options, "waiting"]).optional().catch(undefined),
    branch: z.literal("all").optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => search,
  loader: (args) => startReads(args, () => LOADERS.finance().then((load) => load.financeEntries(args))),
  pendingComponent: ModuleListSkeleton,
  component: FinanceEntriesScreen,
});

const activitiesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/activities",
  validateSearch: z.object({
    status: activityStatus.optional().catch(undefined),
    completeness: activityCompleteness.optional().catch(undefined),
    from: z.iso.date().optional().catch(undefined),
    to: z.iso.date().optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => search,
  loader: (args) => startReads(args, () => LOADERS.activities().then((load) => load.activities(args))),
  pendingComponent: ModuleListSkeleton,
  component: ActivitiesScreen,
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
  pendingComponent: ScreenPending,
  component: ActivitySheetScreen,
});

const activityDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/activities/$activityId",
  pendingComponent: WideRecordSkeleton,
  component: ActivityDetailScreen,
});

// The screen gates itself on the MAINTENANCE module, as every module-owned
// screen does; the nav entry disappears with the module (`sections.ts`).
const maintenanceRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/maintenance",
  validateSearch: z.object({
    tab: z.enum(["work-orders", "issues"]).optional().catch(undefined),
    status: workOrderStatus.optional().catch(undefined),
    issueStatus: issueStatus.optional().catch(undefined),
  }),
  loaderDeps: ({ search }) => search,
  loader: (args) => startReads(args, () => LOADERS.maintenance().then((load) => load.maintenance(args))),
  pendingComponent: ModuleListSkeleton,
  component: MaintenanceScreen,
});

const financeEntryDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/finance/entries/$entryId",
  // The entries list's ⋯ menu sends an operator straight into the reversal
  // dialog rather than carrying a second copy of it.
  validateSearch: z.object({ reverse: z.boolean().optional() }),
  pendingComponent: RecordSkeleton,
  component: FinanceEntryDetailScreen,
});

// The Approvals page became the Money page's waiting view (#314). Old links,
// notifications and the dashboard keep landing on the same work.
const financeApprovalsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/finance/approvals",
  validateSearch: z.object({ branch: z.literal("all").optional().catch(undefined) }),
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/finance/entries",
      search: { view: "waiting", ...(search.branch === "all" ? { branch: "all" } : {}) },
      replace: true,
    });
  },
});

const financePeriodsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/finance/periods",
  pendingComponent: SettingsListSkeleton,
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
  pendingComponent: ScreenPending,
  component: MySettingsScreen,
});

// The administration pages keep their /more paths so existing links still work.
const personsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/more/persons",
  pendingComponent: SettingsListSkeleton,
  component: PersonsScreen,
});

const usersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/more/users",
  pendingComponent: SettingsListSkeleton,
  component: UsersScreen,
});

const branchesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/more/branches",
  pendingComponent: SettingsListSkeleton,
  component: BranchesScreen,
});

const companySettingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/more/company",
  pendingComponent: ScreenPending,
  component: CompanySettingsScreen,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    indexRoute,
    assetsRoute,
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
    activitiesRoute,
    // Before the $activityId route, or "record" reads as an activity id.
    activityRecordRoute,
    activityDetailRoute,
    maintenanceRoute,
    financeRecordRoute,
    financeEntriesRoute,
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
  // The Query cache decides what is fresh (lib/query-client.ts); the router
  // never keeps loader results of its own.
  defaultPreloadStaleTime: 0,
  // A pointer resting on a link, a focus, or a finger landing on it starts the
  // screen's code and data before the click (#497).
  defaultPreload: "intent",
  defaultPreloadDelay: 50,
  // A screen whose data takes longer than a second shows its page type's
  // skeleton (#498). No minimum once shown: holding a skeleton over data that
  // has arrived only delays the screen.
  defaultPendingMs: 1_000,
  defaultPendingMinMs: 0,
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
  void LOADERS.home().catch(() => undefined);
}

/** Most-visited first, so a slow connection fetches the likely next screen before the rest. */
export const SCREENS_BY_USE = [
  AssetsStub,
  VehicleWorkspaceScreen,
  NowTab,
  ActivitiesScreen,
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
  FinanceRecordScreen,
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
  for (const loader of Object.values(LOADERS)) {
    while (busy()) await new Promise((resolve) => setTimeout(resolve, 250));
    await loader().catch(() => undefined);
  }
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
