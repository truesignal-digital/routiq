import { useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ActivityActions } from "@/activities/ActivityActions.js";
import { CompletenessBanner } from "@/activities/CompletenessBanner.js";
import { TripStatusBadge } from "@/activities/TripStatusBadge.js";
import { ActivityAssetsPanel } from "@/activities/detail/ActivityAssetsPanel.js";
import { ActivityLegs } from "@/activities/detail/ActivityLegs.js";
import { ActivityMoney } from "@/activities/detail/ActivityMoney.js";
import { ActivityOverview } from "@/activities/detail/ActivityOverview.js";
import { ActivityTimeline } from "@/activities/detail/ActivityTimeline.js";
import { useActivity } from "@/activities/useActivities.js";
import { useMeContext } from "@/auth/me.js";
import { canReadFinance, entriesScope } from "@/finance/permissions.js";
import { contributes } from "@/modules/manifest.js";
import { ErrorState, LoadingState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { ProvenanceStamp } from "@/components/provenance-stamp.js";
import { RecordHistorySheet } from "@/components/record-history-sheet.js";
import { formatDateTime, localizedLabel } from "@/lib/format.js";
import { OtherBranchNotice } from "@/shell/BranchScopeNotices.js";
import { useRecordCrumb } from "@/shell/record-crumb.js";

export function ActivityDetailScreen() {
  const { t, i18n } = useTranslation();
  const { activityId } = useParams({ from: "/app/activities/$activityId" });
  const me = useMeContext();
  const activityQuery = useActivity(activityId);
  useRecordCrumb(activityQuery.data?.activityNumber);


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

  const activity = activityQuery.data;
  const locale = i18n.language;
  // role-config: the trip's net is for the ledger readers; a driver reads only
  // the entries they recorded (#264).
  // Money's field on a trip: its entries and totals go with the module.
  const tripMoney = contributes("fields", "trip.money", me?.enabledModules);
  const tripTotals = tripMoney && canReadFinance(me?.role, me?.enabledModules);

  // The two halves of the middle band each disappear on their own; a lone
  // survivor takes the full width rather than sitting beside a hole.
  const hasTimeline = activity.plannedStartAt !== null || activity.plannedEndAt !== null;
  const hasAssets =
    activity.segments.length > 0 ||
    activity.crew.length > 0 ||
    activity.readings.length > 0;
  const middleColumns = (hasTimeline ? 1 : 0) + (hasAssets ? 1 : 0);

  return (
    <PageContainer>
      <PageHeader
        title={activity.activityNumber}
        actions={
          <>
            <ActivityActions activity={activity} />
            <RecordHistorySheet entityType="activity" entityId={activity.id} />
          </>
        }
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <TripStatusBadge trip={activity} />
        {/* The record stays open: identity is workspace-scoped, so the ambient
            branch is a list lens and never an access boundary. */}
        <OtherBranchNotice branchId={activity.branchId} />
        <span className="text-muted-foreground text-sm">
          {localizedLabel(activity.activityType, locale)}
        </span>
        {activity.customerName !== null && (
          <span className="text-muted-foreground text-sm">{activity.customerName}</span>
        )}
        {activity.clientReference !== null && (
          <span className="text-muted-foreground text-sm">
            {t("activities.detail.clientReference")} {activity.clientReference}
          </span>
        )}
        {activity.closedAt !== null && (
          <span className="text-muted-foreground text-sm">
            {t("activities.detail.closedAt", {
              date: formatDateTime(activity.closedAt, locale),
            })}
          </span>
        )}
      </div>

      {activity.description !== null && activity.description !== "" && (
        <p className="mt-3 text-sm">{activity.description}</p>
      )}

      {/* An open activity has no verdict yet, and the spacer must go with it. */}
      {activity.completeness !== null && (
        <div className="mt-6">
          <CompletenessBanner
            completeness={activity.completeness}
            codes={activity.completenessCodes}
          />
        </div>
      )}

      <div className="mt-6 flex flex-col gap-6">
        <ActivityOverview activity={activity} showNet={tripTotals} />

        {middleColumns > 0 && (
          <div className={middleColumns === 2 ? "grid gap-6 lg:grid-cols-2" : undefined}>
            <ActivityTimeline activity={activity} />
            <ActivityAssetsPanel activity={activity} />
          </div>
        )}

        <ActivityLegs legs={activity.legs} />
        {/* Null for roles that read no entries, or with FINANCE off (#103). A
            driver's list is their own entries only (#264). */}
        {tripMoney && activity.financialEntries !== null && (
          <ActivityMoney
            entries={activity.financialEntries}
            totals={tripTotals}
            scope={entriesScope(me?.role)}
          />
        )}
      </div>

      <ProvenanceStamp
        className="mt-8"
        templateCode={activity.templateCode}
        templateVersion={activity.templateVersion}
        createdAt={activity.createdAt}
        commandId={activity.createdByCommandId}
      />
    </PageContainer>
  );
}
