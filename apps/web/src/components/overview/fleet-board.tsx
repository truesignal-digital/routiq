import { useState } from "react";
import { Link } from "@tanstack/react-router";
import type { DailyStatus } from "@routiq/contracts";
import { useTranslation } from "react-i18next";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { NotRecorded } from "@/components/not-recorded";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatDayMonth, formatPercent, notRecorded } from "@/lib/format.js";
import { cn } from "@/lib/utils";
import { ChartViewToggle } from "./chart-view-toggle.js";

export interface FleetBoardRow {
  key: string;
  /** The vehicle's code. */
  label: string;
  /** Its own page. */
  to?: string;
  /** One status per board day, oldest first. */
  days: readonly DailyStatus[];
}

/** The legend's order: the day's use first, then what kept it off the road, then the unknown. */
const LEGEND: readonly DailyStatus[] = ["ON_TRIP", "AVAILABLE", "WORKSHOP", "GROUNDED", "NOT_RECORDED"];

/** Semantic tokens only (DESIGN.md): the series hue for use, muted for idle, status tones for the workshop and grounding. */
const CELL: Record<DailyStatus, string> = {
  ON_TRIP: "bg-series-1",
  AVAILABLE: "bg-chart-1",
  WORKSHOP: "bg-warning",
  GROUNDED: "bg-destructive",
  NOT_RECORDED: "border border-dashed border-muted-foreground/50",
};

/** Day labels under the grid: a date each week, today last (dashboards.html#trucks). */
const LABELLED_DAYS_BACK = [29, 22, 15, 8];

type Translate = ReturnType<typeof useTranslation>["t"];

function statusWord(status: DailyStatus, t: Translate): string {
  return status === "NOT_RECORDED" ? t("common.notRecorded") : t(`overview.fleetBoard.status.${status}`);
}

function shortDay(iso: string, language: string | undefined): string {
  return formatDayMonth(iso, language, { month: "short" });
}

interface Tally {
  row: FleetBoardRow;
  counts: Record<DailyStatus, number>;
  /** Days on a trip ÷ days recorded; null when none was recorded. */
  onTheRoad: number | null;
}

function tally(row: FleetBoardRow): Tally {
  const counts: Record<DailyStatus, number> = { ON_TRIP: 0, AVAILABLE: 0, WORKSHOP: 0, GROUNDED: 0, NOT_RECORDED: 0 };
  for (const day of row.days) counts[day] += 1;
  const recorded = row.days.length - counts.NOT_RECORDED;
  return { row, counts, onTheRoad: recorded > 0 ? Math.round((counts.ON_TRIP / recorded) * 100) : null };
}

/**
 * What did each vehicle do, day by day? (dashboards.html, FleetBoard): a row
 * per vehicle, a cell per day, oldest first and today last, coloured by the
 * day's status with a legend. Every cell has its words as its accessible name,
 * and the line under the grid reads out the cell under the pointer (one line,
 * not one tooltip per cell). A phone gets today's status list instead; the
 * table view counts each status per vehicle.
 */
