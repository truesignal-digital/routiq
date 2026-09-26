import { Link, useParams } from "@tanstack/react-router";
import { ArrowRight, FileText, MapPin, Truck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AssetActions } from "@/assets/AssetActions.js";
import { ASSET_STATUS_TONES, assetDisplayName } from "@/assets/display.js";
import { useAssetDetail } from "@/assets/useAssetDetail.js";
import { useMeContext } from "@/auth/me.js";
import { ErrorState, LoadingState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { RecordHistorySheet } from "@/components/record-history-sheet.js";
import { StatusBadge } from "@/components/status-badge.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatDateTime, formatMoney, localizedLabel } from "@/lib/format.js";
import { cn } from "@/lib/utils.js";
import { OtherBranchNotice } from "@/shell/BranchScopeNotices.js";

export function AssetDetailScreen() {
  const { t, i18n } = useTranslation();
  const { assetId } = useParams({ from: "/app/assets/$assetId" });
  const me = useMeContext();
  const assetQuery = useAssetDetail(assetId);
  const locale = i18n.language;

  if (assetQuery.isPending) {
    return (
      <PageContainer width="wide">
        <LoadingState label={t("assets.detail.loading")} rows={3} />
      </PageContainer>
    );
  }

  if (assetQuery.isError || assetQuery.data === undefined) {
    return (
      <PageContainer width="wide">
        <ErrorState
          message={t("assets.detail.loadFailed")}
          retryLabel={t("assets.retry")}
          onRetry={() => void assetQuery.refetch()}
        />
      </PageContainer>
    );
  }

  const asset = assetQuery.data;
  // Absent for roles outside the ledger readers (the workshop): no money card.
  const { finance } = asset;
  const nothingPosted =
    finance !== undefined &&
    finance.revenueMinor === 0 &&
    finance.expenseMinor === 0 &&
    finance.expenseByCategory.length === 0;

  return (
    <PageContainer width="wide">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/8 text-primary ring-1 ring-primary/10">
              <Truck className="size-6" strokeWidth={1.7} aria-hidden />
            </span>
            {assetDisplayName(asset)}
          </span>
        }
        actions={
          <>
            <AssetActions asset={asset} />
            <RecordHistorySheet entityType="asset" entityId={asset.id} />
          </>
        }
      />

      <p className="mt-2 font-mono text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
        {asset.assetCode}
        {asset.registrationNumber ? ` · ${asset.registrationNumber}` : ""}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusBadge tone={ASSET_STATUS_TONES[asset.lifecycleStatus]}>
          {t(`assets.status.${asset.lifecycleStatus}`)}
        </StatusBadge>
        <span className="inline-flex min-h-7 items-center rounded-full bg-foreground/[0.055] px-2.5 text-xs font-medium text-muted-foreground">
          {localizedLabel(asset.category, locale)}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="size-3.5" aria-hidden />
          {asset.branch.name}
          <span className="font-mono">{asset.branch.code}</span>
        </span>
        {/* The record stays open: identity is workspace-scoped, so the ambient
            branch is a list lens and never an access boundary. */}
        <OtherBranchNotice branchCode={asset.branch.code} />
      </div>

      {finance !== undefined && (
      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("assets.detail.money.title")}</CardTitle>
          {/* The window is stated, never implied: a total with no period is a
              number nobody can check. */}
          <p className="text-muted-foreground text-xs uppercase tracking-wide">
            {t("assets.detail.money.allTime")}
          </p>
        </CardHeader>
        <CardContent>
          {nothingPosted ? (
            <p className="text-sm text-muted-foreground">
              {t("assets.detail.money.nothingPosted")}
            </p>
          ) : (
            <>
              <dl className="grid gap-4 sm:grid-cols-3">
                <MoneyFigure
                  label={t("assets.detail.money.revenue")}
                  minor={finance.revenueMinor}
                  currency={finance.currency}
                />
                <MoneyFigure
                  label={t("assets.detail.money.expenses")}
                  minor={finance.expenseMinor}
                  currency={finance.currency}
                />
                <MoneyFigure
                  label={t("assets.detail.money.net")}
                  minor={finance.netMinor}
                  currency={finance.currency}
                  // The whole point of the page: profit and loss must not
                  // look alike at a glance.
                  tone={finance.netMinor < 0 ? "loss" : "profit"}
                  emphasis
                />
              </dl>

              <Separator className="my-5" />

              <h3 className="text-muted-foreground text-xs uppercase tracking-wide">
                {t("assets.detail.money.byCategory")}
              </h3>
              {finance.expenseByCategory.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  {t("assets.detail.money.noExpenses")}
                </p>
              ) : (
                <ul className="mt-3 flex flex-col gap-2">
                  {finance.expenseByCategory.map((category) => (
                    <li
                      key={category.code}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span>{localizedLabel(category, locale)}</span>
                      <span className="tabular-nums">
                        {formatMoney(category.totalMinor, {
                          currency: finance.currency,
                          locale,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t("assets.detail.activities.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {asset.recentActivities.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("assets.detail.activities.empty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {asset.recentActivities.map((activity) => (
                <li key={activity.id}>
                  <Link
                    to="/activities/$activityId"
                    params={{ activityId: activity.id }}
                    className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm transition hover:bg-foreground/[0.04]"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono">{activity.activityNumber}</span>
                      <span className="text-muted-foreground">
                        {localizedLabel(activity.activityType, locale)}
                      </span>
                      {activity.customerName !== null && (
                        <span className="text-muted-foreground">
                          {activity.customerName}
                        </span>
                      )}
                      <StatusBadge
                        tone={activity.status === "OPEN" ? "info" : "neutral"}
                      >
                        {t(`activities.status.${activity.status}`)}
                      </StatusBadge>
                      {activity.completeness === "COMPLETE_WITH_EXCEPTIONS" && (
                        <StatusBadge tone="warning">
                          {t("activities.completeness.COMPLETE_WITH_EXCEPTIONS")}
                        </StatusBadge>
                      )}
                    </span>
                    <span className="text-muted-foreground tabular-nums">
                      {activity.startedAt === null
                        ? "—"
                        : formatDateTime(activity.startedAt, locale)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {me?.enabledModules.includes("DOCUMENTS") && (
        <Link
          to="/assets/$assetId/documents"
          params={{ assetId: asset.id }}
          className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full border border-foreground/12 bg-card px-5 text-sm font-semibold transition hover:border-foreground/25"
        >
          <FileText className="size-4" aria-hidden />
          {t("documents.link")}
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      )}
    </PageContainer>
  );
}

function MoneyFigure({
  label,
  minor,
  currency,
  tone,
  emphasis = false,
}: {
  label: string;
  minor: number;
  currency: string;
  tone?: "profit" | "loss";
  emphasis?: boolean;
}) {
  const { i18n } = useTranslation();

  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </dt>
      <dd
        className={cn(
          "tabular-nums tracking-[-0.03em]",
          emphasis ? "text-2xl font-semibold" : "text-xl font-medium",
          tone === "loss" && "text-destructive",
          tone === "profit" && "text-success-foreground",
        )}
      >
        {formatMoney(minor, {
          currency,
          locale: i18n.language,
          ...(tone === undefined ? {} : { signDisplay: "exceptZero" as const }),
        })}
      </dd>
    </div>
  );
}
