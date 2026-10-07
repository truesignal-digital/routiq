import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PageContainer, type PageContainerProps } from "@/components/page-container";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * One loading skeleton per page type (docs/design/consistency/pages.html),
 * shown by the router while a screen's loader is still running (#498). Each
 * keeps its page's width, title line, overview tiles and rows, so the screen
 * that replaces it lands where the skeleton was. Below 640 px rows are list
 * rows, as DataTable draws them on a phone.
 */

function Frame({ width = "wide", children }: { width?: PageContainerProps["width"]; children: ReactNode }) {
  return (
    <PageContainer width={width}>
      <Busy>{children}</Busy>
    </PageContainer>
  );
}

function Busy({ children, className }: { children: ReactNode; className?: string }) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-busy="true" className={className}>
      <span className="sr-only">{t("common.loading")}</span>
      {children}
    </div>
  );
}

/** PageHeader's h1: text-2xl, a 2rem line. */
function Title() {
  return <Skeleton className="h-8 w-48 max-w-full" />;
}

/** MetricStrip's three tiles: two columns on a phone, three beside each other above. */
function StripTiles() {
  return (
    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
      {Array.from({ length: 3 }, (_, index) => (
        <Skeleton key={index} className="h-20 rounded-xl" />
      ))}
    </div>
  );
}

function Rows({ count }: { count: number }) {
  return (
    <>
      <div className="mt-4 flex flex-col gap-3 sm:hidden">
        {Array.from({ length: count }, (_, index) => (
          <Skeleton key={index} className="h-16 rounded-xl" />
        ))}
      </div>
      <div className="mt-4 hidden overflow-hidden rounded-xl border border-border sm:block">
        <Skeleton className="h-10 rounded-none" />
        {Array.from({ length: count }, (_, index) => (
          <div key={index} className="flex h-12 items-center gap-4 border-t border-border px-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
    </>
  );
}

function Toolbar() {
  return <Skeleton className="mt-6 h-11 w-full rounded-lg sm:w-56" />;
}

/** Trips, Maintenance, Money, and the router's default: title, toolbar or tabs, rows. */
export function ModuleListSkeleton() {
  return (
    <Frame>
      <Title />
      <Toolbar />
      <Rows count={6} />
    </Frame>
  );
}

/** Trucks: the module list with its overview strip above the toolbar. */
export function FleetListSkeleton() {
  return (
    <Frame>
      <Title />
      <StripTiles />
      <Toolbar />
      <Rows count={6} />
    </Frame>
  );
}

/** A vehicle: its name and status line, the tab strip, then the tab. */
export function RecordWorkspaceSkeleton() {
  return (
    <Frame>
      <Title />
      <Skeleton className="mt-3 h-5 w-72 max-w-full" />
      <Skeleton className="mt-6 h-11 w-full rounded-lg" />
      <div className="mt-6">
        <TabBody />
      </div>
    </Frame>
  );
}

/** An entry or a trip on its own page: title, status line, then its fields. */
export function RecordSkeleton() {
  return (
    <Frame width="default">
      <Title />
      <Skeleton className="mt-3 h-5 w-72 max-w-full" />
      <Skeleton className="mt-6 h-64 rounded-xl" />
    </Frame>
  );
}

/** A tab inside a record, below the record's own header and tab strip. */
export function TabSkeleton() {
  return (
    <Busy>
      <TabBody />
    </Busy>
  );
}

function TabBody() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
      <Skeleton className="h-48 rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}

/** Approvals: title, the finance tabs, then the queue. */
export function DecisionQueueSkeleton() {
  return (
    <Frame>
      <Title />
      <Skeleton className="mt-6 h-11 w-full rounded-lg sm:w-80" />
      <Rows count={5} />
    </Frame>
  );
}

/** Home: title, the overview cards (one column on a phone, as SectionCards), then the chart or recent entries. */
export function HomeSkeleton() {
  return (
    <Frame>
      <Title />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="mt-6 h-64 rounded-xl" />
    </Frame>
  );
}

/** People, Users, Branches, accounting months: title and rows. */
export function SettingsListSkeleton() {
  return (
    <Frame>
      <Title />
      <Rows count={5} />
    </Frame>
  );
}

/** More: a short page of links at the default width. */
export function HubSkeleton() {
  return (
    <Frame width="default">
      <Title />
      <div className="mt-6 flex flex-col gap-3">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-14 rounded-xl" />
        ))}
      </div>
    </Frame>
  );
}
