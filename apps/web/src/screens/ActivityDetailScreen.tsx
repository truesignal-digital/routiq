import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { ActivityDetail } from "@routiq/contracts";
import { useActivityActions } from "@/activities/ActivityActions.js";
import { TripStatusBadge } from "@/activities/TripStatusBadge.js";
import { ActivityLegs } from "@/activities/detail/ActivityLegs.js";
import { ActivityMoney } from "@/activities/detail/ActivityMoney.js";
import { ActivityTimeline } from "@/activities/detail/ActivityTimeline.js";
import { TripLinked, TripMoneyBox, TripOverview, useTripStatus, type TripTab } from "@/activities/detail/TripPage.js";
import { useActivity } from "@/activities/useActivities.js";
import { useMeContext } from "@/auth/me.js";
import { canReadFinance, entriesScope } from "@/finance/permissions.js";
import { contributes } from "@/modules/manifest.js";
import { ErrorState, LoadingState } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { ProvenanceStamp } from "@/components/provenance-stamp.js";
import { LatestHistory, RecordHistory } from "@/components/record-history-sheet.js";
import { RecordBody, RecordHeader, RecordTabs, TabCount } from "@/components/record-page.js";
import { StatusBlock } from "@/components/status-block.js";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime, localizedLabel } from "@/lib/format.js";
import { OtherBranchNotice } from "@/shell/BranchScopeNotices.js";

export function ActivityDetailScreen() {
  const { t } = useTranslation();
  const { activityId } = useParams({ from: "/app/activities/$activityId" });
  const activityQuery = useActivity(activityId);

  if (activityQuery.isPending) {
    return (
      <PageContainer>
        <LoadingState label={t("activities.detail.loading")} />
      </PageContainer>
    );
  }

  if (activityQuery.isError || activityQuery.data === undefined) {
    return (
      <PageContainer>
        <ErrorState
          message={t("activities.detail.loadFailed")}
          retryLabel={t("activities.retry")}
          onRetry={() => void activityQuery.refetch()}
        />
      </PageContainer>
    );
  }

  return <TripPage activity={activityQuery.data} />;
}

/**
 * The trip as a record page (#662): its number and state, the status block
 * holding the close or the fix for what is missing, Overview · Legs · Money ·
 * History, and the context column with its profit or loss, its trucks and
 * the latest history.
 */
function TripPage({ activity }: { activity: ActivityDetail }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const me = useMeContext();
  const navigate = useNavigate();
  const { tab: requested } = useSearch({ from: "/app/activities/$activityId" });
  const actions = useActivityActions(activity);

  // role-config: the trip's net is for the ledger readers; a driver reads only
  // the entries they recorded (#264).
  // Money's field on a trip: its entries and totals go with the module.
  const tripMoney = contributes("fields", "trip.money", me?.enabledModules);
  const tripTotals = tripMoney && canReadFinance(me?.role, me?.enabledModules);
  // Null for roles that read no entries, or with FINANCE off (#103). A
  // driver's list is their own entries only (#264).
  const entries = tripMoney ? activity.financialEntries : null;
  const tab: TripTab = requested === "money" && entries === null ? "overview" : (requested ?? "overview");
  const selectTab = (next: TripTab) =>
    void navigate({
      to: ".",
      search: (previous: Record<string, unknown>) => ({ ...previous, tab: next === "overview" ? undefined : next }),
      // A tab is a view of the same record: Back leaves the record, not the tab.
      replace: true,
    });

  const gaps = activity.status === "CLOSED" && activity.completeness === "COMPLETE_WITH_EXCEPTIONS";
  // Closed with things missing: completing it is reopening it to add them.
  const complete =
    gaps && actions.can.reopen ? (
      <Button onClick={() => actions.open("reopen")}>{t("activities.detail.status.complete")}</Button>
    ) : null;
  const status = useTripStatus(activity, { close: actions.buttons.close, complete });
  const headerButtons = [
    actions.buttons.leg,
    actions.buttons.reading,
    actions.buttons.expense,
    actions.buttons.substitute,
    gaps ? null : actions.buttons.reopen,
  ].filter((button) => button !== null);
  const hasTimeline = activity.plannedStartAt !== null || activity.plannedEndAt !== null;

  return (
    <PageContainer className="pb-28 md:pb-6">
      <RecordHeader
        name={activity.activityNumber}
        status={<TripStatusBadge trip={activity} />}
        facts={[
          localizedLabel(activity.activityType, locale),
          activity.customerName,
          activity.originName !== null && activity.destinationName !== null
            ? t("activities.detail.routeValue", { from: activity.originName, to: activity.destinationName })
            : null,
          activity.startedAt === null ? null : formatDate(activity.startedAt, locale),
          activity.closedAt === null ? null : t("activities.detail.closedAt", { date: formatDateTime(activity.closedAt, locale) }),
        ]}
        actions={headerButtons.length === 0 ? undefined : headerButtons}
      >
        {/* The record stays open: identity is workspace-scoped, so the ambient
            branch is a list lens and never an access boundary. */}
        <OtherBranchNotice branchId={activity.branchId} />
      </RecordHeader>

      {status !== undefined && (
        <div className="mt-4">
          <StatusBlock {...status} />
        </div>
      )}

      <RecordBody
        overview={tab === "overview"}
        tabs={
          <RecordTabs
            label={t("record.tabs.label")}
            overview={{ key: "overview", label: t("record.tabs.overview") }}
            work={[
              { key: "legs", label: t("activities.detail.legs"), marker: <TabCount n={activity.legCount} /> },
              ...(entries === null ? [] : [{ key: "money" as const, label: t("activities.detail.tabs.money") }]),
            ]}
            history={{ key: "history", label: t("record.tabs.history") }}
            active={tab}
            onSelect={selectTab}
          />
        }
        lead={entries !== null && tripTotals ? <TripMoneyBox entries={entries} onOpen={() => selectTab("money")} /> : null}
        context={
          <>
            <TripLinked activity={activity} />
            <LatestHistory entityType="activity" entityId={activity.id} onShowAll={() => selectTab("history")} />
          </>
        }
      >
        {tab === "overview" && (
          <TripOverview activity={activity}>
            {hasTimeline && <ActivityTimeline activity={activity} />}
          </TripOverview>
        )}
        {tab === "legs" &&
          (activity.legs.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("activities.detail.noLegs")}</p>
          ) : (
            <ActivityLegs legs={activity.legs} />
          ))}
        {tab === "money" &&
          entries !== null &&
          (entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("activities.detail.noMoney")}</p>
          ) : (
            <ActivityMoney entries={entries} totals={tripTotals} scope={entriesScope(me?.role)} />
          ))}
        {tab === "history" && <RecordHistory entityType="activity" entityId={activity.id} />}
      </RecordBody>

      <ProvenanceStamp
        className="mt-8"
        templateCode={activity.templateCode}
        templateVersion={activity.templateVersion}
        createdAt={activity.createdAt}
        commandId={activity.createdByCommandId}
      />

      {actions.forms}
    </PageContainer>
  );
}
