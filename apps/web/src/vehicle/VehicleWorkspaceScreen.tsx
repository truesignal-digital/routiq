import { useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useNavigate, useParams, useRouter, useRouterState, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Lock, Truck } from "lucide-react";
import type { AssetDetail } from "@routiq/contracts";
import { canViewActivities } from "@/activities/permissions.js";
import { useAssetDetail } from "@/assets/useAssetDetail.js";
import { useMeContext, type MeContext } from "@/auth/me.js";
import { EmptyState, ErrorState, LoadingState } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { PermissionDenied } from "@/components/permission-denied.js";
import { contributes } from "@/modules/manifest.js";
import { canViewDocuments } from "@/documents/permissions.js";
import { useCategories } from "@/categories/useCategories.js";
import { canReadFinance, canReadFinanceEntries } from "@/finance/permissions.js";
import { canSeeWorkOrderCosts, canViewMaintenance } from "@/maintenance/permissions.js";
import { actionAvailability, actionDef, actionPermitted, type VehicleFacts } from "./actions.js";
import { AllActionsSheet } from "./AllActionsSheet.js";
import { useVehicle, VehicleCtx, type PanelControls, type PanelForm, type VehicleContextValue } from "./context.js";
import { VehicleHeader } from "./header/IdentityStrip.js";
import { VehicleStatusBlock } from "./header/StatusBlock.js";
import {
  panelParam,
  parsePanel,
  samePanel,
  viewerOf,
  type PanelRef,
  type Step,
  type VehicleActionKey,
} from "./model.js";
import { RecordPanel } from "./panel/RecordPanel.js";
import { QuickActionBar } from "./QuickActionBar.js";
import { useAssetAttention, useVehicleRefresh } from "./useVehicle.js";
import { activeTab, tabPath, VehicleTabsNav } from "./VehicleTabsNav.js";

/**
 * The vehicle workspace (#44): identity and status on top, the sections as
 * child routes, one record panel for any record, and every action in one
 * catalogue. Loading, failure and not-found look like the rest of the app.
 */
export function VehicleWorkspaceScreen() {
  const { t } = useTranslation();
  const { assetId } = useParams({ from: "/app/assets/$assetId" });
  const me = useMeContext();
  const assetQuery = useAssetDetail(assetId);

  if (assetQuery.isPending || me === undefined) {
    return (
      <PageContainer>
        <LoadingState label={t("assets.detail.loading")} rows={3} />
      </PageContainer>
    );
  }

  if (assetQuery.isError || assetQuery.data === undefined) {
    // Outside the caller's scope is a 404, never a 403: the vehicle simply is not theirs to see.
    const notFound = assetQuery.error?.message === "ASSET_DETAIL_404";
    return (
      <PageContainer>
        {notFound ? (
          <EmptyState icon={<Truck className="size-7" aria-hidden />} message={t("vehicle.page.notFound")} />
        ) : (
          <ErrorState
            message={t("assets.detail.loadFailed")}
            retryLabel={t("assets.retry")}
            onRetry={() => void assetQuery.refetch()}
          />
        )}
      </PageContainer>
    );
  }

  return <Workspace asset={assetQuery.data} me={me} />;
}

function Workspace({ asset, me }: { asset: AssetDetail; me: MeContext }) {
  const navigate = useNavigate();
  const viewer = useMemo(() => viewerOf(me), [me]);
  const modules = me.enabledModules;
  const gates = {
    maintenance: canViewMaintenance(modules),
    money: canReadFinance(me.role, modules),
    entries: canReadFinanceEntries(me.role, modules),
    workOrderCosts: canSeeWorkOrderCosts(me.role, modules),
    trips: canViewActivities(modules),
    documents: canViewDocuments(me.role, modules),
  };
  const attentionQuery = useAssetAttention(asset.id);
  const attention = attentionQuery.data?.items ?? [];
  const revenuePermitted = actionPermitted(actionDef("record-revenue"), viewer);
  const revenueCategories = useCategories("REVENUE_CATEGORY", revenuePermitted);
  const facts: VehicleFacts = {
    asset,
    attention,
    revenueCategoryCount: revenueCategories.data?.length,
  };
  const panel = usePanelControls();
  const refresh = useVehicleRefresh(asset.id);
  const [allOpen, setAllOpen] = useState(false);

  const availability = (key: VehicleActionKey) => actionAvailability(key, facts, viewer);

  const runAction = (key: VehicleActionKey) => {
    const def = actionDef(key);
    const available = availability(key);
    setAllOpen(false);
    if (!actionPermitted(def, viewer) || available.state === "locked") return;
    const target = available.target;
    switch (def.open) {
      case "form":
        panel.openStep(target === undefined ? { key } : { key, record: target });
        return;
      case "record-form":
        if (target !== undefined) panel.openStep({ key, record: target });
        return;
      case "record":
        if (target !== undefined) panel.openRecord(target);
        return;
      case "navigate":
        if (key === "start-trip") {
          void navigate({ to: "/activities/record", search: { assetId: asset.id } });
        } else {
          // A reversal starts from the entry: the posted entries are in Money.
          void navigate({ to: tabPath(asset.id, "money") });
        }
        return;
    }
  };

  const value: VehicleContextValue = {
    asset,
    me,
    viewer,
    attention,
    attentionStatus: attentionQuery.status,
    facts,
    gates,
    can: (key) => actionPermitted(actionDef(key), viewer),
    availability,
    runAction,
    openAllActions: () => setAllOpen(true),
    panel,
    refresh,
    pinnedLabel: [asset.assetCode, asset.registrationNumber, asset.branch.name]
      .filter((part): part is string => part !== null && part !== "")
      .join(" · "),
  };

  return (
    <VehicleCtx.Provider value={value}>
      <PageContainer className="pb-48 md:pb-28">
        <div className="space-y-2.5">
          <VehicleHeader />
          <VehicleStatusBlock />
        </div>
        <VehicleTabsNav />
        <div className="mt-5">
          <TabOutlet />
        </div>
        <QuickActionBar />
        <RecordPanel />
        <AllActionsSheet open={allOpen} onOpenChange={setAllOpen} />
      </PageContainer>
    </VehicleCtx.Provider>
  );
}

