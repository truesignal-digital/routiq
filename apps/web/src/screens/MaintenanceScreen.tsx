import { useState } from "react";
import { CircleCheck, CircleSlash, ClipboardList, FileWarning, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { IssueListItem, IssueStatus, WorkOrderStatus } from "@routiq/contracts";
import { issueStatuses, workOrderStatuses } from "@routiq/contracts";
import { DataTable, type DataTableRowAction } from "@/components/data-table";
import { FilterChips } from "@/components/filter-chips";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { deniedCode, PermissionDenied } from "@/components/permission-denied.js";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMeContext } from "@/auth/me.js";
import { useIssueColumns, useWorkOrderColumns, workOrderReference } from "@/maintenance/columns.js";
import {
  CancelWorkOrderDialog,
  CompleteWorkOrderDialog,
  CreateWorkOrderDialog,
  IssueDecisionDialog,
  ReleaseAssetDialog,
  ReportIssueDialog,
  WorkOrderDecisionDialog,
  type MaintenanceDialog,
} from "@/maintenance/MaintenanceDialogs.js";
import {
  canApproveWorkOrders,
  canDismissIssues,
  canManageWorkOrders,
  canReleaseAssets,
  canReportIssues,
  canResolveIssues,
  canViewMaintenance,
} from "@/maintenance/permissions.js";
import { useIssues, useWorkOrders } from "@/maintenance/useMaintenance.js";
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
  const me = useMeContext();

  const canView = canViewMaintenance(me?.enabledModules);
  const permissions = {
    manage: canManageWorkOrders(me?.role, me?.enabledModules),
    approve: canApproveWorkOrders(me?.role, me?.enabledModules),
    release: canReleaseAssets(me?.role, me?.enabledModules),
  };
  const canReport = canReportIssues(me?.role, me?.enabledModules);
  const canResolve = canResolveIssues(me?.role, me?.enabledModules);
  const canDismiss = canDismissIssues(me?.role, me?.enabledModules);

  const [status, setStatus] = useState<WorkOrderFilter>("ALL");
  const [issueStatus, setIssueStatus] = useState<IssueFilter>("ALL");
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

  const workOrderColumns = useWorkOrderColumns();
  const issueColumns = useIssueColumns();

  const workOrders = workOrdersQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const issueRows = issuesQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const issues = allIssuesQuery.data?.pages.flatMap((page) => page.items) ?? [];

  const dismiss = () => setDialog({ kind: "none" });

  function issueActions(issue: IssueListItem): DataTableRowAction<IssueListItem>[] {
    if (issue.status !== "OPEN") return [];
    const actions: DataTableRowAction<IssueListItem>[] = [];
    if (permissions.manage) {
      actions.push({
        key: "create-work-order",
        label: t("maintenance.issues.createWorkOrder"),
        icon: ClipboardList,
        onSelect: () => setDialog({ kind: "create-work-order", issue }),
      });
    }
    if (canResolve) {
      actions.push({
        key: "resolve",
        label: t("maintenance.actions.resolveIssue"),
        icon: CircleCheck,
        onSelect: () => setDialog({ kind: "decide-issue", decision: "resolve", issue }),
      });
    }
    if (canDismiss) {
      actions.push({
        key: "dismiss",
        label: t("maintenance.actions.dismissIssue"),
        icon: CircleSlash,
        onSelect: () => setDialog({ kind: "decide-issue", decision: "dismiss", issue }),
      });
    }
    return actions;
  }

  if (me !== undefined && !canView) {
    return (
      <PermissionDenied
        width="wide"
        title={t("maintenance.title")}
        icon={<Wrench className="size-7" aria-hidden />}
        code={deniedCode(me.enabledModules.includes("MAINTENANCE"))}
      />
    );
  }

  return (
    <PageContainer width="wide">
      <PageHeader
        title={t("maintenance.title")}
        actions={
          <div className="flex flex-wrap gap-2">
            {canReport && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialog({ kind: "report-issue" })}
              >
                <FileWarning className="size-4" aria-hidden />
                {t("maintenance.issues.new")}
              </Button>
            )}
            {permissions.manage && (
              <Button
                type="button"
                onClick={() => setDialog({ kind: "create-work-order" })}
              >
                <ClipboardList className="size-4" aria-hidden />
                {t("maintenance.workOrders.new")}
              </Button>
            )}
          </div>
        }
      />

      <Tabs defaultValue="work-orders" className="mt-6">
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
                  title: (row) => workOrderReference(row.id),
                  description: (row) => row.description,
                  render: (row) => (
                    <WorkOrderSheet
                      row={row}
                      issues={issues}
                      permissions={permissions}
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
      {dialog.kind === "release" && (
        <ReleaseAssetDialog workOrder={dialog.workOrder} onDismiss={dismiss} />
      )}
    </PageContainer>
  );
}