export function FleetBoard({ rows, days }: { rows: readonly FleetBoardRow[]; days: readonly string[] }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage;
  const isMobile = useIsMobile();
  const [view, setView] = useState<"chart" | "table">("chart");
  const [pointed, setPointed] = useState<string | null>(null);
  const dayLabels = days.map((day) => shortDay(day, language));

  if (isMobile) return <TodayList rows={rows} days={days.length} />;

  return (
    <div data-slot="fleet-board" className="flex flex-col gap-2">
      {view === "table" ? (
        <BoardTable rows={rows} />
      ) : (
        <>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" data-slot="fleet-board-legend">
            {LEGEND.map((status) => (
              <li key={status} className="inline-flex items-center gap-1.5">
                <i aria-hidden className={cn("inline-block size-3 rounded-[3px]", CELL[status])} />
                {statusWord(status, t)}
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-1" onPointerLeave={() => setPointed(null)}>
            {rows.map((row) => (
              <div key={row.key} data-slot="fleet-board-row" className="flex items-center gap-2">
                <span className="w-20 shrink-0 truncate text-sm">
                  {row.to === undefined ? (
                    <span className="font-medium tabular-nums">{row.label}</span>
                  ) : (
                    <Link to={row.to} className="font-medium tabular-nums underline-offset-4 hover:underline">
                      {row.label}
                    </Link>
                  )}
                </span>
                <div className="grid flex-1 gap-[2px]" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
                  {row.days.map((status, index) => {
                    const name = t("overview.fleetBoard.cell", {
                      vehicle: row.label,
                      date: dayLabels[index] ?? "",
                      status: statusWord(status, t),
                    });
                    return (
                      <span
                        key={days[index] ?? index}
                        role="img"
                        aria-label={name}
                        data-status={status}
                        className={cn("h-5 rounded-[2px]", CELL[status])}
                        onPointerEnter={() => setPointed(name)}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="flex items-center gap-2" aria-hidden>
              <span className="w-20 shrink-0" />
              <div className="relative h-4 flex-1 text-[11px] text-muted-foreground tabular-nums">
                {LABELLED_DAYS_BACK.filter((back) => back < days.length).map((back) => {
                  const index = days.length - 1 - back;
                  return (
                    <span
                      key={back}
                      className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
                      style={{ left: `${((index + 0.5) / days.length) * 100}%` }}
                    >
                      {dayLabels[index]}
                    </span>
                  );
                })}
                <span className="absolute top-0 right-0 whitespace-nowrap">{t("overview.fleetBoard.today")}</span>
              </div>
            </div>
          </div>
          <p data-slot="fleet-board-pointed" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
            {pointed ?? t("overview.fleetBoard.hint")}
          </p>
        </>
      )}
      <ChartViewToggle view={view} onChange={setView} />
    </div>
  );
}

/** The phone's board: one row per vehicle, today's status, and its days on a trip. */
function TodayList({ rows, days }: { rows: readonly FleetBoardRow[]; days: number }) {
  const { t } = useTranslation();
  return (
    <div data-slot="fleet-board-today" className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">{t("overview.fleetBoard.todayTitle")}</p>
      <ul className="flex flex-col">
        {rows.map((row) => {
          const today = row.days[row.days.length - 1] ?? "NOT_RECORDED";
          const { counts } = tally(row);
          return (
            <li key={row.key} data-slot="fleet-board-today-row" className="flex min-h-11 items-center justify-between gap-3 border-b py-2 text-sm last:border-b-0">
              <span className="flex min-w-0 flex-col">
                {row.to === undefined ? (
                  <span className="font-medium tabular-nums">{row.label}</span>
                ) : (
                  <Link to={row.to} className="font-medium tabular-nums underline-offset-4 hover:underline">
                    {row.label}
                  </Link>
                )}
                <span className="text-xs text-muted-foreground">
                  {t("overview.fleetBoard.tripDays", { count: counts.ON_TRIP, days })}
                </span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1.5">
                <i aria-hidden className={cn("inline-block size-3 rounded-[3px]", CELL[today])} />
                {statusWord(today, t)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The board's table view: each status counted per vehicle, and its share of recorded days on a trip. */
function BoardTable({ rows }: { rows: readonly FleetBoardRow[] }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage;
  const count = (status: DailyStatus, label: string): DataTableColumn<Tally> => ({
    id: status,
    header: label,
    meta: { phone: "meta", label, phoneText: (row) => String(row.counts[status]) },
    cell: ({ row }) => <span className="tabular-nums">{row.original.counts[status]}</span>,
  });
  const onTheRoad = (row: Tally) => (row.onTheRoad === null ? notRecorded(language) : formatPercent(row.onTheRoad, language));
  const columns: DataTableColumn<Tally>[] = [
    {
      id: "vehicle",
      header: t("overview.fleetBoard.columns.vehicle"),
      meta: { phone: "title", label: t("overview.fleetBoard.columns.vehicle") },
      cell: ({ row }) =>
        row.original.row.to === undefined ? (
          <span className="font-medium tabular-nums">{row.original.row.label}</span>
        ) : (
          <Link to={row.original.row.to} className="font-medium tabular-nums underline-offset-4 hover:underline">
            {row.original.row.label}
          </Link>
        ),
    },
    count("ON_TRIP", t("overview.fleetBoard.status.ON_TRIP")),
    count("AVAILABLE", t("overview.fleetBoard.status.AVAILABLE")),
    count("WORKSHOP", t("overview.fleetBoard.status.WORKSHOP")),
    count("GROUNDED", t("overview.fleetBoard.status.GROUNDED")),
    count("NOT_RECORDED", t("common.notRecorded")),
    {
      id: "onTheRoad",
      header: t("overview.fleetBoard.columns.onTheRoad"),
      meta: { phone: "value", label: t("overview.fleetBoard.columns.onTheRoad"), phoneText: onTheRoad },
      cell: ({ row }) =>
        row.original.onTheRoad === null ? <NotRecorded /> : <span className="tabular-nums">{onTheRoad(row.original)}</span>,
    },
  ];
  return <DataTable columns={columns} data={rows.map(tally)} getRowId={(row) => row.row.key} showRowCount={false} />;
}
