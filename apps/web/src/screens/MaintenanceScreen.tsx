import { useState } from "react";
import { useNavigate, useRouterState, useSearch } from "@tanstack/react-router";
import {
  CircleCheck,
  CircleSlash,
  ClipboardList,
  FileWarning,
  ShieldAlert,
  ShieldOff,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { IssueListItem, IssueStatus, WorkOrderListItem, WorkOrderStatus } from "@routiq/contracts";
import { issueStatuses, workOrderStatuses } from "@routiq/contracts";
import { DataTable, type DataTableRowAction } from "@/components/data-table";
import { FilterChips } from "@/components/filter-chips";
import { ModulePage, type ModulePageTab } from "@/components/module-page.js";
import { EmptyState, ErrorState, LoadingState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { useMeContext } from "@/auth/me.js";
import { useCommandLabel } from "@/commands/labels.js";
import { useIssueColumns, useWorkOrderColumns } from "@/maintenance/columns.js";
import { recordNumberText } from "@/lib/record-number.js";
import {
  CancelWorkOrderDialog,
  CompleteWorkOrderDialog,
  CreateWorkOrderDialog,
  IssueDecisionDialog,
  IssueSeverityDialog,
  ReleaseAssetDialog,
  ReportIssueDialog,
  WorkOrderDecisionDialog,
  type MaintenanceDialog,
} from "@/maintenance/MaintenanceDialogs.js";
import {
  canApproveWorkOrders,
  canDismissIssues,
  canLowerIssueSeverity,
  canManageWorkOrders,
  canRaiseIssueSeverity,
  canReleaseAssets,
  canReportIssues,
  canResolveIssues,
  workOrderMoneyShown,
  type WorkOrderMoneyShown,
} from "@/maintenance/permissions.js";
import {
  useIssues,
  useMaintenanceSummary,
  useWorkOrders,
} from "@/maintenance/useMaintenance.js";
import { MaintenanceOverview } from "@/maintenance/MaintenanceOverview.js";
import { WorkOrderSheet } from "@/maintenance/WorkOrderSheet.js";
import { BranchScopedEmptyState, BranchScopeLine } from "@/shell/BranchScopeNotices.js";

type WorkOrderFilter = WorkOrderStatus | "ALL";
type IssueFilter = IssueStatus | "ALL";

const WORK_ORDER_FILTERS: readonly WorkOrderFilter[] = ["ALL", ...workOrderStatuses];
const ISSUE_FILTERS: readonly IssueFilter[] = ["ALL", ...issueStatuses];

/**
 * A list's own status filter, as chips rather than a select: a handful of
 * statuses that an operator switches between constantly, and the chip row says
 * which one is in force without being opened. No counts — a keyset read never
 * learns how many rows sit behind the cursor (ADR-0003), so a number here could
 * only be a count of the loaded page pretending to be a total.
 */
function StatusChips<S extends string>({
  filters,
  value,
  label,
  labelFor,
  onChange,
}: {
  filters: readonly (S | "ALL")[];
  value: S | "ALL";
  label: string;
  labelFor: (status: S) => string;
  onChange: (status: S | "ALL") => void;
}) {
  const { t } = useTranslation();

  return (
    <FilterChips
      layout="wrap"
      label={label}
      value={value}
      onChange={onChange}
      options={filters.map((status) => ({
        key: status,
        label: status === "ALL" ? t("maintenance.filters.all") : labelFor(status),
      }))}
    />
  );
}

type MaintenanceTab = "overview" | "problems" | "work-orders";

const MAINTENANCE_TAB_PATH = {
  overview: "/maintenance",
  problems: "/maintenance/problems",
  "work-orders": "/maintenance/work-orders",
} as const satisfies Record<MaintenanceTab, string>;

export function activeMaintenanceTab(pathname: string): MaintenanceTab {
  const segment = pathname.split("/").filter(Boolean)[1];
  if (segment === "problems") return "problems";
  if (segment === "work-orders") return "work-orders";
  return "overview";
}

/**
 * The Maintenance page (#665, dashboards.html#maintenance): one header over
 * Overview, Problems and Work orders, each tab with its own address. The
 * header's buttons and the rows' actions open the same dialogs, so one screen
 * holds them and draws the tab the address names. The shell opens it only
 * while Maintenance is on (`ModulePageGate`).
 */
export function MaintenanceScreen() {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const me = useMeContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const tab = activeMaintenanceTab(pathname);

  const permissions = {
    manage: canManageWorkOrders(me?.role, me?.enabledModules),
    approve: canApproveWorkOrders(me?.role, me?.enabledModules),
    release: canReleaseAssets(me?.role, me?.enabledModules),
  };
  const canReport = canReportIssues(me?.role, me?.enabledModules);
  const canResolve = canResolveIssues(me?.role, me?.enabledModules);
  const canDismiss = canDismissIssues(me?.role, me?.enabledModules);
  const canRaise = canRaiseIssueSeverity(me?.role, me?.enabledModules);
  const canLower = canLowerIssueSeverity(me?.role, me?.enabledModules);

  // The Problems tab's count: the problems waiting for someone (dashboards.html#rule).
  const summaryQuery = useMaintenanceSummary();
  const [dialog, setDialog] = useState<MaintenanceDialog>({ kind: "none" });
  // The sheet and the work-order form look signalements up whatever the tab's
  // filter says: a closed one still names the grounding and the linked fault.
  const allIssuesQuery = useIssues();
  const issues = allIssuesQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const money = workOrderMoneyShown(me?.role, me?.enabledModules);
  const waiting = summaryQuery.data?.openIssues;

  const tabs: ModulePageTab<MaintenanceTab>[] = (["overview", "problems", "work-orders"] as const).map((key) => ({
    key,
    label: t(`maintenance.page.tabs.${key}`),
    to: MAINTENANCE_TAB_PATH[key],
    ...(key === "problems" && waiting !== undefined
      ? { count: waiting, countLabel: t("maintenance.page.tabs.waitingCount", { count: waiting }) }
      : {}),
  }));

  const dismiss = () => setDialog({ kind: "none" });

  function issueActions(issue: IssueListItem): DataTableRowAction<IssueListItem>[] {
    if (issue.status !== "OPEN") return [];
    const actions: DataTableRowAction<IssueListItem>[] = [];
    if (permissions.manage) {
      actions.push({
        key: "create-work-order",
        label: label("create-work-order"),
        icon: ClipboardList,
        onSelect: () => setDialog({ kind: "create-work-order", issue }),
      });
    }
    if (canResolve) {
      actions.push({
        key: "resolve",
        label: label("resolve-issue"),
        icon: CircleCheck,
        onSelect: () => setDialog({ kind: "decide-issue", decision: "resolve", issue }),
      });
    }
    if (canDismiss) {
      actions.push({
        key: "dismiss",
        label: label("dismiss-issue"),
        icon: CircleSlash,
        destructive: true,
        onSelect: () => setDialog({ kind: "decide-issue", decision: "dismiss", issue }),
      });
    }
    if (!issue.safetyCritical && canRaise) {
      actions.push({
        key: "raise-severity",
        label: label("change-issue-severity"),
        icon: ShieldAlert,
        onSelect: () => setDialog({ kind: "issue-severity", raise: true, issue }),
      });
    }
    if (issue.safetyCritical && canLower) {
      actions.push({
        key: "lower-severity",
        label: label({ command: "change-issue-severity", intent: "lower" }),
        icon: ShieldOff,
        destructive: true,
        onSelect: () => setDialog({ kind: "issue-severity", raise: false, issue }),
      });
    }
    return actions;
  }

  return (
    <ModulePage
      title={t("maintenance.title")}
      description={t("maintenance.subtitle")}
      tabsLabel={t("maintenance.page.tabs.label")}
      tabs={tabs}
      active={tab}
      action={
        <div className="flex flex-wrap gap-2">
          {canReport && (
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialog({ kind: "report-issue" })}
            >
              <FileWarning className="size-4" aria-hidden />
              {label("report-issue")}
            </Button>
          )}
          {permissions.manage && (
            <Button
              type="button"
              onClick={() => setDialog({ kind: "create-work-order" })}
            >
              <ClipboardList className="size-4" aria-hidden />
              {label("create-work-order")}
            </Button>
          )}
        </div>
      }
    >
      {tab === "overview" && <MaintenanceOverview />}
      {tab === "problems" && <ProblemsTab issueActions={issueActions} />}
      {tab === "work-orders" && (
        <WorkOrdersTab issues={issues} permissions={permissions} money={money} onAction={setDialog} />
      )}

      {dialog.kind === "report-issue" && <ReportIssueDialog onDismiss={dismiss} />}
      {dialog.kind === "create-work-order" && (
        <CreateWorkOrderDialog
          issue={dialog.issue}
          issues={issues}
          onDismiss={dismiss}
        />
      )}
      {dialog.kind === "complete" && (
        <CompleteWorkOrderDialog workOrder={dialog.workOrder} onDismiss={dismiss} />
      )}
      {dialog.kind === "cancel" && (
        <CancelWorkOrderDialog workOrder={dialog.workOrder} onDismiss={dismiss} />
      )}
      {dialog.kind === "decide-work-order" && (
        <WorkOrderDecisionDialog
          workOrder={dialog.workOrder}
          decision={dialog.decision}
          onDismiss={dismiss}
        />
      )}
      {dialog.kind === "decide-issue" && (
        <IssueDecisionDialog
          issue={dialog.issue}
          decision={dialog.decision}
          onDismiss={dismiss}
        />
      )}
      {dialog.kind === "issue-severity" && (
        <IssueSeverityDialog issue={dialog.issue} raise={dialog.raise} onDismiss={dismiss} />
      )}
      {dialog.kind === "release" && (
        <ReleaseAssetDialog workOrder={dialog.workOrder} onDismiss={dismiss} />
      )}
    </ModulePage>
  );
}

/**
 * Maintenance › Problems: the signalements, filtered by status through the
 * URL, where the Overview's tiles put the filter.
 */
function ProblemsTab({ issueActions }: { issueActions: (issue: IssueListItem) => DataTableRowAction<IssueListItem>[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: "/app/maintenance/problems" });
  const issueStatus: IssueFilter = search.status ?? "ALL";
  const setIssueStatus = (next: IssueFilter) =>
    void navigate({
      to: "/maintenance/problems",
      replace: true,
      search: next === "ALL" ? {} : { status: next },
    });
  // `/v1/issues` does the filtering; narrowing the loaded page here would
  // describe the page instead of the workshop. Branch-scoped by the hook.
  const issuesQuery = useIssues(issueStatus === "ALL" ? {} : { status: issueStatus });
  const issueColumns = useIssueColumns();
  const issueRows = issuesQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusChips
          filters={ISSUE_FILTERS}
          value={issueStatus}
          label={t("maintenance.issues.filters.status")}
          labelFor={(filter) => t(`maintenance.issues.status.${filter}`)}
          onChange={setIssueStatus}
        />
        <BranchScopeLine
          className="ms-auto"
          count={issuesQuery.isPending ? undefined : issueRows.length}
          hasMore={issuesQuery.hasNextPage ?? false}
        />
      </div>

      {issuesQuery.isError ? (
        <ErrorState
          className="mt-6"
          message={t("maintenance.issues.loadFailed")}
          retryLabel={t("maintenance.retry")}
          onRetry={() => void issuesQuery.refetch()}
        />
      ) : (
        <div className="mt-4">
          <DataTable
            columns={issueColumns}
            data={issueRows}
            getRowId={(row) => row.id}
            primaryColumn={{ columnId: "asset" }}
            rowActions={issueActions}
            loadMore={{
              hasNextPage: issuesQuery.hasNextPage ?? false,
              isFetching: issuesQuery.isFetchingNextPage,
              onLoadMore: () => void issuesQuery.fetchNextPage(),
            }}
            emptyState={
              issuesQuery.isPending ? (
                <LoadingState label={t("maintenance.issues.loading")} />
              ) : issueStatus !== "ALL" ? (
                <EmptyState
                  icon={<FileWarning className="size-7" aria-hidden />}
                  message={t("maintenance.issues.filteredEmpty")}
                />
              ) : (
                <BranchScopedEmptyState
                  icon={<FileWarning className="size-7" aria-hidden />}
                  message={t("maintenance.issues.branchEmptyHint")}
                  firstRun={{ message: t("maintenance.issues.emptyHint") }}
                />
              )
            }
          />
        </div>
      )}
    </>
  );
}

