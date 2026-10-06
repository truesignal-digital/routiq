import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ArrowRight, ChevronRight, CircleCheck, Megaphone, TriangleAlert } from "lucide-react";
import type { VehicleHistoryItem } from "@routiq/contracts";
import { RecordText } from "@/components/record-number";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatMoney } from "@/lib/format.js";
import { cn } from "@/lib/utils";
import { attentionText } from "../attentionText.js";
import { useVehicle } from "../context.js";
import { buildTodos, groundingStep, type Todo } from "../flow.js";
import { describeEvent } from "../historyEvents.js";
import { CardHead, Count, SeverityIcon, useStepLabel } from "../parts.js";
import { STEP_ICONS } from "../steps.js";
import { useAssetFinance, useAssetHistory } from "../useVehicle.js";
import { tabPath } from "../VehicleTabsNav.js";
import { EVENT_TONE_CLASS } from "./HistoryTab.js";

/** The Overview tab: what needs someone on this vehicle, this month's money, and the latest events. */
export function NowTab() {
  const { asset, viewer, attention, attentionStatus, gates } = useVehicle();
  const todos = buildTodos(attention, asset, viewer);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <TodoCard
        todos={todos}
        status={attentionStatus}
        besidesHeader={groundingStep(asset, viewer).step.kind === "go"}
      />
      <div className="space-y-6">
        {gates.money && <MonthCard />}
        <RecentCard />
      </div>
    </div>
  );
}

