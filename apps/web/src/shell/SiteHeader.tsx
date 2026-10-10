import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
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
import { breadcrumbTrail, type Crumb } from "./breadcrumbs.js";
import { useRecordCrumbLabel } from "./record-crumb.js";
import { visibleSections } from "./sections.js";

export function SiteHeader() {
  const { t } = useTranslation();
  const me = useMeContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const recordLabel = useRecordCrumbLabel(pathname);
  const crumbs = breadcrumbTrail(
    visibleSections(me?.role, me?.enabledModules),
    pathname,
    recordLabel,
    me?.enabledModules,
  );
  const crumbText = (crumb: Crumb) => crumb.label ?? t(crumb.labelKey);
  const { scoped } = useBranchScope();
  // Beside the branch pill a phone has room for one crumb: the full trail
  // shrank to initials there. Below a section it is the way back up; at a
  // section's root, where you are (Home is in the sidebar).
  const current = crumbs[crumbs.length - 1];
  const parent = crumbs.length >= 3 ? crumbs[crumbs.length - 2] : undefined;
  const phoneBack = parent?.to === undefined ? undefined : { labelKey: parent.labelKey, to: parent.to };

  return (
    // One accent for "a branch is in force", the same whichever branch it is:
    // per-branch colours stop scaling past a handful and would be a colour-only
    // signal. The branch's name in the pill is what identifies it. The tint is
    // a layer under the controls over the opaque colour: a translucent
    // background colour would replace it and let scrolled content show
    // through (#57). The sticky z-10 header is the stacking context that keeps
    // the -z-10 layer above its own background.
    <header
      data-shift-region="header"
      data-branch-scoped={scoped ? "true" : undefined}
      className={cn(
        "sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-3 sm:px-4",
        scoped &&
          "border-b-2 border-b-primary before:pointer-events-none before:absolute before:inset-0 before:-z-10 before:bg-primary/5",
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
        className="mx-2 h-4 data-vertical:self-auto max-md:hidden"
      />
      {/* Screens own the page <h1>; this is wayfinding, not a heading. */}
      <Breadcrumb className="min-w-0">
        {phoneBack !== undefined ? (
          <Link
            to={phoneBack.to}
            data-slot="breadcrumb-back"
            className="-ms-1 flex min-h-11 min-w-0 items-center gap-0.5 pe-1 text-sm text-muted-foreground transition-colors hover:text-foreground md:hidden"
          >
            <ChevronLeft className="size-4 shrink-0" aria-hidden />
            <span className="truncate">{t(phoneBack.labelKey)}</span>
          </Link>
        ) : (
          current !== undefined && (
            <span
              data-slot="breadcrumb-phone-page"
              aria-current="page"
              className="block truncate text-sm text-foreground md:hidden"
            >
              {crumbText(current)}
            </span>
          )
        )}
        <BreadcrumbList className="flex-nowrap max-md:hidden">
          {crumbs.map((crumb, index) => (
            <Fragment key={crumb.labelKey}>
              {index > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem className="min-w-0">
                {crumb.to === undefined ? (
                  <BreadcrumbPage className="truncate">
                    {crumbText(crumb)}
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    className="truncate"
                    render={<Link to={crumb.to} />}
                  >
                    {crumbText(crumb)}
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
