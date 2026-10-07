import { useTranslation } from "react-i18next";

import { Card, CardContent } from "@/components/ui/card.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { notRecorded } from "@/lib/format.js";
import { cn } from "@/lib/utils.js";

/** Neutral states a count; warning marks the bucket that wants someone's attention. */
export type MetricTone = "neutral" | "warning";

export interface MetricTile {
  /** Already translated — the strip carries no copy of its own. */
  label: string;
  /**
   * Formatted by the caller. `null` means "not known", and reads "Not
   * recorded": the strip never invents a number, and a zero would be a claim (§3.4).
   */
  value: string | null;
  tone?: MetricTone;
  /** One short line under the value — a unit, a qualifier, a period. */
  hint?: string;
}

/**
 * Two to four tiles. One is not a strip, and a fifth stops fitting a phone row
 * without shrinking the numbers past reading size.
 */
export type MetricTiles =
  | readonly [MetricTile, MetricTile]
  | readonly [MetricTile, MetricTile, MetricTile]
  | readonly [MetricTile, MetricTile, MetricTile, MetricTile];

/** Literal class strings so the Tailwind scanner can see every column count. */
const COLUMNS: Record<2 | 3 | 4, string> = {
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
};

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
  const showHint = state === "ready" && tile.hint !== undefined;

  return (
    <Card size="sm" data-slot="metric-tile" data-tone={tone} className="h-full">
      <CardContent className="flex flex-col gap-1.5">
        <dt className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {tone === "warning" && (
            <span className="size-1.5 shrink-0 rounded-full bg-warning" aria-hidden />
          )}
          {tile.label}
        </dt>
        <dd className="m-0">
          {state === "pending" ? (
            <Skeleton className="h-7 w-14" />
          ) : (
            <span
              data-slot="metric-value"
              className={cn(
                "font-mono text-2xl leading-none tabular-nums",
                state === "error" || tile.value === null
                  ? "text-muted-foreground"
                  : TONE_VALUE[tone],
              )}
            >
              {state === "error" ? (
                // The one dash left in the app (guard no-bare-dash): a read
                // that failed has no value to name, so the label says why.
                <span role="img" aria-label={t("common.readFailed")}>—</span>
              ) : (
                (tile.value ?? <span className="text-base">{notRecorded()}</span>)
              )}
            </span>
          )}
          {showHint && (
            <span className="mt-1 block text-xs text-muted-foreground">
              {tile.hint}
            </span>
          )}
        </dd>
      </CardContent>
    </Card>
  );
}
