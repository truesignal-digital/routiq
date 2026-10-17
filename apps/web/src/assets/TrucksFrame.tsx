import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeContext } from "@/auth/me.js";
import { useCommandLabel } from "@/commands/labels.js";
import { ModulePage, type ModulePageTab } from "@/components/module-page.js";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { canManageAssets } from "./permissions.js";
import { activeTrucksTab, TRUCKS_TAB_PATH, visibleTrucksTabs, type TrucksTab } from "./trucksTabs.js";

/**
 * The Trucks page (#665, dashboards.html#trucks): one header and one tab bar
 * over Overview, the list and the fleet's Documents. The tabs are child
 * routes, so the header stays put and each tab has its own address. The shell
 * opens it only while Assets is on (`ModulePageGate`).
 */
export function TrucksFrame() {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const me = useMeContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const canManage = canManageAssets(me?.role, me?.enabledModules);

  const tabs: ModulePageTab<TrucksTab>[] = visibleTrucksTabs(me?.role, me?.enabledModules).map((tab) => ({
    key: tab,
    label: tab === "list" ? t("assets.title") : t(`assets.page.tabs.${tab}`),
    to: TRUCKS_TAB_PATH[tab],
  }));

  return (
    <ModulePage
      title={t("assets.title")}
      tabsLabel={t("assets.page.tabs.label")}
      tabs={tabs}
      active={activeTrucksTab(pathname)}
      action={
        canManage ? (
          // A link styled as a button (#136); on a phone the round button below stands in.
          <Link to="/assets/new" className={cn(buttonVariants(), "hidden sm:inline-flex")}>
            <Plus aria-hidden />
            {label("register-asset")}
          </Link>
        ) : undefined
      }
    >
      <Outlet />
      {canManage && (
        <Link
          to="/assets/new"
          aria-label={label("register-asset")}
          className="fixed right-4 bottom-[calc(var(--bottom-bar,0px)+1rem)] z-20 flex size-14 items-center justify-center rounded-full bg-signal text-signal-foreground shadow-lg transition active:scale-95 sm:hidden"
        >
          <Plus className="size-6" aria-hidden />
        </Link>
      )}
    </ModulePage>
  );
}
