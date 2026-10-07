import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ClipboardCheck, TrendingDown, TrendingUp, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DashboardResponse } from "@routiq/contracts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMeContext } from "@/auth/me.js";
import { formatMoney, notRecorded } from "@/lib/format.js";
import { cn } from "@/lib/utils";
import { canOpenEntriesList, visibleDashboardCards, type DashboardCardKey } from "./cards.js";

const CARD_ICONS: Record<DashboardCardKey, LucideIcon> = {
  pendingApprovals: ClipboardCheck,
  assets: Truck,
  openPeriodExpense: TrendingDown,
  openPeriodRevenue: TrendingUp,
};

export function SectionCards({
  data,
  isPending,
}: {
  data: DashboardResponse | undefined;
  isPending: boolean;
}) {
  const { t } = useTranslation();
  const me = useMeContext();
  const keys = visibleDashboardCards(me?.role, me?.enabledModules);
  const entriesReachable = canOpenEntriesList(me?.role, me?.enabledModules);

  if (keys.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {keys.map((key) => (
        <KpiCard
          key={key}
          cardKey={key}
          title={t(`home.cards.${key}.title`)}
          to={cardTarget(key, entriesReachable)}
          search={key === "openPeriodExpense" || key === "openPeriodRevenue"
            ? { periodCode: data?.openPeriod?.periodCode, status: "LEDGER", direction: key === "openPeriodExpense" ? "EXPENSE" : "REVENUE" }
            : undefined}
          isPending={isPending}
        >
          {data === undefined ? undefined : cardBody(key, data, t)}
        </KpiCard>
      ))}
    </div>
  );
}

function cardTarget(key: DashboardCardKey, entriesReachable: boolean): string | undefined {
  if (key === "pendingApprovals") return "/finance/approvals";
  if (key === "assets") return "/assets";
  return entriesReachable ? "/finance/entries" : undefined;
}

interface CardBody {
  value: string;
  description: string;
  /**
   * A second line the card only sometimes has to say, with its own destination
   * — the overflow is about work the card's own number excludes, so it cannot
   * land on the same preset view the card links to.
   */
  secondary?: { label: string; to: string; search: Record<string, string> };
}

type Translate = ReturnType<typeof useTranslation>["t"];

function cardBody(
  key: DashboardCardKey,
  data: DashboardResponse,
  t: Translate,
): CardBody {
  if (key === "pendingApprovals") {
    // The count follows the shell's agency, so the card has to say what that
    // narrowing leaves out or the rest of the queue goes unmentioned.
    // Null only when the API withholds finance from this caller; the card is
    // gated to approvers, so this is the brief window before /v1/me agrees.
    if (data.pendingApprovals === null) {
      return { value: notRecorded(), description: t("home.cards.financeUnavailable") };
    }
    const { count, outsideBranchCount } = data.pendingApprovals;
    return {
      value: String(count),
      description: t("home.cards.pendingApprovals.description", { count }),
      ...(outsideBranchCount === 0
        ? {}
        : {
            secondary: {
              label: t("home.cards.pendingApprovals.outsideBranch", {
                count: outsideBranchCount,
              }),
              // Widened on arrival: the queue would otherwise preset itself to
              // the very agency this line is counting around.
              to: "/finance/approvals",
              search: { branch: "all" },
            },
          }),
    };
  }

  if (key === "assets") {
    return {
      value: String(data.assets.byStatus.IN_SERVICE),
      description: t("home.cards.assets.description", { count: data.assets.total }),
    };
  }

  const { openPeriod } = data;
  // No open period means nothing has been posted yet — said in words, never a
  // zero, because a zero would claim the period balanced (§3.4).
  if (openPeriod === null) {
    return { value: notRecorded(), description: t("home.cards.noOpenPeriod") };
  }

  const minor =
    key === "openPeriodExpense"
      ? openPeriod.postedExpenseMinor
      : openPeriod.postedRevenueMinor;

  return {
    value: formatMoney(minor, { currency: openPeriod.currency }),
    description: t("home.cards.periodDescription", { period: openPeriod.periodCode }),
  };
}

function KpiCard({
  cardKey,
  title,
  to,
  search,
  isPending,
  children,
}: {
  cardKey: DashboardCardKey;
  title: string;
  to: string | undefined;
  search: { periodCode: string | undefined; status: "LEDGER"; direction: "EXPENSE" | "REVENUE" } | undefined;
  isPending: boolean;
  children: CardBody | undefined;
}) {
  const Icon = CARD_ICONS[cardKey];
  const secondary = children?.secondary;

  return (
    <Card
      data-slot="kpi-card"
      data-kpi={cardKey}
      className={cn(
        "relative h-full",
        to !== undefined && "transition-colors hover:bg-accent",
      )}
    >
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Icon className="size-4" aria-hidden />
          {title}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {children === undefined ? (
          <KpiPlaceholder isPending={isPending} />
        ) : (
          <>
            <CardTitle data-slot="kpi-value" className="font-mono text-2xl tabular-nums">
              {children.value}
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">{children.description}</p>
            {secondary !== undefined && (
              // Lifted above the card-wide overlay below, so this line keeps
              // its own destination instead of inheriting the card's.
              <Link
                to={secondary.to}
                search={secondary.search}
                data-slot="kpi-secondary"
                className="relative z-10 mt-1 inline-block text-xs font-medium underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {secondary.label}
              </Link>
            )}
          </>
        )}
      </CardContent>
      {/* The whole card is the primary target. A stretched overlay says that
          without nesting the line above inside another link. */}
      {to !== undefined && (
        <Link
          to={to}
          {...(search === undefined ? {} : { search })}
          aria-label={title}
          className="absolute inset-0 rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      )}
    </Card>
  );
}

/**
 * The error case leaves the value blank rather than showing a stale or invented
 * number; the banner above the grid carries the failure and the retry.
 */
function KpiPlaceholder({ isPending }: { isPending: boolean }): ReactNode {
  if (!isPending) {
    return (
      <div
        data-slot="kpi-value"
        className="font-mono text-2xl text-muted-foreground tabular-nums"
      >
        —
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-7 w-24" />
      <Skeleton className="h-3 w-32" />
    </div>
  );
}
