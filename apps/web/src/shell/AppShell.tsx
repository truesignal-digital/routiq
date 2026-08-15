import { Outlet } from "@tanstack/react-router";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/toast.js";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MeCtx, useMe } from "../auth/me.js";
import { AppSidebar } from "./AppSidebar.js";
import { BranchProvider, useCurrentBranch } from "./branch-context.js";
import { SiteHeader } from "./SiteHeader.js";

/**
 * A branch switch changes what every collection shows without moving focus, so
 * the only thing a screen reader would otherwise notice is rows quietly
 * changing underneath it.
 */
function BranchScopeAnnouncer() {
  const { announcement } = useCurrentBranch();
  return (
    <div role="status" aria-live="polite" className="sr-only">
      {announcement}
    </div>
  );
}

export function AppShell() {
  const me = useMe();

  return (
    <MeCtx.Provider value={me.data}>
      {/* Inside the shell, so every screen under it reads the same ambient
          branch; it is client state only and never widens server scope. */}
      <BranchProvider>
        <TooltipProvider>
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
              <SiteHeader />
              <BranchScopeAnnouncer />
              <div className="flex min-w-0 flex-1 flex-col">
                <Outlet />
              </div>
            </SidebarInset>
          </SidebarProvider>
        </TooltipProvider>
      </BranchProvider>
      <Toaster />
    </MeCtx.Provider>
  );
}
