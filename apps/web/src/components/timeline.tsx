import type { HistoryActor, HistoryItem } from "@routiq/contracts";
import type { TFunction } from "i18next";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { formatDateTime, formatDayLong, localDayKey } from "@/lib/format.js";
import { cn } from "@/lib/utils.js";

/** i18next reads "." as a key separator, hence the dashes. */
export function historyEventLabelKey(eventType: string): string {
  return `history.event.${eventType.split(".").join("-")}`;
}

/**
 * The act in words. The event vocabulary is open (a command added later writes
 * a code no locale file knows yet), so an unknown kind reads "Other change"
 * rather than showing its raw code.
 */
export function timelineAct(eventType: string, t: TFunction): string {
  return t(historyEventLabelKey(eventType), { defaultValue: t("history.event.other") });
}

/**
 * The motif a line carries: a listed reason in words (#426), else the free
 * text. An unknown code shows raw rather than being guessed at.
 */
export function historyNote(
  item: Pick<HistoryItem, "note" | "noteCode">,
  t: TFunction,
): string | null {
  if (item.noteCode !== null && item.noteCode !== "OTHER") {
    return t(`reasonCodes.${item.noteCode}`, { defaultValue: item.note ?? item.noteCode });
  }
  return item.note !== null && item.note !== "" ? item.note : null;
}

export function timelineActor(actor: HistoryActor, t: TFunction): string {
  return actor.scope === "PLATFORM"
    ? t("history.actor.platform")
    : (actor.displayName ?? t("history.actor.unknown"));
}

export interface TimelineEvent {
  id: string;
  occurredAt: string;
  actor: HistoryActor;
  /** The translated act; a node so a record number inside it can stay unbroken. */
  act: ReactNode;
  /** The decision's reason or note, shown under the act. */
  note: string | null;
  /** Replaces the rail dot, e.g. a toned icon for the event's kind. */
  marker?: ReactNode;
  /** Right of the act: an amount, an origin badge. */
  aside?: ReactNode;
  /** Muted detail between the act and the note. */
  detail?: ReactNode;
  /** After actor and time on the meta line, e.g. an "Open" link. */
  meta?: ReactNode;
  /** Below everything: changed-field chips, a diff toggle. */
  children?: ReactNode;
}

export interface TimelineProps {
  events: readonly TimelineEvent[];
  /**
   * Day headings over the events. The order is the caller's: a day only ends
   * where the local calendar date changes, so an appended page continues the
   * run it belongs to.
   */
  groupByDay?: boolean;
  /** Words around the formatted time, e.g. "Recorded {date}" where a second date could be confused with it. */
  timeLabel?: (time: string) => string;
  className?: string;
}

/**
 * Every record's history, one way: actor, act, note under the act, time. The
 * history sheet, the vehicle's History tab and the work-order and problem
 * chronology all render through it, so a decision note shows wherever the
 * decision does.
 */
export function Timeline({ events, groupByDay = false, timeLabel, className }: TimelineProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  if (!groupByDay) {
    return (
      <ol className={cn("flex flex-col", className)}>
        {events.map((event) => (
          <TimelineRow key={event.id} event={event} locale={locale} withDate timeLabel={timeLabel} />
        ))}
      </ol>
    );
  }

  const days: Array<{ key: string; occurredAt: string; events: TimelineEvent[] }> = [];
  for (const event of events) {
    const key = localDayKey(event.occurredAt);
    const current = days.at(-1);
    if (current !== undefined && current.key === key) current.events.push(event);
    else days.push({ key, occurredAt: event.occurredAt, events: [event] });
  }
  const todayKey = localDayKey(new Date());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = localDayKey(yesterday);

  return (
    <ol className={cn("flex flex-col gap-4", className)}>
      {days.map((day) => (
        <li key={day.key}>
          <h3 className="pb-2 text-xs font-semibold text-muted-foreground">
            {day.key === todayKey
              ? t("history.today")
              : day.key === yesterdayKey
                ? t("history.yesterday")
                : formatDayLong(day.occurredAt, locale)}
          </h3>
          <ol className="flex flex-col">
            {day.events.map((event) => (
              <TimelineRow key={event.id} event={event} locale={locale} withDate={false} timeLabel={timeLabel} />
            ))}
          </ol>
        </li>
      ))}
    </ol>
  );
}

function TimelineRow({
  event,
  locale,
  withDate,
  timeLabel,
}: {
  event: TimelineEvent;
  locale: string;
  withDate: boolean;
  timeLabel: ((time: string) => string) | undefined;
}) {
  const { t } = useTranslation();
  const time = withDate
    ? formatDateTime(event.occurredAt, locale)
    : new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(
        new Date(event.occurredAt),
      );

  return (
    <li className="relative flex gap-3 pb-5 last:pb-0" data-testid="timeline-event">
      {/* The rail: a line from this marker down to the next one. */}
      <span
        className="absolute top-3 bottom-0 left-3.5 w-px -translate-x-1/2 bg-border [li:last-child>&]:hidden"
        aria-hidden
      />
      <span className="relative grid w-7 shrink-0 place-items-start justify-center pt-0.5" aria-hidden>
        {event.marker ?? <span className="mt-1.5 size-2 rounded-full bg-foreground/30" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm leading-snug font-medium">{event.act}</p>
          {event.aside}
        </div>
        {event.detail}
        {event.note !== null && (
          <p className="mt-1 border-l-2 border-border pl-2 text-sm whitespace-pre-line text-foreground/80">
            {event.note}
          </p>
        )}
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
          <span className={cn(event.actor.scope === "PLATFORM" && "font-medium text-primary")}>
            {timelineActor(event.actor, t)}
          </span>
          <span aria-hidden>·</span>
          <time dateTime={event.occurredAt} className="tabular-nums">
            {timeLabel === undefined ? time : timeLabel(time)}
          </time>
          {event.meta}
        </p>
        {event.children}
      </div>
    </li>
  );
}
