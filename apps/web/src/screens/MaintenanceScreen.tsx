import { useMemo, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  CircleCheck,
  CircleSlash,
  ClipboardList,
  FileWarning,
  ShieldAlert,
  ShieldOff,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { IssueListItem, IssueStatus, WorkOrderStatus } from "@routiq/contracts";
import { issueStatuses, workOrderStatuses } from "@routiq/contracts";
import { DataTable, type DataTableRowAction } from "@/components/data-table";
import { FilterChips } from "@/components/filter-chips";
import { MetricStrip, type MetricTiles } from "@/components/metric-strip.js";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
} from "@/maintenance/permissions.js";
import {
  useIssues,
  useMaintenanceSummary,
  useWorkOrders,
} from "@/maintenance/useMaintenance.js";
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

export function MaintenanceScreen() {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const me = useMeContext();

  // The shell opens this page only while Maintenance is on (`ModulePageGate`).
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

  // Tab and status filters live in the URL, where the overview tiles put them
  // (#302), so a tile's view is a link that survives reload and back.
  const navigate = useNavigate();
  const urlSearch = useSearch({ from: "/app/maintenance" });
  const tab = urlSearch.tab ?? "work-orders";
  const status: WorkOrderFilter = urlSearch.status ?? "ALL";
  const issueStatus: IssueFilter = urlSearch.issueStatus ?? "ALL";
  const setView = (next: {
    tab?: "work-orders" | "issues";
    status?: WorkOrderFilter;
    issueStatus?: IssueFilter;
  }) => {
    const merged = { tab, status, issueStatus, ...next };
    void navigate({
      to: "/maintenance",
      replace: true,
      search: {
        tab: merged.tab === "work-orders" ? undefined : merged.tab,
        status: merged.status === "ALL" ? undefined : merged.status,
        issueStatus: merged.issueStatus === "ALL" ? undefined : merged.issueStatus,
      },
    });
  };
  const setStatus = (next: WorkOrderFilter) => setView({ status: next });
  const setIssueStatus = (next: IssueFilter) => setView({ issueStatus: next });
  const summaryQuery = useMaintenanceSummary();
  const [dialog, setDialog] = useState<MaintenanceDialog>({ kind: "none" });

  // `/v1/work-orders` and `/v1/issues` do the filtering; narrowing the loaded
  // page here would describe the page instead of the workshop. Branch is absent
  // on purpose — both reads are branch-scoped, so the shell's agency reaches
  // them without this screen passing anything.
  const workOrdersQuery = useWorkOrders(status === "ALL" ? {} : { status });
  const issuesQuery = useIssues(issueStatus === "ALL" ? {} : { status: issueStatus });
  // The sheet and the work-order form look signalements up whatever the tab's
  // filter says: a closed one still names the grounding and the linked fault.
  const allIssuesQuery = useIssues();

  const money = workOrderMoneyShown(me?.role, me?.enabledModules);
  const workOrderColumns = useWorkOrderColumns(money);
  const issueColumns = useIssueColumns();

  const workOrders = workOrdersQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const issueRows = issuesQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const issues = allIssuesQuery.data?.pages.flatMap((page) => page.items) ?? [];

  const tiles = useMemo<MetricTiles>(() => {
    const counts = summaryQuery.data;
    const onNewProblems = tab === "issues" && issueStatus === "OPEN";
    const onInProgress = tab === "work-orders" && status === "APPROVED";
    const days =
      counts?.averageRepairDays == null
        ? null
        : t("maintenance.metrics.repairDaysValue", {
            days: counts.averageRepairDays,
          });
    return [
      {
        label: t("maintenance.metrics.newProblems"),
        value: counts === undefined ? null : String(counts.openIssues),
        tone: (counts?.openSafetyCritical ?? 0) > 0 ? "warning" : "neutral",
        hint: t("maintenance.metrics.newProblemsHint", {
          count: counts?.openSafetyCritical ?? 0,
        }),
        selected: onNewProblems,
        onSelect: () =>
          setView(
            onNewProblems
              ? { issueStatus: "ALL" }
              : { tab: "issues", issueStatus: "OPEN" },
          ),
      },
      {
        label: t("maintenance.metrics.grounded"),
        value: counts === undefined ? null : String(counts.grounded),
        tone: (counts?.grounded ?? 0) > 0 ? "warning" : "neutral",
        hint: t("maintenance.metrics.groundedHint"),
      },
      {
        label: t("maintenance.metrics.inProgress"),
        value: counts === undefined ? null : String(counts.approvedWorkOrders),
        hint: t("maintenance.metrics.inProgressHint"),
        selected: onInProgress,
        onSelect: () =>
          setView(
            onInProgress
              ? { status: "ALL" }
              : { tab: "work-orders", status: "APPROVED" },
          ),
      },
      {
        label: t("maintenance.metrics.repairDays"),
        value: counts === undefined ? null : days,
        hint: t("maintenance.metrics.repairDaysHint", {
          count: counts?.repairsCounted ?? 0,
          window: counts?.repairWindowDays ?? 90,
        }),
      },
    ];
    // setView closes over navigate and the URL state listed here.
  }, [summaryQuery.data, t, tab, status, issueStatus]);

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
    <PageContainer>
      <PageHeader
        title={t("maintenance.title")}
        description={t("maintenance.subtitle")}
        actions={
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
      />

      <MetricStrip
        className="mt-6"
        tiles={tiles}
        isPending={summaryQuery.isPending}
        isError={summaryQuery.isError}
      />

      <Tabs
        value={tab}
        onValueChange={(value) =>
          setView({ tab: value === "issues" ? "issues" : "work-orders" })
        }
        className="mt-6"
      >
        <TabsList>
          <TabsTrigger value="work-orders">{t("maintenance.workOrders.tab")}</TabsTrigger>
          <TabsTrigger value="issues">{t("maintenance.issues.tab")}</TabsTrigger>
        </TabsList>

        <TabsContent value="work-orders" className="mt-4">
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
                      issues={issues}
                      permissions={permissions}
                      money={money}
                      onAction={setDialog}
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
                  ) : status !== "ALL" ? (
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
        </TabsContent>

        <TabsContent value="issues" className="mt-4">
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
        </TabsContent>
      </Tabs>

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
    </PageContainer>
  );
}
