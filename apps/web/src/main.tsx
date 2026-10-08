import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router.js";
import { sessionStore } from "./auth/store.js";
import { reportError, startTelemetry } from "./telemetry/index.js";
import { initTheme } from "./lib/theme.js";
import "./i18n/index.js";
import "./styles.css";

// Before the first render, or the app paints light and then flips.
initTheme();

// The Query cache is not offline storage (§8) — no persistence plugin.
const queryClient = new QueryClient();

startTelemetry({ getToken: () => sessionStore.getToken(), queryClient, router });

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
