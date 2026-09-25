import { useState } from "react";
import { ClipboardList, FileWarning, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { IssueListItem, WorkOrderStatus } from "@routiq/contracts";
import { workOrderStatuses } from "@routiq/contracts";
import { DataTable } from "@/components/data-table";
import { ErrorState, LoadingState, PageHeader } from "@/components/page";
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
  ReleaseAssetDialog,
  ReportIssueDialog,
  WorkOrderDecisionDialog,
  type MaintenanceDialog,
} from "@/maintenance/MaintenanceDialogs.js";
import {
  canApproveWorkOrders,
  canManageWorkOrders,
  canReleaseAssets,
  canReportIssues,
  canViewMaintenance,
} from "@/maintenance/permissions.js";
import { useIssues, useWorkOrders } from "@/maintenance/useMaintenance.js";
import { WorkOrderSheet } from "@/maintenance/WorkOrderSheet.js";
import { cn } from "@/lib/utils.js";
import { BranchScopedEmptyState, BranchScopeLine } from "@/shell/BranchScopeNotices.js";

type StatusFilter = WorkOrderStatus | "ALL";

const STATUS_FILTERS: readonly StatusFilter[] = ["ALL", ...workOrderStatuses];

/**
 * The queue's own status filter, as chips rather than a select: five statuses
 * that an operator switches between constantly, and the chip row says which one
 * is in force without being opened. No counts — a keyset read never learns how
 * many rows sit behind the cursor (ADR-0003), so a number here could only be a
 * count of the loaded page pretending to be a total.
 */
function StatusChips({
  value,
  onChange,
}: {
  value: StatusFilter;
  onChange: (status: StatusFilter) => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      role="group"
      aria-label={t("maintenance.workOrders.filters.status")}
      className="flex flex-wrap gap-2"
    >
      {STATUS_FILTERS.map((status) => (
        <button
          key={status}
          type="button"
          aria-pressed={value === status}
          onClick={() => onChange(status)}
          className={cn(
            "min-h-9 rounded-full border px-3 py-1.5 text-sm transition-colors",
            value === status
              ? "border-foreground bg-foreground text-background"
              : "border-border text-muted-foreground hover:bg-muted",
          )}
        >
          {status === "ALL"
            ? t("maintenance.workOrders.filters.all")
            : t(`maintenance.workOrders.status.${status}`)}
        </button>
      ))}
    </div>
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

  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [dialog, setDialog] = useState<MaintenanceDialog>({ kind: "none" });

  // `/v1/work-orders` does the filtering; narrowing the loaded page here would
  // describe the page instead of the workshop. Branch is absent on purpose —
  // both reads are branch-scoped, so the shell's agency reaches them without
  // this screen passing anything.
  const workOrdersQuery = useWorkOrders(status === "ALL" ? {} : { status });
  const issuesQuery = useIssues();

  const workOrderColumns = useWorkOrderColumns();
  const issueColumns = useIssueColumns();

  const workOrders = workOrdersQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const issues = issuesQuery.data?.pages.flatMap((page) => page.items) ?? [];

  const dismiss = () => setDialog({ kind: "none" });

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
                className="min-h-11"
                onClick={() => setDialog({ kind: "report-issue" })}
              >
                <FileWarning className="size-4" aria-hidden />
                {t("maintenance.issues.new")}
              </Button>
            )}
            {permissions.manage && (
              <Button
                type="button"
                className="min-h-11"
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
            <StatusChips value={status} onChange={setStatus} />
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
          <BranchScopeLine
            count={issuesQuery.isPending ? undefined : issues.length}
            hasMore={issuesQuery.hasNextPage ?? false}
          />

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
                data={issues}
                getRowId={(row) => row.id}
                primaryColumn={{ columnId: "asset" }}
                rowActions={(issue: IssueListItem) =>
                  permissions.manage
                    ? [
                        {
                          key: "create-work-order",
                          label: t("maintenance.issues.createWorkOrder"),
                          icon: ClipboardList,
                          onSelect: () =>
                            setDialog({ kind: "create-work-order", issue }),
                        },
                      ]
                    : []
                }
                loadMore={{
                  hasNextPage: issuesQuery.hasNextPage ?? false,
                  isFetching: issuesQuery.isFetchingNextPage,
                  onLoadMore: () => void issuesQuery.fetchNextPage(),
                }}
                emptyState={
                  issuesQuery.isPending ? (
                    <LoadingState label={t("maintenance.issues.loading")} />
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
      {dialog.kind === "approve" && (
        <WorkOrderDecisionDialog
          workOrder={dialog.workOrder}
          decision="approve"
          onDismiss={dismiss}
        />
      )}
      {dialog.kind === "approve-closure" && (
        <WorkOrderDecisionDialog
          workOrder={dialog.workOrder}
          decision="approve-closure"
          onDismiss={dismiss}
        />
      )}
      {dialog.kind === "release" && (
        <ReleaseAssetDialog workOrder={dialog.workOrder} onDismiss={dismiss} />
      )}
    </PageContainer>
  );
}
