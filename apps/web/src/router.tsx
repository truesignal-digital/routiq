import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { z } from "zod";
import { sessionStore } from "./auth/store.js";
import { AssetDetailScreen } from "./screens/AssetDetailScreen.js";
import { AssetDocumentsScreen } from "./screens/AssetDocumentsScreen.js";
import { AssetRegisterScreen } from "./screens/AssetRegisterScreen.js";
import { AssetsStub } from "./screens/AssetsStub.js";
import { DashboardScreen } from "./screens/DashboardScreen.js";
import { LoginScreen } from "./screens/LoginScreen.js";
import { MoreStub } from "./screens/MoreStub.js";
import { PersonsScreen } from "./screens/PersonsScreen.js";
import { FinanceRecordScreen } from "./screens/FinanceRecordScreen.js";
import { FinanceEntriesScreen } from "./screens/FinanceEntriesScreen.js";
import { ActivitiesScreen } from "./screens/ActivitiesScreen.js";
import { ActivityDetailScreen } from "./screens/ActivityDetailScreen.js";
import { ActivitySheetScreen } from "./screens/ActivitySheetScreen.js";
import { FinanceEntryDetailScreen } from "./screens/FinanceEntryDetailScreen.js";
import { FinanceApprovalsScreen } from "./screens/FinanceApprovalsScreen.js";
import { FinancePeriodsScreen } from "./screens/FinancePeriodsScreen.js";
import { AppShell } from "./shell/AppShell.js";

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

const assetDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/assets/$assetId",
  component: AssetDetailScreen,
});

const assetDocumentsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/assets/$assetId/documents",
  component: AssetDocumentsScreen,
});

const financeRecordRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/finance/record",
  component: FinanceRecordScreen,
});

const financeEntriesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/finance/entries",
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
  validateSearch: z.object({
    template: z.enum(["journey", "haulage"]).optional(),
  }),
  component: ActivitySheetScreen,
});

const activityDetailRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/activities/$activityId",
  component: ActivityDetailScreen,
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

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([
    indexRoute,
    assetsRoute,
    // Before the $assetId route, or "new" reads as an asset id.
    assetsNewRoute,
    assetDetailRoute,
    assetDocumentsRoute,
    activitiesRoute,
    // Before the $activityId route, or "record" reads as an activity id.
    activityRecordRoute,
    activityDetailRoute,
    financeRecordRoute,
    financeEntriesRoute,
    financeEntryDetailRoute,
    financeApprovalsRoute,
    financePeriodsRoute,
    moreRoute,
    personsRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
