import { useTranslation } from "react-i18next";
import {
  Sidebar,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { SidebarBrand } from "./AppSidebar.js";

/**
 * The shell's frame while the member loads (#495): the sidebar, the header bar
 * and an empty page at their real sizes, and no rows. Rows then appear in an
 * empty frame; nothing that was drawn moves.
 */
export function ShellPending() {
  const { t } = useTranslation();
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarBrand />
      </Sidebar>
      <SidebarInset className="min-w-0" aria-busy="true">
        <header
          data-shift-region="header"
          className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-3 sm:px-4"
        >
          <SidebarTrigger aria-label={t("shell.toggleSidebar")} className="-ms-1 size-11 md:size-7" />
        </header>
        <div data-shift-region="page" className="flex min-w-0 flex-1 flex-col" />
      </SidebarInset>
    </SidebarProvider>
  );
}