/**
 * The section the URL names, unless its module is off: a direct link to a
 * module's tab then says the module is not included, and its reads never run.
 */
function TabOutlet() {
  const { t } = useTranslation();
  const { asset, viewer } = useVehicle();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const tab = activeTab(pathname, asset.id);
  if (contributes("vehicleTabs", tab, viewer.enabledModules)) return <Outlet />;
  return (
    <PermissionDenied
      title={t(`vehicle.tabs.${tab}`)}
      icon={<Lock className="size-7" aria-hidden />}
      code="MODULE_DISABLED"
    />
  );
}

/**
 * The panel's page stack. The record on top is `?panel=`, so a link to it is
 * shareable and survives a reload; following a reference pushes history, so the
 * browser's Back is the panel's Back. A form lives in state only — never in the
 * URL, where a reload could resubmit it — and goes away when its record does.
 */
function usePanelControls(): PanelControls {
  const navigate = useNavigate();
  const router = useRouter();
  const search = useSearch({ from: "/app/assets/$assetId" });
  const current = parsePanel(search.panel);
  const [form, setForm] = useState<PanelForm>();
  const [trail, setTrail] = useState<PanelRef[]>([]);
  const shown = useRef(search.panel);

  useEffect(() => {
    const before = parsePanel(shown.current);
    shown.current = search.panel;
    const now = parsePanel(search.panel);
    if (samePanel(before, now)) return;
    setForm((open) =>
      open !== undefined && open.record !== undefined && !samePanel(open.record, now) ? undefined : open,
    );
    if (now === undefined) {
      setTrail([]);
      return;
    }
    // Back (ours or the browser's) lands on the record we came from.
    setTrail((stack) =>
      stack.length > 0 && samePanel(stack[stack.length - 1], now) ? stack.slice(0, -1) : stack,
    );
  }, [search.panel]);

  const setPanel = (ref: PanelRef | undefined, replace = false) =>
    void navigate({
      to: ".",
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        panel: ref === undefined ? undefined : panelParam(ref),
      }),
      replace,
    });

  const openRecord = (ref: PanelRef) => {
    if (samePanel(current, ref)) {
      setForm(undefined);
      return;
    }
    if (current !== undefined) setTrail((stack) => [...stack, current]);
    setForm((open) => (open?.record === undefined ? undefined : open));
    setPanel(ref);
  };

  const openStep = (step: Step) => {
    // Reviewing is looking at the entry: its footer holds approve and reject.
    if (step.key === "review-entry" && step.record !== undefined) {
      openRecord(step.record);
      return;
    }
    if (step.record === undefined) {
      // A record-less form is the panel's only page.
      if (current !== undefined) setPanel(undefined, true);
      setTrail([]);
      setForm({ key: step.key, record: undefined });
      return;
    }
    setForm({ key: step.key, record: step.record });
    if (!samePanel(current, step.record)) {
      if (current !== undefined) setTrail((stack) => [...stack, current]);
      setPanel(step.record);
    }
  };

  return {
    current,
    previous: trail[trail.length - 1],
    form,
    openRecord,
    openStep,
    closeForm: () => setForm(undefined),
    back: () => {
      if (trail.length > 0) router.history.back();
    },
    close: () => {
      setForm(undefined);
      setTrail([]);
      if (current !== undefined) setPanel(undefined, true);
    },
  };
}
