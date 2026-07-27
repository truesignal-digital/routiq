import { Outlet } from "@tanstack/react-router";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner.js";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MeCtx, useMe } from "../auth/me.js";
import { AppSidebar } from "./AppSidebar.js";
import { SiteHeader } from "./SiteHeader.js";

export function AppShell() {
  const me = useMe();

  return (
    <MeCtx.Provider value={me.data}>
      <TooltipProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>
            <SiteHeader />
            <div className="flex min-w-0 flex-1 flex-col">
              <Outlet />
            </div>
          </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
      <Toaster richColors position="top-center" />
    </MeCtx.Provider>
  );
}
