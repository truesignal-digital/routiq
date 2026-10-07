import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { preloadAfterSignIn, preloadScreens, router } from "./router.js";
import { sessionStore } from "./auth/store.js";
import { reportError, startTelemetry } from "./telemetry/index.js";
import { queryClient } from "./lib/query-client.js";
import { initTheme } from "./lib/theme.js";
import "./i18n/index.js";
import "./styles.css";

// Before the first render, or the app paints light and then flips.
initTheme();


startTelemetry({ getToken: () => sessionStore.getToken(), queryClient, router });

if (!sessionStore.getActive()) {
  // After the login screen has loaded, so its own download comes first.
  window.addEventListener("load", () => setTimeout(preloadAfterSignIn, 0), { once: true });
}

// Once the first signed-in screen has rendered and nothing has been fetched
// for a second (the member is reading it), so other screens' code and data
// never compete with it for a slow connection (#497).
const QUIET_BEFORE_PRELOAD_MS = 1_000;
const stopWatching = router.subscribe("onRendered", ({ toLocation }) => {
  if (toLocation.pathname === "/login") return;
  stopWatching();
  let quietSince = performance.now();
  const startWhenQuiet = () => {
    if (queryClient.isFetching() > 0) quietSince = performance.now();
    if (performance.now() - quietSince < QUIET_BEFORE_PRELOAD_MS) {
      window.setTimeout(startWhenQuiet, 250);
      return;
    }
    // The rows this member can tap first, data included; then the rest's code.
    void import("./shell/preload-sidebar.js")
      .then(({ preloadSidebarScreens }) => preloadSidebarScreens(router, queryClient))
      .catch(() => undefined)
      .then(preloadScreens);
  };
  window.setTimeout(startWhenQuiet, 250);
});

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

createRoot(root, {
  // The router's catch boundaries keep render errors from reaching window.onerror.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
    reportError(error, "react");
  },
  onUncaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
    reportError(error, "react");
  },
}).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
