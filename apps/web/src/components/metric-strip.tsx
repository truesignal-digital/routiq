import { Link } from "@tanstack/react-router";
import { Info } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js";
import { moneyAmountParts } from "@/lib/format.js";
import { cn } from "@/lib/utils.js";

/** Neutral states a count; warning marks the bucket that wants someone's attention. */
export type MetricTone = "neutral" | "warning";

/** A page the tile opens; `search` presets that page's filters. */
export interface MetricLink {
  to: string;
  search?: Record<string, string | undefined>;
}

export interface MetricTile {
  /** Stable hook for tests and verify flows (`data-metric`). */
  id?: string;
  /** Already translated — the strip carries no copy of its own. */
  label: string;
  /**
   * Formatted by the caller. `null` means "not known", and renders as a dash:
   * the strip never invents a number, and a zero would be a claim (§3.4).
   */
  value: string | null;
  /** Small text after the value, such as a currency, so long amounts fit a phone tile. */
  unit?: string;
  tone?: MetricTone;
  /** One short line under the value — a unit, a qualifier, a period. */
  hint?: string;
  /** How the number is worked out, behind an info button next to the label. */
  info?: string;
  /**
   * Makes the tile a filter for the list under the strip: the caller sets the
   * table filter (and the URL) it stands for. Without it the tile only reads.
   */
  onSelect?: () => void;
  /** The list is currently filtered to this tile. */
  selected?: boolean;
  /** Makes the tile a link to another page. Not combined with `onSelect`. */
  link?: MetricLink;
  /**
   * A second line with its own destination, for work the tile's own number
   * leaves out; it cannot share the tile's link.
   */
  secondary?: MetricLink & { label: string };
}

/**
 * Two to four tiles. A fifth stops fitting a phone row without shrinking the
 * numbers past reading size. One is not a strip, but Home gates its tiles by
 * role and module, so a role that sees one module gets one tile.
 */
export type MetricTiles =
  | readonly [MetricTile]
  | readonly [MetricTile, MetricTile]
  | readonly [MetricTile, MetricTile, MetricTile]
  | readonly [MetricTile, MetricTile, MetricTile, MetricTile];

/** Literal class strings so the Tailwind scanner can see every column count. */
const COLUMNS: Record<1 | 2 | 3 | 4, string> = {
  1: "grid-cols-2 sm:grid-cols-4",
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
};

/** A list built at run time, as a strip: none when there is nothing to show. */
export function metricTiles(list: readonly MetricTile[]): MetricTiles | undefined {
  if (list.length === 0 || list.length > 4) return undefined;
  return list as unknown as MetricTiles;
}

/**
 * An amount as a tile value: the grouped figure, with the currency as the
 * small unit after it, so seven-figure amounts still fit two tiles per phone
 * row. `null` stays "not known".
 */
export function moneyMetric(
  minor: number | null | undefined,
  currency = "XAF",
): Pick<MetricTile, "value" | "unit"> {
  if (minor == null) return { value: null };
  const parts = moneyAmountParts(Math.abs(minor), { currency });
  return { value: `${minor < 0 ? "\u2212" : ""}${parts.amount}`, unit: parts.symbol };
}

const TONE_VALUE: Record<MetricTone, string> = {
  neutral: "text-foreground",
  warning: "text-warning-foreground",
};

/**
 * A band of server-computed counts. Labels stay put through every state so the
 * strip never reflows: pending swaps the numbers for skeletons, and a failed
 * read shows dashes rather than the last numbers it happened to hold. The
 * failure itself belongs to the caller's banner, which owns the retry.
 */
export function MetricStrip({
  tiles,
  isPending = false,
  isError = false,
  className,
}: {
  tiles: MetricTiles;
  isPending?: boolean;
  isError?: boolean;
  className?: string;
}) {
  const state = isPending ? "pending" : isError ? "error" : "ready";

  return (
    <dl
      data-slot="metric-strip"
      data-state={state}
      aria-busy={isPending}
      className={cn("grid gap-3 sm:gap-4", COLUMNS[tiles.length], className)}
    >
      {tiles.map((tile) => (
        <Tile key={tile.label} tile={tile} state={state} />
      ))}
    </dl>
  );
}

function Tile({
  tile,
  state,
}: {
  tile: MetricTile;
  state: "pending" | "error" | "ready";
}) {
  const { t } = useTranslation();
  const tone = tile.tone ?? "neutral";
  // A dash under a stale hint would read as if the hint still applied.
  const ready = state === "ready";
  const showHint = ready && tile.hint !== undefined;
  const showValue = ready && tile.value !== null;

  const selectable = tile.onSelect !== undefined;
  const linked = !selectable && tile.link !== undefined;
  // The label is the control; its ::after stretches over the whole card, so
  // the tile is one 44 px+ target while the dl stays a dl.
  const stretch =
    "text-start outline-none after:absolute after:inset-0 after:rounded-xl after:content-['']";

  return (
    <Card
      size="sm"
      data-slot="metric-tile"
      data-metric={tile.id}
      data-tone={tone}
      data-selected={tile.selected === true ? "" : undefined}
      className={cn(
        "h-full min-w-0",
        (selectable || linked) &&
          "relative transition-colors hover:bg-muted/50 has-focus-visible:ring-2 has-focus-visible:ring-ring",
        tile.selected === true && "bg-muted ring-2 ring-foreground/40",
      )}
    >
      <CardContent className="flex flex-col gap-1.5">
        <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {tone === "warning" && (
            <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
          )}
          {selectable ? (
            <button
              type="button"
              data-slot="metric-filter"
              aria-pressed={tile.selected === true}
              onClick={tile.onSelect}
              className={stretch}
            >
              {tile.label}
            </button>
          ) : linked ? (
            <Link
              to={tile.link!.to}
              {...(tile.link!.search === undefined ? {} : { search: tile.link!.search })}
              data-slot="metric-link"
              className={stretch}
            >
              {tile.label}
            </Link>
          ) : (
            tile.label
          )}
          {tile.info !== undefined && (
            <Tooltip>
              <TooltipTrigger
                className="relative z-10 ml-auto inline-flex rounded-sm text-muted-foreground hover:text-foreground"
                aria-label={t("common.howCalculated")}
              >
                <Info className="size-3.5" aria-hidden />
              </TooltipTrigger>
              <TooltipContent className="max-w-64">{tile.info}</TooltipContent>
            </Tooltip>
          )}
        </dt>
        <dd className="m-0">
          {state === "pending" ? (
            <Skeleton className="h-7 w-14" />
          ) : (
            <span
              data-slot="metric-value"
              className={cn(
                "font-mono text-2xl leading-none tabular-nums break-words",
                showValue ? TONE_VALUE[tone] : "text-muted-foreground",
              )}
            >
              {showValue ? tile.value : "—"}
              {showValue && tile.unit !== undefined && (
                <small className="ms-1 font-sans text-xs font-medium text-muted-foreground">
                  {tile.unit}
                </small>
              )}
            </span>
          )}
          {showHint && (
            <span className="mt-1 block text-xs text-muted-foreground">
              {tile.hint}
            </span>
          )}
          {ready && tile.secondary !== undefined && (
            // Lifted above the stretched label, so this line keeps its own
            // destination instead of inheriting the tile's.
            <Link
              to={tile.secondary.to}
              {...(tile.secondary.search === undefined ? {} : { search: tile.secondary.search })}
              data-slot="metric-secondary"
              className="relative z-10 mt-1 inline-block text-xs font-medium underline-offset-4 hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {tile.secondary.label}
            </Link>
          )}
        </dd>
      </CardContent>
    </Card>
  );
}
