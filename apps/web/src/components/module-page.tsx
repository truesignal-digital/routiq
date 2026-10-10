import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** One tab of a module page: its own address, so a link or Back lands on it. */
export interface ModulePageTab<K extends string = string> {
  key: K;
  label: string;
  to: string;
  /**
   * Only where someone waits (To approve, Problems). Zero shows nothing: a
   * count on every tab would stop meaning "this needs you".
   */
  count?: number | undefined;
  /** The count in words for a screen reader ("6 waiting"). */
  countLabel?: string | undefined;
}

/**
 * The Module page archetype (docs/design/consistency/dashboards.html#rule):
 * the header (title, one sentence, the one main button) stays the same on
 * every tab; only the area under the tabs changes. Overview comes first. The
 * caller passes only the tabs this viewer may use: a tab a role can't use is
 * hidden, never greyed. With one tab left there is no bar at all.
 */
export function ModulePage<K extends string>({
  title,
  description,
  action,
  tabs,
  active,
  tabsLabel,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** The page's one primary action, the same on every tab. */
  action?: ReactNode;
  tabs: readonly ModulePageTab<K>[];
  active: K;
  /** Names the tab bar for a screen reader. */
  tabsLabel: string;
  children: ReactNode;
}) {
  return (
    <PageContainer>
      <PageHeader title={title} description={description} actions={action} />
      {tabs.length > 1 && (
        <nav
          aria-label={tabsLabel}
          data-slot="module-page-tabs"
          // Scrolls sideways on a phone rather than wrapping (dashboards.html, phone rules).
          className="-mx-4 mt-4 overflow-x-auto px-4 shadow-[inset_0_-1px_0_var(--color-border)] [scrollbar-width:none] sm:mx-0 sm:px-0"
        >
          <Tabs value={active}>
            <TabsList variant="line" className="w-max gap-6 p-0">
              {tabs.map((tab) => (
                <TabsTrigger
                  key={tab.key}
                  value={tab.key}
                  className="h-full flex-none gap-1.5 px-0.5 text-sm group-data-horizontal/tabs:after:bottom-0"
                  nativeButton={false}
                  render={<Link to={tab.to} />}
                >
                  {tab.label}
                  {tab.count !== undefined && tab.count > 0 && (
                    <span
                      data-slot="module-page-tab-count"
                      className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] bg-foreground px-1 text-[11px] font-semibold text-background tabular-nums"
                    >
                      {tab.count}
                      {tab.countLabel !== undefined && <span className="sr-only"> {tab.countLabel}</span>}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </nav>
      )}
      <div className="mt-5">{children}</div>
    </PageContainer>
  );
}
