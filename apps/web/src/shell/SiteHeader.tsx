import { Link, useRouterState } from "@tanstack/react-router";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { ThemeToggleMenu } from "@/components/theme-toggle";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useMeContext } from "../auth/me.js";
import { useBranchScope } from "./branch-scope.js";
import { BranchSwitcher } from "./BranchSwitcher.js";
import { breadcrumbTrail } from "./breadcrumbs.js";
import { visibleSections } from "./sections.js";

export function SiteHeader() {
  const { t } = useTranslation();
  const me = useMeContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const crumbs = breadcrumbTrail(visibleSections(me?.enabledModules), pathname);
  const { scoped } = useBranchScope();

  return (
    // One accent for "a branch is in force", the same whichever branch it is:
    // per-branch colours stop scaling past a handful and would be a colour-only
    // signal. The branch's name in the pill is what identifies it.
    <header
      data-branch-scoped={scoped ? "true" : undefined}
      className={cn(
        "sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-3 sm:px-4",
        scoped && "border-b-2 border-b-primary bg-primary/5",
      )}
    >
      <SidebarTrigger
        aria-label={t("shell.toggleSidebar")}
        className="-ms-1 size-11 md:size-7"
      />
      {/* `data-vertical:self-stretch` in the vendored separator would run this
          tick the full height of the header; dashboard-01 opts out and centers
          a 1rem rule instead. */}
      <Separator
        orientation="vertical"
        className="mx-2 h-4 data-vertical:self-auto"
      />
      {/* Screens own the page <h1>; this is wayfinding, not a heading. */}
      <Breadcrumb className="min-w-0">
        <BreadcrumbList className="flex-nowrap">
          {crumbs.map((crumb, index) => (
            <Fragment key={crumb.labelKey}>
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem className="min-w-0">
                {crumb.to === undefined ? (
                  <BreadcrumbPage className="truncate">
                    {t(crumb.labelKey)}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    className="truncate"
                    render={<Link to={crumb.to} />}
                  >
                    {t(crumb.labelKey)}
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ms-auto flex shrink-0 items-center gap-2">
        <BranchSwitcher />
        <ThemeToggleMenu className="-me-1" />
      </div>
    </header>
  );
}
