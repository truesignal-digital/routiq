import { Children, Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NotRecorded } from "@/components/not-recorded.js";
import { RecordNumber } from "@/components/record-number.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { usePanelOpen } from "@/shell/panel-open.js";
import { useRecordCrumb } from "@/shell/record-crumb.js";

/**
 * The parts of a record page (#662, docs/design/consistency/fullpages.html):
 * one header, one status block (`status-block.tsx`), tabs with Overview first
 * and History last, titled fact sections, and a context column. The money
 * entry, the trip and the truck are built from these, so all three read alike.
 */

export interface RecordHeaderProps {
  /**
   * The record's own name: its number or code. It is the title and the
   * breadcrumb's last item, so the trail never ends on "Detail".
   */
  name: string;
  /** A longer title that starts with the name (a truck's code then its make and model). */
  title?: ReactNode;
  icon?: ReactNode;
  /** The status badge, beside the title. */
  status?: ReactNode;
  /** The facts line: each part is one fact; empty parts are skipped and the rest joined with a dot. */
  facts?: readonly ReactNode[];
  /** Top right. At most one filled button; the decision a status waits for sits in the status block. */
  actions?: ReactNode;
  /** Notices that belong to the record as a whole, under the title (another branch's record). */
  children?: ReactNode;
}

export function RecordHeader({ name, title, icon, status, facts = [], actions, children }: RecordHeaderProps) {
  useRecordCrumb(name);
  const shown = facts.filter((fact) => fact !== null && fact !== undefined && fact !== false && fact !== "");

  return (
    <header data-slot="record-header" className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 gap-3">
          {icon !== undefined && (
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground/80 [&_svg]:size-[18px]">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="min-w-0 text-xl font-semibold tracking-tight break-words tabular-nums md:text-2xl">
                {title ?? <RecordNumber>{name}</RecordNumber>}
              </h1>
              {status !== undefined && <div className="flex flex-wrap items-center gap-2">{status}</div>}
            </div>
            {shown.length > 0 && (
              <p data-slot="record-facts" className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted-foreground">
                {shown.map((fact, index) => (
                  <Fragment key={index}>
                    {index > 0 && (
                      <span aria-hidden className="text-muted-foreground/50">
                        ·
                      </span>
                    )}
                    <span className="min-w-0">{fact}</span>
                  </Fragment>
                ))}
              </p>
            )}
          </div>
        </div>
        {actions !== undefined && actions !== null && actions !== false && (
          <div data-slot="record-actions" className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
            {actions}
          </div>
        )}
      </div>
      {children}
    </header>
  );
}

export interface RecordTab<K extends string> {
  key: K;
  label: ReactNode;
  /** A small marker after the label: a count, a dot. */
  marker?: ReactNode;
}

export interface RecordTabsProps<K extends string> {
  /** The tab list's accessible name. */
  label: string;
  /** Always first. */
  overview: RecordTab<K>;
  /** The record's work tabs, in their order, between Overview and History. */
  work?: readonly RecordTab<K>[];
  /** Always last. */
  history?: RecordTab<K> | undefined;
  active: K;
  onSelect?: (key: K) => void;
  /** Renders each tab as this link, so the tab is an address the browser can open. */
  link?: (key: K) => ReactElement;
  className?: string;
}

/** Overview first, History last, the work tabs between them: the order is the props' shape, not a convention. */
export function recordTabOrder<K extends string>(
  overview: RecordTab<K>,
  work: readonly RecordTab<K>[],
  history: RecordTab<K> | undefined,
): RecordTab<K>[] {
  return [overview, ...work, ...(history === undefined ? [] : [history])];
}

/**
 * A record's tabs, under the header and sticky under the shell's bar; they
 * scroll sideways on a phone. The page keeps the active tab in its address.
 */
export function RecordTabs<K extends string>({
  label,
  overview,
  work = [],
  history,
  active,
  onSelect,
  link,
  className,
}: RecordTabsProps<K>) {
  const tabs = recordTabOrder(overview, work, history);
  return (
    <nav
      aria-label={label}
      data-slot="record-tabs"
      className={cn(
        "sticky top-14 z-[5] -mx-4 overflow-x-auto bg-background px-4 shadow-[inset_0_-1px_0_var(--color-border)] [scrollbar-width:none] sm:mx-0 sm:px-0",
        className,
      )}
    >
      <Tabs
        value={active}
        onValueChange={(value) => {
          const tab = tabs.find((candidate) => candidate.key === value);
          if (tab !== undefined) onSelect?.(tab.key);
        }}
      >
        <TabsList variant="line" className="w-max gap-6 p-0">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.key}
              value={tab.key}
              className="h-full flex-none gap-1.5 px-0.5 text-sm group-data-horizontal/tabs:after:bottom-0"
              {...(link === undefined ? {} : { nativeButton: false, render: link(tab.key) })}
            >
              {tab.label}
              {tab.marker}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </nav>
  );
}

/** A tab's count beside its label, quiet: "Receipt 0", "Legs 1". */
export function TabCount({ n }: { n: number }) {
  return <span className="text-xs text-muted-foreground tabular-nums">{n}</span>;
}

/**
 * A titled card of facts, labels above values, two columns from a tablet up.
 * Its groups follow the form that created the record.
 */
export function FactsSection({
  title,
  aside,
  children,
  className,
}: {
  title: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="flex flex-wrap items-baseline justify-between gap-2">
        <CardTitle>
          <h2 className="text-base font-semibold">{title}</h2>
        </CardTitle>
        {aside}
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">{children}</dl>
      </CardContent>
    </Card>
  );
}

/**
 * One fact. A value nobody recorded is `null` and reads "Not recorded", with
 * "Add" when `onAdd` is given (the viewer may fill it). A value the viewer may
 * not read is left out by the caller, never called unrecorded.
 */
export function Fact({
  label,
  value,
  onAdd,
  wide = false,
}: {
  label: ReactNode;
  value: ReactNode;
  onAdd?: (() => void) | undefined;
  /** Takes both columns: a description, a reason. */
  wide?: boolean;
}) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className={cn("min-w-0", wide && "sm:col-span-2")}>
      <dt className="text-xs font-semibold text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm break-words">{empty ? <NotRecorded onAdd={onAdd} /> : value}</dd>
    </div>
  );
}

