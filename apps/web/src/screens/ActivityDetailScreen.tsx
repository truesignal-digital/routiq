import { useParams } from "@tanstack/react-router";
import { Route as RouteIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ActivityActions } from "@/activities/ActivityActions.js";
import { CompletenessBanner } from "@/activities/CompletenessBanner.js";
import { canViewActivities } from "@/activities/permissions.js";
import { useActivity } from "@/activities/useActivities.js";
import { useMeContext } from "@/auth/me.js";
import { ErrorState, LoadingState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { deniedCode, PermissionDenied } from "@/components/permission-denied.js";
import { StatusBadge } from "@/components/status-badge.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatDateTime, formatMoney, localizedLabel } from "@/lib/format.js";

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs uppercase tracking-wide">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

export function ActivityDetailScreen() {
  const { t, i18n } = useTranslation();
  const { activityId } = useParams({ from: "/app/activities/$activityId" });
  const me = useMeContext();
  const canView = canViewActivities(me?.enabledModules);
  const activityQuery = useActivity(activityId);

  if (me !== undefined && !canView) {
    return (
      <PermissionDenied
        title={t("activities.title")}
        icon={<RouteIcon className="size-7" aria-hidden />}
        code={deniedCode(me.enabledModules.includes("ACTIVITIES"))}
      />
    );
  }

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

  return (
    <PageContainer width="wide">
      <PageHeader
        title={activity.activityNumber}
        actions={<ActivityActions activity={activity} />}
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusBadge tone={activity.status === "OPEN" ? "info" : "neutral"}>
          {t(`activities.status.${activity.status}`)}
        </StatusBadge>
        <span className="text-muted-foreground text-sm">
          {localizedLabel(activity.activityType, locale)}
        </span>
      </div>

      <div className="mt-6">
        <CompletenessBanner
          completeness={activity.completeness}
          codes={activity.completenessCodes}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("activities.detail.summary")}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-4">
              <Field
                label={t("activities.columns.customer")}
                value={activity.customerName ?? "—"}
              />
              <Field
                label={t("activities.detail.clientReference")}
                value={activity.clientReference ?? "—"}
              />
              <Field
                label={t("activities.columns.startedAt")}
                value={
                  activity.startedAt === null
                    ? "—"
                    : formatDateTime(activity.startedAt, locale)
                }
              />
              <Field
                label={t("activities.detail.endedAt")}
                value={
                  activity.endedAt === null ? "—" : formatDateTime(activity.endedAt, locale)
                }
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("activities.detail.assets")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {activity.segments.map((segment) => (
              <div key={segment.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono">{segment.assetCode}</span>
                <StatusBadge tone={segment.role === "SUBSTITUTE" ? "warning" : "neutral"}>
                  {t(`activities.roles.${segment.role}`)}
                </StatusBadge>
                <span className="text-muted-foreground">
                  {formatDateTime(segment.startedAt, locale)}
                  {" → "}
                  {segment.endedAt === null
                    ? t("activities.detail.stillRunning")
                    : formatDateTime(segment.endedAt, locale)}
                </span>
              </div>
            ))}
            {activity.crew.length > 0 && (
              <>
                <Separator />
                <div className="flex flex-wrap gap-2">
                  {activity.crew.map((member) => (
                    <span key={member.personId} className="text-sm">
                      {member.displayName}
                      <span className="text-muted-foreground">
                        {" · "}
                        {t(`activities.crewRoles.${member.role}`)}
                      </span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {activity.legs.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{t("activities.detail.legs")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="flex flex-col gap-2">
              {activity.legs.map((leg) => (
                <li key={leg.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="text-muted-foreground tabular-nums">{leg.legNo}.</span>
                  <span>
                    {leg.originName} → {leg.destinationName}
                  </span>
                  {leg.distanceKm !== null && (
                    <span className="text-muted-foreground tabular-nums">
                      {t("activities.detail.km", { count: leg.distanceKm })}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}

      {activity.financialEntries.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{t("activities.detail.money")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {activity.financialEntries.map((entry) => (
                <li
                  key={entry.entryId}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono">{entry.entryNumber}</span>
                    <span className="text-muted-foreground">
                      {entry.categoryCode}
                    </span>
                    {/* A line still awaiting approval is the one thing a reader
                        must not mistake for money already in the books. */}
                    <StatusBadge tone={entry.status === "POSTED" ? "success" : "warning"}>
                      {t(`finance.entries.status.${entry.status}`)}
                    </StatusBadge>
                  </span>
                  <span className="tabular-nums">
                    {formatMoney(entry.amountMinor, { locale })}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
