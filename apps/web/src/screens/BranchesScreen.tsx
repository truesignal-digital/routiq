import { useMemo, useState } from "react";
import type { SortingState, VisibilityState } from "@tanstack/react-table";
import { Building2, Pencil, Plus, PowerOff, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCommandLabel } from "@/commands/labels.js";
import type { BranchListItem } from "@routiq/contracts";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  DataTableViewOptions,
  type DataTableRowAction,
  type DataTableColumn,
} from "@/components/data-table";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { PermissionDenied } from "@/components/permission-denied.js";
import { StatusBadge } from "@/components/status-badge.js";
import { useMeContext } from "@/auth/me.js";
import { toSortParam } from "@/lib/sort-param.js";
import {
  BRANCH_ACTION_COMMANDS,
  branchActions,
  BranchActionDialog,
  type BranchActionKey,
} from "@/branches/BranchActionDialog.js";
import { CreateBranchDialog } from "@/branches/CreateBranchDialog.js";
import { canAdministerBranches } from "@/branches/permissions.js";
import { useBranches } from "@/branches/useBranches.js";

const PRIMARY_COLUMN = { columnId: "code" } as const;
const DEFAULT_SORTING: SortingState = [{ id: "code", desc: false }];

const ACTION_ICONS: Record<BranchActionKey, typeof Pencil> = {
  rename: Pencil,
  deactivate: PowerOff,
  reactivate: RotateCcw,
};

/**
 * Where the workspace's branches are opened, renamed and retired. Until this
 * screen existed a second branch meant re-running provisioning by hand, and
 * `branches.active` was a column nothing ever wrote.
 *
 * ADMIN-only, matching `/v1/branches` and the three commands behind it.
 */
export function BranchesScreen() {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const me = useMeContext();
  const canAdminister = canAdministerBranches(me?.role);

  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [sorting, setSorting] = useState<SortingState>(DEFAULT_SORTING);
  const [adding, setAdding] = useState(false);
  const [acting, setActing] = useState<{
    branch: BranchListItem;
    action: BranchActionKey;
  }>();

  const sort = toSortParam(sorting);
  const branchesQuery = useBranches(sort === undefined ? {} : { sort });
  const branches = useMemo(
    () => branchesQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [branchesQuery.data],
  );

  const columns = useMemo<DataTableColumn<BranchListItem>[]>(
    () => [
      {
        accessorKey: "code",
        header: t("branches.columns.code"),
        enableSorting: true,
        meta: { phone: "title", label: t("branches.columns.code") },
        cell: ({ row }) => (
          <span className="tabular-nums whitespace-nowrap">{row.original.code}</span>
        ),
      },
      {
        accessorKey: "name",
        header: t("branches.columns.name"),
        meta: { phone: "meta", label: t("branches.columns.name") },
        cell: ({ row }) => (
          <span className={row.original.active ? "" : "text-muted-foreground"}>
            {row.original.name}
          </span>
        ),
      },
      {
        accessorKey: "timezone",
        header: t("branches.columns.timezone"),
        meta: { phone: "meta", label: t("branches.columns.timezone") },
        cell: ({ row }) => (
          <span className="whitespace-nowrap">{row.original.timezone}</span>
        ),
      },
      {
        accessorKey: "active",
        header: t("branches.columns.status"),
        meta: { phone: "status", label: t("branches.columns.status") },
        cell: ({ row }) => (
          <StatusBadge tone={row.original.active ? "success" : "neutral"}>
            {t(row.original.active ? "branches.status.active" : "branches.status.inactive")}
          </StatusBadge>
        ),
      },
    ],
    [t],
  );

  // A non-admin is never routed here by the shell; reaching the URL directly
  // still gets the reason rather than an empty table or a raw 403.
  if (me !== undefined && !canAdminister) {
    return (
      <PermissionDenied
        width="wide"
        title={t("branches.title")}
        icon={<Building2 className="size-7" aria-hidden />}
        code="ROLE_FORBIDDEN"
      />
    );
  }

  return (
    <PageContainer width="wide">
      <PageHeader
        title={t("branches.title")}
        actions={
          <Button type="button" onClick={() => setAdding(true)}>
            <Plus className="size-4" aria-hidden />
            {label("create-branch")}
          </Button>
        }
      />
      <p className="mt-2 max-w-lg text-sm text-muted-foreground">{t("branches.lead")}</p>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <DataTableViewOptions
          columns={columns}
          value={columnVisibility}
          onChange={setColumnVisibility}
          primaryColumn={PRIMARY_COLUMN}
        />
      </div>

      {branchesQuery.isError ? (
        <ErrorState
          className="mt-6"
          message={t("branches.loadFailed")}
          retryLabel={t("branches.retry")}
          onRetry={() => void branchesQuery.refetch()}
        />
      ) : (
        <div className="mt-6">
          <DataTable
            columns={columns}
            data={branches}
            getRowId={(branch) => branch.id}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            sorting={sorting}
            defaultSorting={DEFAULT_SORTING}
            onSortingChange={setSorting}
            primaryColumn={PRIMARY_COLUMN}
            rowActions={(branch) =>
              branchActions(branch).map(
                (action): DataTableRowAction<BranchListItem> => ({
                  key: action,
                  label: label(BRANCH_ACTION_COMMANDS[action]),
                  icon: ACTION_ICONS[action],
                  ...(action === "deactivate" ? { destructive: true } : {}),
                  onSelect: (row) => setActing({ branch: row, action }),
                }),
              )
            }
            loadMore={{
              hasNextPage: branchesQuery.hasNextPage,
              isFetching: branchesQuery.isFetchingNextPage,
              onLoadMore: () => void branchesQuery.fetchNextPage(),
            }}
            emptyState={
              branchesQuery.isPending ? (
                <LoadingState label={t("branches.loading")} />
              ) : (
                <EmptyState
                  icon={<Building2 className="size-7" aria-hidden />}
                  message={t("branches.emptyHint")}
                />
              )
            }
          />
        </div>
      )}

      <CreateBranchDialog
        open={adding}
        onOpenChange={setAdding}
        onCreated={() => void branchesQuery.refetch()}
      />

      {acting !== undefined && (
        <BranchActionDialog
          branch={acting.branch}
          action={acting.action}
          onDismiss={() => setActing(undefined)}
        />
      )}
    </PageContainer>
  );
}
