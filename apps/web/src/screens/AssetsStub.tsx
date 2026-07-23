import {
  ArrowRight,
  CircleAlert,
  Gauge,
  MapPin,
  Plus,
  RotateCcw,
  Search,
  Truck,
  Wrench,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  assetDisplayName,
  assetMatches,
  summarizeAssets,
  type AssetFilter,
  type AssetLifecycleStatus,
  type AssetListItem,
} from "../assets/model.js";
import { AssetActions } from "../assets/AssetActions.js";
import { useAssets } from "../assets/useAssets.js";
import { isReadOnlyRole, useMeContext } from "../auth/me.js";
import { cn } from "../lib/utils.js";

const filters: AssetFilter[] = ["ALL", "IN_SERVICE", "ATTENTION"];

const statusStyles: Record<AssetLifecycleStatus, string> = {
  REGISTERED: "bg-sky-50 text-sky-800 ring-sky-700/15",
  IN_SERVICE: "bg-emerald-50 text-emerald-800 ring-emerald-700/15",
  UNDER_MAINTENANCE: "bg-amber-50 text-amber-900 ring-amber-700/15",
  SOLD: "bg-stone-100 text-stone-700 ring-stone-600/15",
  RETIRED: "bg-stone-100 text-stone-700 ring-stone-600/15",
  WRITTEN_OFF: "bg-red-50 text-red-800 ring-red-700/15",
};

export function AssetsStub() {
  const { t } = useTranslation();
  const { assets, status, retry } = useAssets();
  const readOnly = isReadOnlyRole(useMeContext()?.role);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AssetFilter>("ALL");

  const summary = useMemo(() => summarizeAssets(assets), [assets]);
  const visibleAssets = useMemo(
    () => assets.filter((asset) => assetMatches(asset, query, filter)),
    [assets, filter, query],
  );

  return (
    <section className="asset-page min-h-dvh">
      <header className="border-b border-foreground/10 px-4 pb-5 pt-5 sm:px-7 md:px-10 md:pb-7 md:pt-8">
        <div className="mx-auto flex w-full max-w-6xl items-end justify-between gap-5">
          <div>
            <p className="mb-2 flex items-center gap-2 text-[0.68rem] font-bold uppercase tracking-[0.19em] text-muted-foreground">
              <span className="size-1.5 rounded-full bg-[var(--signal)]" />
              {t("assets.eyebrow")}
            </p>
            <h1 className="text-balance text-[2rem] font-semibold leading-none tracking-[-0.045em] sm:text-4xl">
              {t("assets.title")}
            </h1>
            <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
              {t("assets.subtitle")}
            </p>
          </div>

          {!readOnly && (
            <a
              href="/assets/new"
              className="hidden min-h-11 shrink-0 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-semibold text-background shadow-[0_8px_24px_-12px_var(--foreground)] transition hover:-translate-y-0.5 hover:bg-primary sm:inline-flex"
            >
              <Plus className="size-4" aria-hidden />
              {t("assets.register")}
            </a>
          )}
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 pb-28 pt-5 sm:px-7 md:px-10 md:pb-10 md:pt-8">
        <dl className="grid grid-cols-3 overflow-hidden rounded-2xl border border-foreground/10 bg-card shadow-[0_16px_44px_-36px_var(--foreground)]">
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
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("assets.searchPlaceholder")}
              className="min-h-12 w-full rounded-xl border border-foreground/10 bg-card py-3 pl-11 pr-4 text-base shadow-sm outline-none transition placeholder:text-muted-foreground/75 focus:border-foreground/25 focus:ring-4 focus:ring-primary/10 sm:text-sm"
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

        <div className="mt-5" aria-live="polite">
          {status === "loading" && assets.length === 0 ? (
            <AssetSkeleton />
          ) : status === "error" && assets.length === 0 ? (
            <ErrorState onRetry={retry} />
          ) : assets.length === 0 ? (
            <EmptyState readOnly={readOnly} />
          ) : visibleAssets.length === 0 ? (
            <NoResults onReset={() => {
              setQuery("");
              setFilter("ALL");
            }} />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {visibleAssets.map((asset, index) => (
                <AssetCard key={asset.id} asset={asset} index={index} />
              ))}
            </div>
          )}
        </div>
      </div>

      {!readOnly && (
        <a
          href="/assets/new"
          aria-label={t("assets.register")}
          className="fixed bottom-24 right-4 z-20 flex size-14 items-center justify-center rounded-full bg-[var(--signal)] text-[var(--signal-foreground)] shadow-[0_18px_40px_-12px_color-mix(in_oklch,var(--signal),black_45%)] transition active:scale-95 sm:hidden"
        >
          <Plus className="size-6" aria-hidden />
        </a>
      )}
    </section>
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
    <div className="relative border-r border-foreground/10 px-3 py-4 last:border-r-0 sm:px-5 sm:py-5">
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
  const { t, i18n } = useTranslation();
  const category =
    i18n.resolvedLanguage === "en"
      ? asset.category.labelEn
      : asset.category.labelFr;

  return (
    <article
      className="asset-card relative overflow-hidden rounded-2xl border border-foreground/10 bg-card p-4 shadow-[0_12px_34px_-30px_var(--foreground)] sm:p-5"
      style={{ animationDelay: `${Math.min(index, 6) * 45}ms` }}
    >
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
            <span
              className={cn(
                "inline-flex min-h-7 items-center gap-1.5 rounded-full px-2.5 text-[0.68rem] font-bold uppercase tracking-[0.05em] ring-1 ring-inset",
                statusStyles[asset.lifecycleStatus],
              )}
            >
              <span className="size-1.5 rounded-full bg-current opacity-70" />
              {t(`assets.status.${asset.lifecycleStatus}`)}
            </span>
            <span className="inline-flex min-h-7 items-center rounded-full bg-foreground/[0.055] px-2.5 text-xs font-medium text-muted-foreground">
              {category}
            </span>
          </div>

          <div className="mt-4 flex items-center gap-1.5 border-t border-foreground/[0.07] pt-3 text-xs text-muted-foreground">
            <MapPin className="size-3.5" aria-hidden />
            <span className="truncate">{asset.branch.name}</span>
            <span aria-hidden>·</span>
            <span className="font-mono">{asset.branch.code}</span>
          </div>

          <AssetActions asset={asset} />
        </div>
      </div>
    </article>
  );
}