function TodoCard({
  todos,
  status,
  besidesHeader,
}: {
  todos: Todo[];
  status: "pending" | "error" | "success";
  besidesHeader: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(readTodoOpen);
  const mine = todos.filter((todo) => todo.step.kind === "go");
  const others = todos.filter((todo) => todo.step.kind !== "go");
  const toggle = () => {
    setOpen(!open);
    writeTodoOpen(!open);
  };
  return (
    <Card className="gap-0 py-0" aria-busy={status === "pending" ? true : undefined}>
      <CardHead
        className={open ? undefined : "border-transparent"}
        title={
          <>
            {t("vehicle.now.todo.title")}
            {(mine.length > 0 || (!open && status === "success")) && <Count>{mine.length}</Count>}
          </>
        }
        aside={
          <Button
            variant="ghost"
            size="desktop-icon-sm"
            className="-my-1"
            aria-label={t("vehicle.now.todo.title")}
            aria-expanded={open}
            onClick={toggle}
          >
            <ChevronRight className={cn("transition-transform", open && "rotate-90")} aria-hidden />
          </Button>
        }
        description={
          besidesHeader ? t("vehicle.now.todo.descriptionBesides") : t("vehicle.now.todo.description")
        }
      />
      {open && (
        <>
          {status === "pending" ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : status === "error" ? (
            <p className="px-4 py-5 text-sm text-muted-foreground">{t("vehicle.now.todo.loadFailed")}</p>
          ) : mine.length === 0 ? (
            <div className="flex items-start gap-3 px-4 py-5">
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-success-foreground" aria-hidden />
              <div>
                <p className="text-sm font-medium">
                  {besidesHeader ? t("vehicle.now.todo.emptyTitleBesides") : t("vehicle.now.todo.emptyTitle")}
                </p>
                <p className="text-sm text-muted-foreground">{t("vehicle.now.todo.emptyHint")}</p>
              </div>
            </div>
          ) : (
            <ul className="divide-y">
              {mine.map((todo) => (
                <TodoRow key={`${todo.item.code}:${todo.item.subject.id}`} todo={todo} />
              ))}
            </ul>
          )}
          {others.length > 0 && <WaitingOnOthers todos={others} />}
        </>
      )}
    </Card>
  );
}

/**
 * Direction's notes read as instructions, not faults (#98): a megaphone in
 * place of the severity icon and an info-tinted row, so they stand apart from
 * the workshop and money items around them.
 */
const isDirectionNote = (todo: Todo) => todo.item.code === "DIRECTION_NOTE";

function TodoIcon({ todo, className }: { todo: Todo; className: string }) {
  const { t } = useTranslation();
  return isDirectionNote(todo) ? (
    <Megaphone
      className={cn("size-4 shrink-0 text-info-foreground", className)}
      role="img"
      aria-label={t("vehicle.attention.DIRECTION_NOTE.badge")}
    />
  ) : (
    <SeverityIcon severity={todo.item.severity} className={className} />
  );
}

/** Whether To do is open is a device preference; storage throws in private-mode browsers. */
const TODO_STORAGE_KEY = "routiq-vehicle-todo";

function readTodoOpen(): boolean {
  try {
    return localStorage.getItem(TODO_STORAGE_KEY) !== "collapsed";
  } catch {
    return true;
  }
}

function writeTodoOpen(open: boolean): void {
  try {
    localStorage.setItem(TODO_STORAGE_KEY, open ? "expanded" : "collapsed");
  } catch {
    // The choice then lasts for this visit only.
  }
}

function useWhoLabel() {
  const { t } = useTranslation();
  return (todo: Todo) =>
    todo.who === "recorder"
      ? (todo.item.params.recordedBy?.displayName ?? t("vehicle.waiting.recorder"))
      : t(`vehicle.waiting.${todo.who}`);
}

function TodoRow({ todo }: { todo: Todo }) {
  const { t, i18n } = useTranslation();
  const { panel } = useVehicle();
  const stepLabel = useStepLabel();
  const { item, record, step } = todo;
  if (step.kind !== "go") return null;
  const text = attentionText(item, t, i18n.language);
  const Icon = STEP_ICONS[step.step.key];

  return (
    <li
      className={cn(
        "flex items-start gap-3 px-4 py-3.5",
        isDirectionNote(todo) && "border-l-2 border-info bg-info/10",
      )}
    >
      <TodoIcon todo={todo} className="mt-1" />
      <div className="flex min-w-0 flex-1 flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1">
          {record !== null ? (
            <button
              type="button"
              onClick={() => panel.openRecord(record)}
              className="rounded-sm text-left font-medium leading-snug hover:underline hover:decoration-foreground/30 hover:underline-offset-[3px] focus-visible:outline-2 focus-visible:outline-ring"
            >
              {text.title}
            </button>
          ) : (
            <p className="font-medium leading-snug">{text.title}</p>
          )}
          <p className="mt-0.5 text-sm text-muted-foreground">{text.detail}</p>
        </div>
        <Button
          variant="outline"
          className="self-start sm:self-center desktop:h-8"
          onClick={() => panel.openStep(step.step)}
        >
          <Icon aria-hidden />
          {stepLabel(step.step)}
        </Button>
      </div>
    </li>
  );
}

function WaitingOnOthers({ todos }: { todos: Todo[] }) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const who = useWhoLabel();
  const names = [...new Set(todos.map(who))];
  return (
    <div className="border-t">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm transition-colors hover:bg-muted/40"
      >
        <ChevronRight
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
          aria-hidden
        />
        <span className="font-medium">{t("vehicle.waiting.others")}</span>
        <Count>{todos.length}</Count>
        <span className="ml-auto truncate pl-3 text-xs text-muted-foreground">
          {new Intl.ListFormat(i18n.language, { style: "narrow", type: "conjunction" }).format(names)}
        </span>
      </button>
      {open && (
        <ul className="divide-y border-t bg-muted/20">
          {todos.map((todo) => (
            <WaitingRow key={`${todo.item.code}:${todo.item.subject.id}`} todo={todo} />
          ))}
        </ul>
      )}
    </div>
  );
}

function WaitingRow({ todo }: { todo: Todo }) {
  const { t, i18n } = useTranslation();
  const { panel } = useVehicle();
  const who = useWhoLabel();
  const text = attentionText(todo.item, t, i18n.language);
  const body = (
    <>
      <TodoIcon todo={todo} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-snug font-medium">{text.title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{text.detail}</span>
      </span>
      <span className="shrink-0 pl-2 text-right text-xs text-muted-foreground">
        {t("vehicle.waiting.label")}
        <span className="block font-medium text-foreground">{who(todo)}</span>
      </span>
    </>
  );
  const record = todo.record;
  return (
    <li>
      {record !== null ? (
        <button
          type="button"
          onClick={() => panel.openRecord(record)}
          className={cn(
            "flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50",
            isDirectionNote(todo) && "border-l-2 border-info bg-info/10",
          )}
        >
          {body}
        </button>
      ) : (
        <div className="flex items-start gap-3 px-4 py-2.5">{body}</div>
      )}
    </li>
  );
}

