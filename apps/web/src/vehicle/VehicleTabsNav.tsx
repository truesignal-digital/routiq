import type { ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { ModuleCode } from "@routiq/contracts";
import { RecordTabs, type RecordTab } from "@/components/record-page.js";
import { contributes } from "@/modules/manifest.js";
import { useVehicle, type VehicleGates } from "./context.js";
import { tabMarkers } from "./flow.js";

/** Overview first, History last (#662): Details sits before History. */
export const VEHICLE_TABS = ["now", "maintenance", "money", "trips", "documents", "details", "history"] as const;
export type VehicleTab = (typeof VEHICLE_TABS)[number];

const SEGMENT: Record<VehicleTab, string> = {
  now: "",
  maintenance: "maintenance",
  money: "money",
  trips: "trips",
  documents: "documents",
  history: "history",
  details: "details",
};

/** role-config: the tabs a role may not read even with their module on; the module comes from its manifest. */
const GATE: Partial<Record<VehicleTab, keyof VehicleGates>> = {
  money: "money",
  documents: "documents",
};

/** Whether a tab is there for this viewer: its module on (manifest) and its gate open. */
export function tabShown(
  tab: VehicleTab,
  gates: VehicleGates,
  enabledModules: readonly ModuleCode[],
): boolean {
  if (!contributes("vehicleTabs", tab, enabledModules)) return false;
  const gate = GATE[tab];
  return gate === undefined || gates[gate];
}

export function visibleTabs(gates: VehicleGates, enabledModules: readonly ModuleCode[]): VehicleTab[] {
  return VEHICLE_TABS.filter((tab) => tabShown(tab, gates, enabledModules));
}

/** Which section the URL is on: the segment after the vehicle id, "now" when there is none. */
export function activeTab(pathname: string, assetId: string): VehicleTab {
  const rest = pathname.split(`/assets/${assetId}`)[1] ?? "";
  const segment = rest.split("/").filter(Boolean)[0] ?? "";
  return VEHICLE_TABS.find((tab) => SEGMENT[tab] === segment) ?? "now";
}

export function tabPath(assetId: string, tab: VehicleTab): string {
  const segment = SEGMENT[tab];
  return segment === "" ? `/assets/${assetId}` : `/assets/${assetId}/${segment}`;
}

/**
 * The sections as links, sticky under the shell header and scrollable on a
 * phone. Switching keeps the month and drops the panel and a tab's filters.
 */
export function VehicleTabsNav() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { asset, gates, attention, viewer } = useVehicle();
  const tabs = visibleTabs(gates, viewer.enabledModules);
  const active = activeTab(pathname, asset.id);
  const markers = tabMarkers(attention, asset, viewer);

  const markerFor = (tab: VehicleTab): ReactNode => {
    if (tab === "now" && markers.todoCount > 0) return <NumberMarker n={markers.todoCount} />;
    if (tab === "maintenance" && markers.maintenanceNeedsYou) return <DotMarker />;
    return null;
  };

  const tab = (key: VehicleTab): RecordTab<VehicleTab> => ({
    key,
    label: t(`vehicle.tabs.${key}`),
    marker: markerFor(key),
  });
  const work = tabs.filter((key) => key !== "now" && key !== "history").map(tab);

  return (
    <RecordTabs
      className="mt-5"
      label={t("vehicle.tabs.label")}
      overview={tab("now")}
      work={work}
      history={tabs.includes("history") ? tab("history") : undefined}
      active={active}
      onSelect={(key) =>
        void navigate({
          to: tabPath(asset.id, key),
          search: (previous: { period?: string | undefined }) => ({ period: previous.period }),
        })
      }
      link={(key) => (
        <Link
          to={tabPath(asset.id, key)}
          search={(previous: { period?: string | undefined }) => ({ period: previous.period })}
        />
      )}
    />
  );
}

function NumberMarker({ n }: { n: number }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] bg-foreground px-1 text-[11px] font-semibold text-background tabular-nums">
      {n}
      <span className="sr-only"> {t("vehicle.tabs.toDoCount", { count: n })}</span>
    </span>
  );
}

function DotMarker() {
  const { t } = useTranslation();
  return (
    <span className="relative -top-1.5 size-1.5 rounded-full bg-foreground">
      <span className="sr-only">{t("vehicle.tabs.needsYou")}</span>
    </span>
  );
}
