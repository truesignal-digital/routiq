import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMeContext } from "../auth/me.js";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs.js";
import { cn } from "../lib/utils.js";
import { useApprovals } from "./useApprovals.js";
import { activeFinanceSection, visibleFinanceSections } from "./navigation.js";
import { canManagePeriods } from "./permissions.js";

export function FinanceNav() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const me = useMeContext();
  const canManage = canManagePeriods(me?.role, me?.enabledModules);
  const approvalsQuery = useApprovals(canManage);
  const sections = visibleFinanceSections(me?.role, me?.enabledModules);
  const approvalsTotal = approvalsQuery.data?.total ?? 0;

  if (sections.length === 0) return null;

  // Derived from the URL rather than from Link's own active detection, which
  // lit the wrong tab on sibling routes.
  const active = activeFinanceSection(sections, pathname);

  return (
    <nav aria-label={t("finance.navigation.label")} className="mt-4 overflow-x-auto">
      <Tabs
        value={active?.to ?? null}
        onValueChange={(value) => {
          // Keyboard activation goes through here; a click also fires it, and
          // routing to the location already shown is a no-op.
          const next = sections.find((section) => section.to === value);
          if (next) void navigate({ to: next.to });
        }}
      >
        <TabsList>
          {sections.map(({ key, to }) => (
            <TabsTrigger
              key={key}
              value={to}
              className="min-h-11 px-3"
              render={<Link to={to} />}
            >
              {t(`finance.navigation.${key}`)}
              {key === "approvals" && approvalsTotal > 0 && (
                <span
                  aria-label={t("finance.navigation.approvalsBadge", {
                    count: approvalsTotal,
                  })}
                  className={cn(
                    "inline-flex min-w-5 items-center justify-center rounded-full",
                    "bg-primary px-1.5 py-0.5 text-xs font-semibold text-primary-foreground",
                  )}
                >
                  {approvalsTotal}
                </span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </nav>
  );
}
