import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { z } from "zod";
import { sessionStore } from "./auth/store.js";
import { AssetDocumentsScreen } from "./screens/AssetDocumentsScreen.js";
import { AssetRegisterScreen } from "./screens/AssetRegisterScreen.js";
import { AssetsStub } from "./screens/AssetsStub.js";
import { LoginScreen } from "./screens/LoginScreen.js";
import { MoreStub } from "./screens/MoreStub.js";
import { AppShell } from "./shell/AppShell.js";

const rootRoute = createRootRoute();

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: z.object({ redirect: z.string().optional() }),
  beforeLoad: () => {
    if (sessionStore.getActive()) throw redirect({ to: "/assets" });
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
  beforeLoad: () => {
    throw redirect({ to: "/assets" });
  },
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

const assetDocumentsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/assets/$assetId/documents",
  component: AssetDocumentsScreen,
});

const moreRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/more",
  component: MoreStub,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([indexRoute, assetsRoute, assetsNewRoute, assetDocumentsRoute, moreRoute]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
