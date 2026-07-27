import { Link, useRouterState } from "@tanstack/react-router";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
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
import { useMeContext } from "../auth/me.js";
import { breadcrumbTrail } from "./breadcrumbs.js";
import { visibleSections } from "./sections.js";

export function SiteHeader() {
  const { t } = useTranslation();
  const me = useMeContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const crumbs = breadcrumbTrail(visibleSections(me?.enabledModules), pathname);

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-3 sm:px-4">
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
      <div className="ms-auto flex items-center gap-2" />
    </header>
  );
}