export function periodLabel(periodCode: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${periodCode}-15T00:00:00Z`),
  );
}

function MonthCard() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { asset } = useVehicle();
  const query = useAssetFinance(asset.id, undefined, true);
  const locale = i18n.language;
  const data = query.data;
  const missing = data === undefined ? 0 : data.evidenceMissing.postedCount + data.evidenceMissing.pendingCount;
  const money = (minor: number) => formatMoney(minor, { currency: data?.currency ?? "XAF", locale });
  const rows =
    data === undefined
      ? []
      : [
          {
            key: "posted",
            label: t("vehicle.now.month.posted"),
            value: money(data.posted.expenseMinor),
            hint: t("vehicle.now.month.postedHint"),
            warn: false,
          },
          {
            key: "review",
            label: t("vehicle.now.month.review"),
            value: money(data.pending.expenseMinor),
            hint: t("vehicle.now.month.reviewHint", { count: data.pending.entryCount }),
            warn: data.pending.entryCount > 0,
          },
          {
            key: "missing",
            label: t("vehicle.now.month.missing"),
            value: t("vehicle.money.entryCount", { count: missing }),
            hint: t("vehicle.now.month.missingHint"),
            warn: missing > 0,
          },
        ];

  return (
    <Card className="gap-0 py-0">
      <CardHead
        title={data === undefined ? t("vehicle.money.title") : periodLabel(data.periodCode, locale)}
        description={t("vehicle.now.month.description")}
        aside={
          <Button
            variant="ghost"
            size="desktop-sm"
            className="-my-1 -mr-1.5 text-muted-foreground"
            onClick={() => void navigate({ to: tabPath(asset.id, "money") })}
          >
            {t("vehicle.now.month.seeMoney")}
            <ArrowRight aria-hidden />
          </Button>
        }
      />
      {query.isPending ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : query.isError ? (
        <p className="px-4 py-5 text-sm text-muted-foreground">{t("vehicle.money.loadFailed")}</p>
      ) : (
        <dl className="divide-y">
          {rows.map((row) => (
            <div key={row.key} className="flex items-start justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <dt className="flex items-center gap-1.5 text-sm">
                  {row.warn && <TriangleAlert className="size-3.5 text-warning-foreground" aria-hidden />}
                  {row.label}
                </dt>
                <dd className="text-xs text-muted-foreground">{row.hint}</dd>
              </div>
              <dd className="shrink-0 text-sm font-semibold tabular-nums">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

function RecentCard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { asset } = useVehicle();
  const query = useAssetHistory(asset.id, undefined, 5);
  const items = query.data?.pages[0]?.items.slice(0, 5) ?? [];

  return (
    <Card className="gap-0 py-0">
      <CardHead
        title={t("vehicle.now.recent.title")}
        aside={
          <Button
            variant="ghost"
            size="desktop-sm"
            className="-my-1 -mr-1.5 text-muted-foreground"
            onClick={() => void navigate({ to: tabPath(asset.id, "history") })}
          >
            {t("vehicle.now.recent.seeAll")}
            <ArrowRight aria-hidden />
          </Button>
        }
      />
      {query.isPending ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : items.length === 0 ? (
        <p className="px-4 py-5 text-sm text-muted-foreground">{t("vehicle.history.empty")}</p>
      ) : (
        <ol className="divide-y">
          {items.map((item) => (
            <CompactEvent key={item.eventId} item={item} />
          ))}
        </ol>
      )}
    </Card>
  );
}

function CompactEvent({ item }: { item: VehicleHistoryItem }) {
  const { t, i18n } = useTranslation();
  const { gates, panel } = useVehicle();
  const view = describeEvent(item, t, i18n.language, gates);
  const Icon = view.icon;
  const actor =
    item.actor.scope === "PLATFORM"
      ? t("history.actor.platform")
      : (item.actor.displayName ?? t("history.actor.unknown"));
  const body = (
    <>
      <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-md", EVENT_TONE_CLASS[view.tone])}>
        <Icon className="size-3.5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-snug">
          <RecordText text={view.title} numbers={[view.titleNumber]} />
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {t("vehicle.now.recent.meta", { name: actor, date: formatDateTime(item.occurredAt, i18n.language) })}
        </span>
      </span>
    </>
  );
  const record = view.record;
  return (
    <li>
      {record !== null ? (
        <button
          type="button"
          onClick={() => panel.openRecord(record)}
          className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/40"
        >
          {body}
        </button>
      ) : (
        <div className="flex items-start gap-3 px-4 py-2.5">{body}</div>
      )}
    </li>
  );
}
