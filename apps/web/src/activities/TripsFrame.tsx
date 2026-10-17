import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { FilePlus2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeContext } from "@/auth/me.js";
import { useCommandLabel } from "@/commands/labels.js";
import { ModulePage, type ModulePageTab } from "@/components/module-page.js";
import { Button } from "@/components/ui/button";
import { canRecordActivities } from "./permissions.js";
import { activeTripsTab, TRIPS_TAB_PATH, visibleTripsTabs, type TripsTab } from "./tripsTabs.js";

/**
 * The Trips page (#665, dashboards.html#trips): one header and one tab bar
 * over Overview, the list and, while Scheduling is on, Planning. The shell
 * opens it only while Trips is on (`ModulePageGate`).
 */
export function TripsFrame() {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const navigate = useNavigate();
  const me = useMeContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const canRecord = canRecordActivities(me?.role, me?.enabledModules);

  const tabs: ModulePageTab<TripsTab>[] = visibleTripsTabs(me?.role, me?.enabledModules).map((tab) => ({
    key: tab,
    label: tab === "list" ? t("activities.title") : t(`activities.page.tabs.${tab}`),
    to: TRIPS_TAB_PATH[tab],
  }));

  return (
    <ModulePage
      title={t("activities.title")}
      tabsLabel={t("activities.page.tabs.label")}
      tabs={tabs}
      active={activeTripsTab(pathname)}
      action={
        canRecord ? (
          <Button type="button" onClick={() => void navigate({ to: "/activities/record" })}>
            <FilePlus2 className="size-4" aria-hidden />
            {label("record-journey-sheet")}
          </Button>
        ) : undefined
      }
    >
      <Outlet />
    </ModulePage>
  );
}
