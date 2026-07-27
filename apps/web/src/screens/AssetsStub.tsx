import {
  FileText,
  ArrowRight,
  Gauge,
  MapPin,
  Plus,
  RotateCcw,
  Search,
  Truck,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { localizedLabel } from "@/lib/format.js";
import { useTranslation } from "react-i18next";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  assetDisplayName,
  assetFilterStatuses,
  summarizeAssets,
  type AssetFilter,
  type AssetLifecycleStatus,
  type AssetListItem,
} from "@/assets/model.js";
import { AssetActions } from "@/assets/AssetActions.js";
import { useAssets, type UseAssetsParams } from "@/assets/useAssets.js";
import { isReadOnlyRole, useMeContext } from "@/auth/me.js";
import { cn } from "@/lib/utils.js";
import { StatusBadge } from "@/components/status-badge.js";

const filters: AssetFilter[] = ["ALL", "IN_SERVICE", "ATTENTION"];

/** Search now hits the API, so keystrokes must not each become a request. */
const SEARCH_DEBOUNCE_MS = 300;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}

const STATUS_TONES: Record<AssetLifecycleStatus, "neutral" | "success" | "warning" | "danger"> = {
  REGISTERED: "neutral",
  IN_SERVICE: "success",
  UNDER_MAINTENANCE: "warning",
  SOLD: "neutral",
  RETIRED: "neutral",
  WRITTEN_OFF: "danger",
};