/** One box of the context column: a title, an optional link beside it, the content. */
export function ContextBox({
  title,
  action,
  children,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section data-slot="context-box" className="rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A label and its value on one line inside a context box. */
export function ContextRow({ label, value, strong = false }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("text-right tabular-nums", strong && "text-base font-semibold")}>{value}</dd>
    </div>
  );
}

export interface RecordBodyProps {
  tabs: ReactNode;
  /** The active tab's content. */
  children: ReactNode;
  /** The context column's first box: the record's money. Right after the tabs on a phone. */
  lead?: ReactNode;
  /** The rest of the context column: linked records, the latest history. At the end of the Overview on a phone. */
  context?: ReactNode;
  /** On a phone the context belongs to the Overview only; the other tabs show their own content. */
  overview: boolean;
}

/**
 * The record's main column and its 300 px context column, sticky beside it
 * from 1 280 px. Below that the context moves under the main column; on a
 * phone its money box comes right after the tabs and the rest after the
 * Overview. The context never holds an action or a number found nowhere else.
 */
export function RecordBody({ tabs, children, lead, context, overview }: RecordBodyProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const hasContext = hasContent(lead) || hasContent(context);

  if (isMobile) {
    return (
      <div className="mt-5 flex flex-col gap-5">
        {tabs}
        {overview && lead}
        <div>{children}</div>
        {overview && context}
      </div>
    );
  }

  return (
    <div
      data-slot="record-body"
      className={cn("mt-5 grid gap-6", hasContext && "xl:grid-cols-[minmax(0,1fr)_300px] xl:items-start")}
    >
      <div className="min-w-0">
        {tabs}
        <div className="mt-5">{children}</div>
      </div>
      {hasContext && (
        <aside
          aria-label={t("record.context")}
          data-slot="context-column"
          className="grid gap-4 md:grid-cols-2 xl:sticky xl:top-20 xl:grid-cols-1"
        >
          {lead}
          {context}
        </aside>
      )}
    </div>
  );
}

function hasContent(node: ReactNode): boolean {
  return Children.toArray(node).some((child) => isValidElement(child) || (typeof child === "string" && child !== ""));
}

/**
 * The phone's bottom action bar on a record: the decision the status block
 * asks for, main button on the right. It sits above the shell's bottom bar and
 * steps aside while a panel or dialog is open.
 */
export function RecordActionBar({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const panelOpen = usePanelOpen();
  if (panelOpen) return null;
  return (
    <div
      role="toolbar"
      aria-label={t("record.actionBar")}
      data-slot="record-action-bar"
      className="fixed inset-x-3 bottom-[calc(var(--bottom-bar,0px)+0.5rem)] z-40 flex justify-end gap-2 rounded-xl border bg-background/95 p-2 shadow-lg backdrop-blur supports-backdrop-filter:bg-background/85 md:hidden [&>*]:flex-1"
    >
      {children}
    </div>
  );
}
