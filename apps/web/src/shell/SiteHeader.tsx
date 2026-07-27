import { useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useMeContext } from "../auth/me.js";
import { activeSection, visibleSections } from "./sections.js";

export function SiteHeader() {
  const { t } = useTranslation();
  const me = useMeContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const section = activeSection(visibleSections(me?.enabledModules), pathname);

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-3 sm:px-4">
      <SidebarTrigger
        aria-label={t("shell.toggleSidebar")}
        className="-ms-1 size-11 md:size-7"
      />
      <Separator orientation="vertical" className="h-5" />
      {/* Screens own the page <h1>; this is a location label, not a heading. */}
      <span className="truncate text-sm font-medium">
        {section === undefined ? t("app.name") : t(`nav.${section.key}`)}
      </span>
      <div className="ms-auto flex items-center gap-2" />
    </header>
  );
}