export function AssetsStub() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const readOnly = isReadOnlyRole(useMeContext()?.role);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AssetFilter>("ALL");
  const debouncedSearch = useDebouncedValue(search.trim(), SEARCH_DEBOUNCE_MS);

  const params = useMemo<UseAssetsParams>(() => {
    const statuses = assetFilterStatuses(filter);
    return {
      ...(debouncedSearch === "" ? {} : { search: debouncedSearch }),
      ...(statuses === undefined ? {} : { status: statuses }),
    };
  }, [debouncedSearch, filter]);

  const assetsQuery = useAssets(params);
  const assets = useMemo(
    () => assetsQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [assetsQuery.data],
  );
  const narrowed = debouncedSearch !== "" || filter !== "ALL";

  // Server-side filtering means these count only the pages fetched under the
  // current filter, not the whole fleet.
  const summary = useMemo(() => summarizeAssets(assets), [assets]);

  return (
    <section className="asset-page">
      <div className="border-b border-border px-4 pb-5 pt-5 sm:px-7 md:px-10 md:pb-7 md:pt-8">
        <PageContainer width="wide" className="px-0 py-0">
          <p className="mb-2 flex items-center gap-2 text-[0.68rem] font-bold uppercase tracking-[0.19em] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-signal" />
            {t("assets.eyebrow")}
          </p>
          <PageHeader
            title={t("assets.title")}
            titleClassName="text-balance text-[2rem] leading-none tracking-[-0.045em] sm:text-4xl"
            actions={
              !readOnly ? (
                <a
                  href="/assets/new"
                  className="hidden min-h-11 shrink-0 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-semibold text-background shadow-[0_8px_24px_-12px_var(--foreground)] transition hover:-translate-y-0.5 hover:bg-primary sm:inline-flex"
                >
                  <Plus className="size-4" aria-hidden />
                  {t("assets.register")}
                </a>
              ) : undefined
            }
          />
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
            {t("assets.subtitle")}
          </p>
        </PageContainer>
      </div>

      <PageContainer
        width="wide"
        className="pb-24 pt-5 sm:px-7 md:px-10 md:pb-10 md:pt-8"
      >
        <dl className="grid grid-cols-3 overflow-hidden rounded-2xl border border-border bg-card shadow-[0_16px_44px_-36px_var(--foreground)]">
          <Metric
            label={t("assets.metrics.total")}
            value={summary.total}
            icon={Truck}
          />
          <Metric
            label={t("assets.metrics.inService")}
            value={summary.inService}
            icon={Gauge}
          />
          <Metric
            label={t("assets.metrics.attention")}
            value={summary.attention}
            icon={Wrench}
          />
        </dl>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="group relative block min-w-0 flex-1 sm:max-w-md">
            <span className="sr-only">{t("assets.searchLabel")}</span>
            <Search
              className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-foreground"
              aria-hidden
            />
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("assets.searchPlaceholder")}
              className="min-h-12 w-full rounded-xl border border-border bg-card py-3 pl-11 pr-4 text-base shadow-sm outline-none transition placeholder:text-muted-foreground/75 focus:border-foreground/25 focus:ring-4 focus:ring-primary/10 sm:text-sm"
            />
          </label>

          <div
            className="flex gap-1 overflow-x-auto rounded-xl bg-foreground/[0.055] p-1"
            aria-label={t("assets.filterLabel")}
          >
            {filters.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                className={cn(
                  "min-h-10 shrink-0 rounded-lg px-3.5 text-xs font-semibold transition",
                  filter === item
                    ? "bg-card text-foreground shadow-sm ring-1 ring-foreground/10"
                    : "text-muted-foreground hover:text-foreground",
                )}
                aria-pressed={filter === item}
              >
                {t(`assets.filters.${item}`)}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5" aria-live="polite" aria-busy={assetsQuery.isFetching}>
          {assetsQuery.isPending ? (
            <LoadingState
              label={t("assets.loading")}
              rows={4}
              className="grid gap-3 lg:grid-cols-2"
              rowClassName="h-44 rounded-2xl"
            />
          ) : assetsQuery.isError ? (
            <ErrorState
              message={
                <span className="flex flex-col gap-1">
                  <strong className="font-semibold text-destructive">
                    {t("assets.errorTitle")}
                  </strong>
                  <span>{t("assets.errorHint")}</span>
                </span>
              }
              retryLabel={
                <span className="flex items-center gap-2">
                  <RotateCcw className="size-4" aria-hidden />
                  {t("assets.retry")}
                </span>
              }
              onRetry={() => void assetsQuery.refetch()}
            />
          ) : assets.length === 0 && narrowed ? (
            <EmptyState
              icon={<Search className="size-7" aria-hidden />}
              message={
                <span className="flex flex-col gap-1">
                  <strong className="font-semibold text-foreground">
                    {t("assets.noResultsTitle")}
                  </strong>
                  <span>{t("assets.noResultsHint")}</span>
                </span>
              }
              action={{
                label: t("assets.resetFilters"),
                onClick: () => {
                  setSearch("");
                  setFilter("ALL");
                },
              }}
            />
          ) : assets.length === 0 ? (
            <EmptyState
              className="empty-grid relative overflow-hidden border-border bg-card shadow-[0_24px_60px_-52px_var(--foreground)] sm:px-10 sm:py-16"
              icon={
                <span className="relative grid size-20 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-[12px_12px_0_var(--signal)]">
                  <Truck className="size-9" strokeWidth={1.55} aria-hidden />
                </span>
              }
              message={
                <span className="relative flex flex-col items-center">
                  <span className="text-[0.68rem] font-bold uppercase tracking-[0.18em]">
                    {t("assets.emptyEyebrow")}
                  </span>
                  <strong className="mt-2 text-2xl font-semibold leading-tight tracking-[-0.035em] text-foreground sm:text-3xl">
                    {t("assets.emptyTitle")}
                  </strong>
                  <span className="mt-3 text-sm leading-6">{t("assets.emptyHint")}</span>
                </span>
              }
              action={
                readOnly
                  ? undefined
                  : {
                      label: (
                        <span className="flex items-center gap-2">
                          {t("assets.emptyAction")}
                          <ArrowRight className="size-4" aria-hidden />
                        </span>
                      ),
                      onClick: () => void navigate({ to: "/assets/new" }),
                    }
              }
            />
          ) : (
            <>
              <div className="grid gap-3 lg:grid-cols-2">
                {assets.map((asset, index) => (
                  <AssetCard key={asset.id} asset={asset} index={index} />
                ))}
              </div>
              {assetsQuery.hasNextPage && (
                <div className="mt-4 flex justify-center">
                  <button
                    type="button"
                    onClick={() => void assetsQuery.fetchNextPage()}
                    disabled={assetsQuery.isFetchingNextPage}
                    className="min-h-11 rounded-full border border-foreground/12 bg-card px-5 text-sm font-semibold transition hover:border-foreground/25 disabled:opacity-60"
                  >
                    {assetsQuery.isFetchingNextPage
                      ? t("assets.loading")
                      : t("assets.loadMore")}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </PageContainer>

      {!readOnly && (
        <a
          href="/assets/new"
          aria-label={t("assets.register")}
          className="fixed bottom-6 right-4 z-20 flex size-14 items-center justify-center rounded-full bg-signal text-signal-foreground shadow-[0_18px_40px_-12px_color-mix(in_oklch,var(--signal),black_45%)] transition active:scale-95 sm:hidden"
        >
          <Plus className="size-6" aria-hidden />
        </a>
      )}
    </section>
  );
}

function DocumentsLink({ assetId }: { assetId: string }) {
  const { t } = useTranslation();
  const me = useMeContext();
  if (!me?.enabledModules.includes("DOCUMENTS")) return null;
  return (
    <a
      href={`/assets/${assetId}/documents`}
      className="mt-2 inline-flex min-h-9 items-center gap-1.5 text-xs font-medium text-primary underline-offset-2 hover:underline"
    >
      <FileText className="size-3.5" aria-hidden />
      {t("documents.link")}
    </a>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof Truck;
}) {
  return (
    <div className="relative border-r border-border px-3 py-4 last:border-r-0 sm:px-5 sm:py-5">
      <Icon
        className="mb-3 size-4 text-muted-foreground sm:absolute sm:right-5 sm:top-5"
        strokeWidth={1.8}
        aria-hidden
      />
      <dd className="text-2xl font-semibold leading-none tracking-[-0.04em] sm:text-3xl">
        {value.toLocaleString()}
      </dd>
      <dt className="mt-1.5 truncate text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-muted-foreground sm:text-xs">
        {label}
      </dt>
    </div>
  );
}

function AssetCard({ asset, index }: { asset: AssetListItem; index: number }) {
  const { t } = useTranslation();
  const category = localizedLabel(asset.category);

  return (
    <Card
      className="asset-card relative gap-0 overflow-hidden rounded-2xl border border-border bg-card py-0"
      style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
    >
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start gap-3.5">
          <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/8 text-primary ring-1 ring-primary/10">
            <Truck className="size-6" strokeWidth={1.7} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-base font-semibold tracking-[-0.015em]">
                  {assetDisplayName(asset)}
                </p>
                <p className="mt-0.5 truncate font-mono text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
                  {asset.assetCode}
                  {asset.registrationNumber
                    ? ` · ${asset.registrationNumber}`
                    : ""}
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <StatusBadge tone={STATUS_TONES[asset.lifecycleStatus]}>
                {t(`assets.status.${asset.lifecycleStatus}`)}
              </StatusBadge>
              <span className="inline-flex min-h-7 items-center rounded-full bg-foreground/[0.055] px-2.5 text-xs font-medium text-muted-foreground">
                {category}
              </span>
            </div>

            <Separator className="mt-4" />
            <div className="flex items-center gap-1.5 pt-3 text-xs text-muted-foreground">
              <MapPin className="size-3.5" aria-hidden />
              <span className="truncate">{asset.branch.name}</span>
              <span aria-hidden>·</span>
              <span className="font-mono">{asset.branch.code}</span>
            </div>

            <AssetActions asset={asset} />

            <DocumentsLink assetId={asset.id} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
