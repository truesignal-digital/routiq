import { useId } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useMeContext } from "../auth/me.js";
import { bottomBarPlaces } from "./bottom-bar.js";
import { NavCountBadge } from "./NavCount.js";
import { usePanelOpen } from "./panel-open.js";
import { activeSection, visibleSections } from "./sections.js";
import { useNavCounts } from "./useNavCounts.js";

const TARGET =
  "flex h-16 min-w-0 flex-col items-center justify-center gap-1 px-1 text-xs font-medium transition-colors active:bg-muted";

/**
 * Below 768 px: the role's three places, then Menu, which opens the full
 * sidebar as a sheet. Steps aside while a panel or dialog is open. Its height
 * is `--bottom-bar` in `AppShell`, which pads the page and lifts the other
 * fixed bars above it. A place whose sidebar row has a count shows the same
 * red count on its icon (#322); the Menu sheet links the count into its view.
 */
export function BottomBar() {
  const { t } = useTranslation();
  const me = useMeContext();
  const { setOpenMobile } = useSidebar();
  const panelOpen = usePanelOpen();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const counts = useNavCounts();
  const countIds = useId();

  if (panelOpen) return null;

  const places = bottomBarPlaces(me?.role, me?.enabledModules);
  const active = activeSection(visibleSections(me?.role, me?.enabledModules), pathname);

  return (
    <nav
      aria-label={t("shell.bottomBar.label")}
      data-slot="bottom-bar"
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-backdrop-filter:bg-background/85 md:hidden"
    >
      <ul className="grid auto-cols-fr grid-flow-col">
        {places.map(({ key, to, labelKey, icon: Icon, count }) => {
          const current = active?.key === key;
          const waiting = count === undefined ? undefined : counts[count.key];
          const countId = waiting === undefined ? undefined : `${countIds}-${key}`;
          return (
            <li key={key} className="relative min-w-0">
              <Link
                to={to}
                aria-current={current ? "page" : undefined}
                aria-describedby={countId}
                className={cn(TARGET, current ? "text-foreground" : "text-muted-foreground")}
              >
                <Icon className="size-5" aria-hidden />
                <span className="max-w-full truncate">{t(labelKey)}</span>
              </Link>
              {count !== undefined && waiting !== undefined && (
                <>
                  {/* Beside the link, not in it, so the place keeps its name; the description says the count. */}
                  <NavCountBadge
                    value={waiting}
                    aria-hidden
                    data-bar-count={count.key}
                    className="pointer-events-none absolute top-1.5 left-1/2 ml-1"
                  />
                  <span id={countId} hidden>
                    {t(count.labelKey, { count: waiting })}
                  </span>
                </>
              )}
            </li>
          );
        })}
        <li className="min-w-0">
          <button
            type="button"
            onClick={() => setOpenMobile(true)}
            className={cn(TARGET, "w-full text-muted-foreground")}
          >
            <Menu className="size-5" aria-hidden />
            <span>{t("shell.bottomBar.menu")}</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}
