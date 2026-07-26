import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMeContext } from "../auth/me.js";
import { cn } from "../lib/utils.js";
import { useApprovals } from "./useApprovals.js";
import { visibleFinanceSections } from "./navigation.js";
import { canManagePeriods } from "./permissions.js";

export function FinanceNav() {
  const { t } = useTranslation();
  const me = useMeContext();
  const canManage = canManagePeriods(me?.role, me?.enabledModules);
  const approvalsQuery = useApprovals(canManage);
  const sections = visibleFinanceSections(me?.role, me?.enabledModules);
  const approvalsTotal = approvalsQuery.data?.total ?? 0;

  if (sections.length === 0) return null;

  return (
    <nav
      aria-label={t("finance.navigation.label")}
      className="mt-4 overflow-x-auto border-b border-border"
    >
      <div className="flex min-w-max gap-1">
        {sections.map(({ key, to }) => (
          <Link
            key={key}
            to={to}
            activeOptions={{ exact: true }}
            className="flex min-h-11 items-center gap-2 border-b-2 border-transparent px-3 text-sm font-medium text-muted-foreground hover:text-foreground"
            activeProps={{
              className: "border-primary text-foreground",
            }}
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
          </Link>
        ))}
      </div>
    </nav>
  );
}
