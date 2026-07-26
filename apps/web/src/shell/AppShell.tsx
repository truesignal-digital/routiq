import { Link, Outlet } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { MeCtx, useMe } from "../auth/me.js";
import { visibleSections } from "./sections.js";
import { Toaster } from "@/components/ui/sonner.js";

export function AppShell() {
  const { t } = useTranslation();
  const me = useMe();
  const shellSections = visibleSections(me.data?.enabledModules);

  return (
    <MeCtx.Provider value={me.data}>
    <div className="flex min-h-dvh bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border md:flex">
        <div className="px-5 py-5 text-base font-semibold">{t("app.name")}</div>
        <nav aria-label={t("app.name")} className="flex flex-col gap-1 px-3">
          {shellSections.map(({ key, to, icon: Icon }) => (
            <Link
              key={key}
              to={to}
              className="flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              activeProps={{ className: "bg-accent text-accent-foreground" }}
            >
              <Icon className="size-5" aria-hidden />
              {t(`nav.${key}`)}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex-1 pb-20 md:pb-0">
          <Outlet />
        </main>

        <nav
          aria-label={t("app.name")}
          className={cn(
            "fixed inset-x-0 bottom-0 grid border-t border-border bg-background md:hidden",
            "pb-[env(safe-area-inset-bottom)]",
          )}
          style={{ gridTemplateColumns: `repeat(${shellSections.length}, 1fr)` }}
        >
          {shellSections.map(({ key, to, icon: Icon }) => (
            <Link
              key={key}
              to={to}
              className="flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground"
              activeProps={{ className: "text-foreground" }}
            >
              <Icon className="size-6" aria-hidden />
              {t(`nav.${key}`)}
            </Link>
          ))}
        </nav>
      </div>
    </div>
    <Toaster richColors position="top-center" />
    </MeCtx.Provider>
  );
}