function EmptyState({ readOnly }: { readOnly: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="empty-grid relative overflow-hidden rounded-3xl border border-foreground/10 bg-card px-6 py-12 text-center shadow-[0_24px_60px_-52px_var(--foreground)] sm:px-10 sm:py-16">
      <div className="relative mx-auto grid size-20 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-[12px_12px_0_var(--signal)]">
        <Truck className="size-9" strokeWidth={1.55} aria-hidden />
      </div>
      <p className="relative mt-8 text-[0.68rem] font-bold uppercase tracking-[0.18em] text-muted-foreground">
        {t("assets.emptyEyebrow")}
      </p>
      <h2 className="relative mx-auto mt-2 max-w-md text-2xl font-semibold leading-tight tracking-[-0.035em] sm:text-3xl">
        {t("assets.emptyTitle")}
      </h2>
      <p className="relative mx-auto mt-3 max-w-md text-sm leading-6 text-muted-foreground">
        {t("assets.emptyHint")}
      </p>
      {!readOnly && (
        <a
          href="/assets/new"
          className="relative mt-7 inline-flex min-h-12 items-center gap-2 rounded-full bg-[var(--signal)] px-5 text-sm font-bold text-[var(--signal-foreground)] transition hover:-translate-y-0.5"
        >
          {t("assets.emptyAction")}
          <ArrowRight className="size-4" aria-hidden />
        </a>
      )}
    </div>
  );
}

function NoResults({ onReset }: { onReset: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-dashed border-foreground/20 px-5 py-12 text-center">
      <Search className="mx-auto size-7 text-muted-foreground" aria-hidden />
      <h2 className="mt-4 font-semibold">{t("assets.noResultsTitle")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("assets.noResultsHint")}
      </p>
      <button
        type="button"
        onClick={onReset}
        className="mt-5 min-h-11 rounded-full border border-foreground/15 bg-card px-4 text-sm font-semibold hover:bg-muted"
      >
        {t("assets.resetFilters")}
      </button>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-2xl border border-red-900/15 bg-red-50/70 px-5 py-10 text-center">
      <CircleAlert className="mx-auto size-7 text-red-800" aria-hidden />
      <h2 className="mt-4 font-semibold text-red-950">
        {t("assets.errorTitle")}
      </h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-red-900/70">
        {t("assets.errorHint")}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-red-950 px-4 text-sm font-semibold text-white"
      >
        <RotateCcw className="size-4" aria-hidden />
        {t("assets.retry")}
      </button>
    </div>
  );
}

function AssetSkeleton() {
  return (
    <div className="grid gap-3 lg:grid-cols-2" aria-hidden>
      {[0, 1, 2, 3].map((item) => (
        <div
          key={item}
          className="h-44 animate-pulse rounded-2xl border border-foreground/5 bg-card"
        />
      ))}
    </div>
  );
}
