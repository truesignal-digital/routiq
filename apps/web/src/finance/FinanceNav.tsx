import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMeContext } from "../auth/me.js";
import { Badge } from "../components/ui/badge.js";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs.js";
import { cn } from "../lib/utils.js";
import { approvalsTotal, useApprovals } from "./useApprovals.js";
import { activeFinanceSection, visibleFinanceSections } from "./navigation.js";
import { canManagePeriods } from "./permissions.js";

export function FinanceNav({ className }: { className?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const me = useMeContext();
  const canManage = canManagePeriods(me?.role, me?.enabledModules);
  const approvalsQuery = useApprovals(canManage);
  const sections = visibleFinanceSections(me?.role, me?.enabledModules);
  const pendingTotal = approvalsTotal(approvalsQuery.data);

  if (sections.length === 0) return null;

  // Derived from the URL rather than from Link's own active detection, which
  // lit the wrong tab on sibling routes.
  const active = activeFinanceSection(sections, pathname);

  return (
    <nav
      aria-label={t("finance.navigation.label")}
      className={cn("mt-4 overflow-x-auto", className)}
    >
      <Tabs
        value={active?.to ?? null}
        onValueChange={(value) => {
          // Keyboard activation goes through here; a click also fires it, and
          // routing to the location already shown is a no-op.
          const next = sections.find((section) => section.to === value);
          if (next) void navigate({ to: next.to });
        }}
      >
        {/* Height belongs on the strip, never on a trigger: the trigger is
            `h-[calc(100%-1px)]`, so sizing it instead pushes the active pill
            out past the muted background. */}
        <TabsList className="group-data-horizontal/tabs:h-11">
          {sections.map(({ key, to }) => (
            <TabsTrigger key={key} value={to} render={<Link to={to} />}>
              {t(`finance.navigation.${key}`)}
              {key === "approvals" && pendingTotal > 0 && (
                <Badge
                  variant="secondary"
                  aria-label={t("finance.navigation.approvalsBadge", {
                    count: pendingTotal,
                  })}
                  className="px-1.5"
                >
                  {pendingTotal}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </nav>
  );
}
