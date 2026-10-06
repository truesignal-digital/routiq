import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import { z } from "zod";
import { financialEntryFilters, VEHICLE_HISTORY_KINDS } from "@routiq/contracts";
import { sessionStore } from "./auth/store.js";
import { PANEL_PATTERN } from "./vehicle/model.js";
import { LoginScreen } from "./screens/LoginScreen.js";
import { queryClient } from "./lib/query-client.js";

/**
 * Every screen but sign-in loads on demand, so the first page a phone opens
 * carries only the login screen (#480). Route definitions stay here: redirects
 * and search validation run before a screen's code arrives.
 */
const AssetRegisterScreen = lazyRouteComponent(() => import("./screens/AssetRegisterScreen.js"), "AssetRegisterScreen");
const AssetsStub = lazyRouteComponent(() => import("./screens/AssetsStub.js"), "AssetsStub");
const BranchesScreen = lazyRouteComponent(() => import("./screens/BranchesScreen.js"), "BranchesScreen");
const DashboardScreen = lazyRouteComponent(() => import("./screens/DashboardScreen.js"), "DashboardScreen");
const MoreStub = lazyRouteComponent(() => import("./screens/MoreStub.js"), "MoreStub");
const PersonsScreen = lazyRouteComponent(() => import("./screens/PersonsScreen.js"), "PersonsScreen");
const UsersScreen = lazyRouteComponent(() => import("./screens/UsersScreen.js"), "UsersScreen");
const FinanceRecordScreen = lazyRouteComponent(() => import("./screens/FinanceRecordScreen.js"), "FinanceRecordScreen");
const FinanceEntriesScreen = lazyRouteComponent(() => import("./screens/FinanceEntriesScreen.js"), "FinanceEntriesScreen");
const ActivitiesScreen = lazyRouteComponent(() => import("./screens/ActivitiesScreen.js"), "ActivitiesScreen");
const MaintenanceScreen = lazyRouteComponent(() => import("./screens/MaintenanceScreen.js"), "MaintenanceScreen");
const ActivityDetailScreen = lazyRouteComponent(() => import("./screens/ActivityDetailScreen.js"), "ActivityDetailScreen");
const ActivitySheetScreen = lazyRouteComponent(() => import("./screens/ActivitySheetScreen.js"), "ActivitySheetScreen");
const FinanceEntryDetailScreen = lazyRouteComponent(() => import("./screens/FinanceEntryDetailScreen.js"), "FinanceEntryDetailScreen");
const FinanceApprovalsScreen = lazyRouteComponent(() => import("./screens/FinanceApprovalsScreen.js"), "FinanceApprovalsScreen");
const FinancePeriodsScreen = lazyRouteComponent(() => import("./screens/FinancePeriodsScreen.js"), "FinancePeriodsScreen");
const AppShell = lazyRouteComponent(() => import("./shell/AppShell.js"), "AppShell");
// On demand like the shell: the sign-in page carries neither (#495).
const ShellPending = lazyRouteComponent(() => import("./shell/ShellPending.js"), "ShellPending");
const VehicleWorkspaceScreen = lazyRouteComponent(() => import("./vehicle/VehicleWorkspaceScreen.js"), "VehicleWorkspaceScreen");
const DetailsTab = lazyRouteComponent(() => import("./vehicle/tabs/DetailsTab.js"), "DetailsTab");
const DocumentsTab = lazyRouteComponent(() => import("./vehicle/tabs/DocumentsTab.js"), "DocumentsTab");
const HistoryTab = lazyRouteComponent(() => import("./vehicle/tabs/HistoryTab.js"), "HistoryTab");
const MaintenanceTab = lazyRouteComponent(() => import("./vehicle/tabs/MaintenanceTab.js"), "MaintenanceTab");
const MoneyTab = lazyRouteComponent(() => import("./vehicle/tabs/MoneyTab.js"), "MoneyTab");
const NowTab = lazyRouteComponent(() => import("./vehicle/tabs/NowTab.js"), "NowTab");
const TripsTab = lazyRouteComponent(() => import("./vehicle/tabs/TripsTab.js"), "TripsTab");

/** What every route's loader receives: the one Query cache the screens read too. */
export interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()();

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

const assetsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/assets",
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
});

const vehicleMaintenanceRoute = createRoute({
  getParentRoute: () => assetDetailRoute,
  path: "maintenance",
  component: MaintenanceTab,
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
});

const vehicleTripsRoute = createRoute({
  getParentRoute: () => assetDetailRoute,
  path: "trips",
  component: TripsTab,
});

// The old asset documents screen lived at this same URL, so its links and its
// route id keep working as the Documents section.
const vehicleDocumentsRoute = createRoute({
  getParentRoute: () => assetDetailRoute,
  path: "documents",
  component: DocumentsTab,
});

const vehicleHistoryRoute = createRoute({
  getParentRoute: () => assetDetailRoute,
  path: "history",
  validateSearch: z.object({
    kind: z.enum(VEHICLE_HISTORY_KINDS).optional().catch(undefined),
  }),
  component: HistoryTab,
});

const vehicleDetailsRoute = createRoute({
  getParentRoute: () => assetDetailRoute,
  path: "details",
  component: DetailsTab,
});

const financeRecordRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/finance/record",
  component: FinanceRecordScreen,
});

const financeEntriesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/finance/entries",
  validateSearch: financialEntryFilters.omit({ branchId: true }),
  component: FinanceEntriesScreen,
});

const activitiesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/activities",
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

const financeApprovalsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/finance/approvals",
  // The dashboard's overflow line sends an approver to the queue already
  // widened; without it the queue presets itself to the shell's agency, which
  // is exactly the narrowing that line is reporting around.
  validateSearch: z.object({ branch: z.literal("all").optional() }),
  component: FinanceApprovalsScreen,
});

const financePeriodsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/finance/periods",
  component: FinancePeriodsScreen,
});

const moreRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/more",
  component: MoreStub,
});

// Under /more so the shell keeps the Plus tab lit while you administer.
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
    personsRoute,
    usersRoute,
    branchesRoute,
  ]),
]);

export const router = createRouter({ routeTree, context: { queryClient } });

/**
 * While someone types their PIN, fetch the shell and Home, so signing in does
 * not wait on another download over a slow network.
 */
export function preloadAfterSignIn(): void {
  void AppShell.preload?.();
  void ShellPending.preload?.();
  void import("./shell/shell-loader.js").catch(() => undefined);
  void DashboardScreen.preload?.();
}

/** Most-visited first, so a slow connection fetches the likely next screen before the rest. */
const SCREENS_BY_USE = [
  AssetsStub,
  VehicleWorkspaceScreen,
  NowTab,
  ActivitiesScreen,
  FinanceEntriesScreen,
  FinanceApprovalsScreen,
  MaintenanceScreen,
  MoreStub,
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
  FinancePeriodsScreen,
  PersonsScreen,
  UsersScreen,
  BranchesScreen,
];

/**
 * Once the first screen after sign-in has settled, fetch the other screens'
 * code one at a time, so moving around later does not wait on a download.
 */
export async function preloadScreens(): Promise<void> {
  for (const screen of SCREENS_BY_USE) {
    await screen.preload?.()?.catch(() => undefined);
  }
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