/**
 * Maintenance › Work orders: the queue, filtered by status, or to the orders
 * still open, through the URL.
 */
function WorkOrdersTab({
  issues,
  permissions,
  money,
  onAction,
}: {
  issues: readonly IssueListItem[];
  permissions: { manage: boolean; approve: boolean; release: boolean };
  money: WorkOrderMoneyShown;
  onAction: (dialog: MaintenanceDialog) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: "/app/maintenance/work-orders" });
  const status: WorkOrderFilter = search.status ?? "ALL";
  const openOnly = search.only === "open";
  const setStatus = (next: WorkOrderFilter) =>
    void navigate({
      to: "/maintenance/work-orders",
      replace: true,
      search: next === "ALL" ? {} : { status: next },
    });
  const workOrdersQuery = useWorkOrders({
    ...(status === "ALL" ? {} : { status }),
    ...(openOnly ? { open: true } : {}),
  });
  const workOrderColumns = useWorkOrderColumns(money);
  const workOrders: WorkOrderListItem[] = workOrdersQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusChips
          filters={WORK_ORDER_FILTERS}
          value={status}
          label={t("maintenance.workOrders.filters.status")}
          labelFor={(filter) => t(`maintenance.workOrders.status.${filter}`)}
          onChange={setStatus}
        />
        <BranchScopeLine
          className="ms-auto"
          count={workOrdersQuery.isPending ? undefined : workOrders.length}
          hasMore={workOrdersQuery.hasNextPage ?? false}
        />
      </div>
      {openOnly && (
        <p data-slot="work-orders-open-only" className="mt-2 text-sm text-muted-foreground">
          {t("maintenance.workOrders.openOnly")}{" "}
          <button
            type="button"
            className="font-medium text-foreground underline-offset-4 hover:underline"
            onClick={() => setStatus(status)}
          >
            {t("maintenance.workOrders.showAll")}
          </button>
        </p>
      )}

      {workOrdersQuery.isError ? (
        <ErrorState
          className="mt-6"
          message={t("maintenance.workOrders.loadFailed")}
          retryLabel={t("maintenance.retry")}
          onRetry={() => void workOrdersQuery.refetch()}
        />
      ) : (
        <div className="mt-4">
          <DataTable
            columns={workOrderColumns}
            data={workOrders}
            getRowId={(row) => row.id}
            primaryColumn={{ columnId: "reference" }}
            // The row viewer is where the queue and the story meet: the
            // table stays the scannable list, the sheet tells one row's life.
            rowViewer={{
              title: (row) => recordNumberText(t, "work_order", row.number),
              description: (row) => row.description,
              render: (row) => (
                <WorkOrderSheet
                  row={row}
                  issues={[...issues]}
                  permissions={permissions}
                  money={money}
                  onAction={onAction}
                />
              ),
            }}
            // Keyset, never a page count (ADR-0003).
            loadMore={{
              hasNextPage: workOrdersQuery.hasNextPage ?? false,
              isFetching: workOrdersQuery.isFetchingNextPage,
              onLoadMore: () => void workOrdersQuery.fetchNextPage(),
            }}
            emptyState={
              workOrdersQuery.isPending ? (
                <LoadingState label={t("maintenance.workOrders.loading")} />
              ) : status !== "ALL" || openOnly ? (
                <EmptyState
                  icon={<ClipboardList className="size-7" aria-hidden />}
                  message={t("maintenance.workOrders.filteredEmpty")}
                />
              ) : (
                <BranchScopedEmptyState
                  icon={<ClipboardList className="size-7" aria-hidden />}
                  message={t("maintenance.workOrders.branchEmptyHint")}
                  firstRun={{ message: t("maintenance.workOrders.emptyHint") }}
                />
              )
            }
          />
        </div>
      )}
    </>
  );
}
