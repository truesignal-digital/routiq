import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { z } from "zod";
import { financialEntryFilters, VEHICLE_HISTORY_KINDS } from "@routiq/contracts";
import { sessionStore } from "./auth/store.js";
import { AssetRegisterScreen } from "./screens/AssetRegisterScreen.js";
import { AssetsStub } from "./screens/AssetsStub.js";
import { BranchesScreen } from "./screens/BranchesScreen.js";
import { DashboardScreen } from "./screens/DashboardScreen.js";
import { LoginScreen } from "./screens/LoginScreen.js";
import { MoreStub } from "./screens/MoreStub.js";
import { PersonsScreen } from "./screens/PersonsScreen.js";
import { UsersScreen } from "./screens/UsersScreen.js";
import { FinanceRecordScreen } from "./screens/FinanceRecordScreen.js";
import { FinanceEntriesScreen } from "./screens/FinanceEntriesScreen.js";
import { ActivitiesScreen } from "./screens/ActivitiesScreen.js";
import { MaintenanceScreen } from "./screens/MaintenanceScreen.js";
import { ActivityDetailScreen } from "./screens/ActivityDetailScreen.js";
import { ActivitySheetScreen } from "./screens/ActivitySheetScreen.js";
import { FinanceEntryDetailScreen } from "./screens/FinanceEntryDetailScreen.js";
import { FinanceApprovalsScreen } from "./screens/FinanceApprovalsScreen.js";
import { FinancePeriodsScreen } from "./screens/FinancePeriodsScreen.js";
import { AppShell } from "./shell/AppShell.js";
import { PANEL_PATTERN } from "./vehicle/model.js";
import { VehicleWorkspaceScreen } from "./vehicle/VehicleWorkspaceScreen.js";
import { DocumentsTab } from "./vehicle/tabs/DocumentsTab.js";
import { HistoryTab } from "./vehicle/tabs/HistoryTab.js";
import { MaintenanceTab } from "./vehicle/tabs/MaintenanceTab.js";
import { MoneyTab } from "./vehicle/tabs/MoneyTab.js";
import { NowTab } from "./vehicle/tabs/NowTab.js";
import { TripsTab } from "./vehicle/tabs/TripsTab.js";

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

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
