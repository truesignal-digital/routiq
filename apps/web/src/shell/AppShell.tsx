import { useEffect } from "react";
import { Outlet } from "@tanstack/react-router";
import { PageNoticeProvider } from "@/components/page-container";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/toast.js";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApprovalRulesNotice } from "../approval-rules/ApprovalRulesNotice.js";
import { useRecheckApprovalChainOnNavigation } from "../approval-rules/useApprovalChain.js";
import { MeCtx, useMe } from "../auth/me.js";
import { i18n } from "../i18n/index.js";
import { applyPresetVocabulary, presetVocabularyFor } from "../i18n/preset-overlay.js";
import { AppSidebar } from "./AppSidebar.js";
import { BottomBar } from "./BottomBar.js";
import { BranchProvider, useCurrentBranch } from "./branch-context.js";
import { ModulePageGate } from "./ModulePageGate.js";
import { OfflineNotice } from "./OfflineNotice.js";
import { RecordCrumbProvider } from "./record-crumb.js";
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
  useRecheckApprovalChainOnNavigation();
  const preset = presetVocabularyFor(me.data?.enabledPresets);

  // The overlay mutates a shared store, so it is cleared on unmount: logging
  // out or switching workspace must never leak the last tenant's vocabulary.
  useEffect(() => {
    applyPresetVocabulary(i18n, preset);
    return () => applyPresetVocabulary(i18n, undefined);
  }, [preset]);

  return (
    <MeCtx.Provider value={me.data}>
      {/* Inside the shell, so every screen under it reads the same ambient
          branch; it is client state only and never widens server scope. */}
      <BranchProvider>
        <TooltipProvider>
          <SidebarProvider>
            <AppSidebar />
            {/* A flex item beside the sidebar: without min-w-0 a wide table's
                min-content width widens the whole page (#450). */}
            <SidebarInset className="min-w-0 [--bottom-bar:calc(4rem+env(safe-area-inset-bottom))] md:[--bottom-bar:0px]">
              <RecordCrumbProvider>
                <SiteHeader />
                <BranchScopeAnnouncer />
                <OfflineNotice />
                <div className="flex min-w-0 flex-1 flex-col pb-(--bottom-bar)">
                  {/* Rendered by each page's container, in the page's column (#467). */}
                  <PageNoticeProvider notice={<ApprovalRulesNotice />}>
                    <ModulePageGate>
                      <Outlet />
                    </ModulePageGate>
                  </PageNoticeProvider>
                </div>
                <BottomBar />
              </RecordCrumbProvider>
            </SidebarInset>
          </SidebarProvider>
        </TooltipProvider>
      </BranchProvider>
      <Toaster />
    </MeCtx.Provider>
  );
}
