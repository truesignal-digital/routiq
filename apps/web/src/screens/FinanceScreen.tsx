import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { FileText, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeContext } from "@/auth/me.js";
import { useCommandLabel } from "@/commands/labels.js";
import { ModulePage, type ModulePageTab } from "@/components/module-page.js";
import { LoadingState } from "@/components/page";
import { PermissionDenied } from "@/components/permission-denied.js";
import { buttonVariants } from "@/components/ui/button";
import { activeMoneyTab, MONEY_TAB_PATH, visibleMoneyTabs, type MoneyTab } from "@/finance/moneyTabs.js";
import { canReadFinanceEntries, canRecordFinance, entriesScope } from "@/finance/permissions.js";
import { useFinanceSummary } from "@/finance/useFinanceSummary.js";

/**
 * The Money page (#664): one header and one tab bar over Overview, Entries and
 * To approve. The tabs are child routes, so the header stays put while only
 * the area under the tabs changes, and each tab has its own address.
 */
export function FinanceScreen() {
  const { t } = useTranslation();
  const me = useMeContext();
  if (me === undefined) return <LoadingState label={t("finance.entries.loading")} />;
  if (!canReadFinanceEntries(me.role, me.enabledModules)) {
    return (
      <PermissionDenied
        title={t("finance.entries.title")}
        icon={<FileText className="size-7" aria-hidden />}
        code="ROLE_FORBIDDEN"
      />
    );
  }
  return <MoneyPage />;
}

function MoneyPage() {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const me = useMeContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const tabs = visibleMoneyTabs(me?.role, me?.enabledModules);
  const canApprove = tabs.includes("approve");
  // The approver's queue count, from the read that also feeds the tiles: the
  // same entries the To approve tab lists for the shell's branch.
  const summary = useFinanceSummary(canApprove).data;
  const waiting = canApprove ? summary?.waiting?.count : undefined;
  // role-config: a driver's Money holds only what they recorded (#264, #619).
  const ownOnly = entriesScope(me?.role) === "OWN_ENTRIES";

  const tabList: ModulePageTab<MoneyTab>[] = tabs.map((tab) => ({
    key: tab,
    label: t(`finance.page.tabs.${tab}`),
    to: MONEY_TAB_PATH[tab],
    ...(tab === "approve" && waiting !== undefined
      ? { count: waiting, countLabel: t("finance.page.tabs.waitingCount", { count: waiting }) }
      : {}),
  }));

  return (
    <ModulePage
      title={t("finance.entries.title")}
      description={t(ownOnly ? "finance.page.descriptionOwn" : "finance.page.description")}
      tabsLabel={t("finance.page.tabs.label")}
      tabs={tabList}
      active={activeMoneyTab(pathname)}
      action={
        canRecordFinance(me?.role, me?.enabledModules) ? (
          // A link styled as a button: Base UI's Button would announce it as
          // a button (#136). The page's one primary action, on every tab.
          <Link to="/finance/record" className={buttonVariants()}>
            <Plus aria-hidden />
            {label("record-expense")}
          </Link>
        ) : undefined
      }
    >
      <Outlet />
    </ModulePage>
  );
}
