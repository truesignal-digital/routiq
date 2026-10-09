import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
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
import { ScreenPending, SectionPending, ShellPending } from "./shell/RoutePending.js";

/**
 * Every screen but sign-in loads on demand, so the first page a phone opens
 * carries only the login screen (#480). Route definitions stay here: redirects
 * and search validation run before a screen's code arrives.
 */
const AssetRegisterScreen = lazyRouteComponent(() => import("./screens/AssetRegisterScreen.js"), "AssetRegisterScreen");
const AssetsStub = lazyRouteComponent(() => import("./screens/AssetsStub.js"), "AssetsStub");
const BranchesScreen = lazyRouteComponent(() => import("./screens/BranchesScreen.js"), "BranchesScreen");
const CompanySettingsScreen = lazyRouteComponent(() => import("./screens/CompanySettingsScreen.js"), "CompanySettingsScreen");
const DashboardScreen = lazyRouteComponent(() => import("./screens/DashboardScreen.js"), "DashboardScreen");
const MySettingsScreen = lazyRouteComponent(() => import("./screens/MySettingsScreen.js"), "MySettingsScreen");
const PersonsScreen = lazyRouteComponent(() => import("./screens/PersonsScreen.js"), "PersonsScreen");
const UsersScreen = lazyRouteComponent(() => import("./screens/UsersScreen.js"), "UsersScreen");
const FinanceRecordScreen = lazyRouteComponent(() => import("./screens/FinanceRecordScreen.js"), "FinanceRecordScreen");
const FinanceEntriesScreen = lazyRouteComponent(() => import("./screens/FinanceEntriesScreen.js"), "FinanceEntriesScreen");
const ActivitiesScreen = lazyRouteComponent(() => import("./screens/ActivitiesScreen.js"), "ActivitiesScreen");
const MaintenanceScreen = lazyRouteComponent(() => import("./screens/MaintenanceScreen.js"), "MaintenanceScreen");
const ActivityDetailScreen = lazyRouteComponent(() => import("./screens/ActivityDetailScreen.js"), "ActivityDetailScreen");
const ActivitySheetScreen = lazyRouteComponent(() => import("./screens/ActivitySheetScreen.js"), "ActivitySheetScreen");
const FinanceEntryDetailScreen = lazyRouteComponent(() => import("./screens/FinanceEntryDetailScreen.js"), "FinanceEntryDetailScreen");
const FinancePeriodsScreen = lazyRouteComponent(() => import("./screens/FinancePeriodsScreen.js"), "FinancePeriodsScreen");
const AppShell = lazyRouteComponent(() => import("./shell/AppShell.js"), "AppShell");
const VehicleWorkspaceScreen = lazyRouteComponent(() => import("./vehicle/VehicleWorkspaceScreen.js"), "VehicleWorkspaceScreen");
const DetailsTab = lazyRouteComponent(() => import("./vehicle/tabs/DetailsTab.js"), "DetailsTab");
const DocumentsTab = lazyRouteComponent(() => import("./vehicle/tabs/DocumentsTab.js"), "DocumentsTab");
const HistoryTab = lazyRouteComponent(() => import("./vehicle/tabs/HistoryTab.js"), "HistoryTab");
const MaintenanceTab = lazyRouteComponent(() => import("./vehicle/tabs/MaintenanceTab.js"), "MaintenanceTab");
const MoneyTab = lazyRouteComponent(() => import("./vehicle/tabs/MoneyTab.js"), "MoneyTab");
const NowTab = lazyRouteComponent(() => import("./vehicle/tabs/NowTab.js"), "NowTab");
const TripsTab = lazyRouteComponent(() => import("./vehicle/tabs/TripsTab.js"), "TripsTab");

const rootRoute = createRootRoute();

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
  component: AppShell,
  pendingComponent: ShellPending,
});

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/",
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
  component: AssetsStub,
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
});

const vehicleMaintenanceRoute = createRoute({
  getParentRoute: () => assetDetailRoute,
  path: "maintenance",
  component: MaintenanceTab,
  pendingComponent: SectionPending,
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
});

const vehicleTripsRoute = createRoute({
  getParentRoute: () => assetDetailRoute,
  path: "trips",
  component: TripsTab,
  pendingComponent: SectionPending,
});

// The old asset documents screen lived at this same URL, so its links and its
// route id keep working as the Documents section.
const vehicleDocumentsRoute = createRoute({
  getParentRoute: () => assetDetailRoute,
  path: "documents",
  component: DocumentsTab,
  pendingComponent: SectionPending,
});

const vehicleHistoryRoute = createRoute({
  getParentRoute: () => assetDetailRoute,
  path: "history",
  validateSearch: z.object({
    kind: z.enum(VEHICLE_HISTORY_KINDS).optional().catch(undefined),
  }),
  component: HistoryTab,
  pendingComponent: SectionPending,
});

const vehicleDetailsRoute = createRoute({
  getParentRoute: () => assetDetailRoute,
  path: "details",
  component: DetailsTab,
  pendingComponent: SectionPending,
});

const financeRecordRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/finance/record",
  component: FinanceRecordScreen,
});

const financeEntriesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/finance/entries",
  // `view=waiting` is the "Waiting your approval" view (#314), beside the
  // read's own events / books views (#427). `branch=all` arrives from an
  // overflow line that has already named the work outside the shell's agency,
  // so the queue opens widened.
  validateSearch: financialEntryFilters.omit({ branchId: true }).extend({
    view: z.enum([...financialEntryFilters.shape.view.unwrap().options, "waiting"]).optional().catch(undefined),
    branch: z.literal("all").optional().catch(undefined),
  }),
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
  component: ActivitySheetScreen,
});

const activityDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/activities/$activityId",
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
  component: MaintenanceScreen,
});

const financeEntryDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/finance/entries/$entryId",
  // The entries list's ⋯ menu sends an operator straight into the reversal
  // dialog rather than carrying a second copy of it.
  validateSearch: z.object({ reverse: z.boolean().optional() }),
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

// Inside the shell a slow screen shows its skeleton in the content slot.
export const router = createRouter({ routeTree, defaultPendingComponent: ScreenPending });

/**
 * While someone types their PIN, fetch the shell and Home, so signing in does
 * not wait on another download over a slow network.
 */
export const AFTER_SIGN_IN = [AppShell, DashboardScreen];

export function preloadAfterSignIn(): void {
  for (const screen of AFTER_SIGN_IN) void screen.preload?.();
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
 * for screens nobody has opened yet.
 */
export async function preloadScreens(busy: () => boolean = () => false): Promise<void> {
  for (const screen of SCREENS_BY_USE) {
    while (busy()) await new Promise((resolve) => setTimeout(resolve, 250));
    await screen.preload?.()?.catch(() => undefined);
  }
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
