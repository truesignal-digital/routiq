import { useMemo, useState } from "react";
import type { SortingState, VisibilityState } from "@tanstack/react-table";
import { KeyRound, ShieldCheck, UserMinus, UserPlus, UserRoundCheck, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCommandLabel } from "@/commands/labels.js";
import type { MemberListItem } from "@routiq/contracts";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  DataTableViewOptions,
  type DataTableFilter,
  type DataTableFilterValues,
  type DataTableRowAction,
  type DataTableColumn,
} from "@/components/data-table";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { PermissionDenied } from "@/components/permission-denied.js";
import { MemberStatusBadge } from "@/members/MemberStatusBadge.js";
import { useMeContext } from "@/auth/me.js";
import { useAssetRegistrationReference } from "@/assets/reference.js";
import { toSortParam } from "@/lib/sort-param.js";
import { AddMemberDialog } from "@/members/AddMemberDialog.js";
import { branchScopeLabel } from "@/members/BranchScopeField.js";
import {
  MEMBER_ACTION_COMMANDS,
  memberActions,
  MemberActionDialog,
  type MemberActionKey,
} from "@/members/MemberActionDialog.js";
import { canAdministerMembers, type MemberActor } from "@/members/permissions.js";
import { useMembers } from "@/members/useMembers.js";

const PRIMARY_COLUMN = { columnId: "displayName" } as const;
const DEACTIVATED_FILTER_ID = "includeDeactivated";

const ACTION_ICONS: Record<MemberActionKey, typeof ShieldCheck> = {
  role: ShieldCheck,
  pin: KeyRound,
  deactivate: UserMinus,
  reactivate: UserRoundCheck,
};

/**
 * Who works here, and who may still log in. The workspace's member list is the
 * one place day-2 administration happens: before it existed a hire or a
 * departure meant hand-written SQL against `credentials`.
 *
 * Direction and Administrateur, matching `/v1/members`. The row menu offers
 * only the members this actor may manage (`memberActions`).
 */
export function UsersScreen() {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const me = useMeContext();
  const canAdminister = canAdministerMembers(me?.role);
  const actor: MemberActor | undefined =
    me === undefined
      ? undefined
      : { principalId: me.principalId, role: me.role, branchScope: me.branchScope };

  const [filterValues, setFilterValues] = useState<DataTableFilterValues>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [sorting, setSorting] = useState<SortingState>([
    { id: "displayName", desc: false },
  ]);
  const [adding, setAdding] = useState(false);
  const [acting, setActing] = useState<{
    member: MemberListItem;
    action: MemberActionKey;
  }>();

  const includeDeactivated = filterValues[DEACTIVATED_FILTER_ID] === "true";
  const sort = toSortParam(sorting);
  const membersQuery = useMembers({
    ...(includeDeactivated ? { includeDeactivated: true } : {}),
    ...(sort === undefined ? {} : { sort }),
  });
  const members = useMemo(
    () => membersQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [membersQuery.data],
  );

  // The branch list the workspace already publishes for pickers; a membership's
  // scope is stored as ids, so the column has nothing to print without it.
  const reference = useAssetRegistrationReference();
  const branches = useMemo(() => reference.data?.branches ?? [], [reference.data]);

  const filters = useMemo<DataTableFilter[]>(
    () => [
      {
        columnId: DEACTIVATED_FILTER_ID,
        type: "select",
        placeholder: t("users.filters.status"),
        options: [
          { value: "false", label: t("users.filters.activeOnly") },
          { value: "true", label: t("users.filters.includeDeactivated") },
        ],
      },
    ],
    [t],
  );

  const columns = useMemo<DataTableColumn<MemberListItem>[]>(
    () => [
      {
        accessorKey: "displayName",
        header: t("users.columns.displayName"),
        enableSorting: true,
        meta: { phone: "title", label: t("users.columns.displayName") },
        cell: ({ row }) => (
          <span
            className={row.original.status === "DEACTIVATED" ? "text-muted-foreground" : ""}
          >
            {row.original.displayName}
          </span>
        ),
      },
      {
        accessorKey: "username",
        header: t("users.columns.username"),
        meta: { phone: "meta", label: t("users.columns.username") },
        cell: ({ row }) => (
          <span className="tabular-nums whitespace-nowrap">
            {row.original.username ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "role",
        header: t("users.columns.role"),
        meta: { phone: "meta", label: t("users.columns.role") },
        cell: ({ row }) => t(`users.roles.${row.original.role}`),
      },
      {
        id: "branchScope",
        header: t("users.columns.branchScope"),
        meta: { phone: "hidden", label: t("users.columns.branchScope") },
        cell: ({ row }) =>
          branchScopeLabel(row.original.branchScope, branches, t("users.form.allBranches")),
      },
      {
        accessorKey: "status",
        header: t("users.columns.status"),
        meta: { phone: "status", label: t("users.columns.status") },
        cell: ({ row }) => (
          <MemberStatusBadge status={row.original.status} />
        ),
      },
    ],
    [t, branches],
  );

  // A non-admin is never routed here by the shell; reaching the URL directly
  // still gets the reason rather than an empty table or a raw 403.
  if (me !== undefined && !canAdminister) {
    return (
      <PermissionDenied
        width="wide"
        title={t("users.title")}
        icon={<Users className="size-7" aria-hidden />}
        code="ROLE_FORBIDDEN"
      />
    );
  }

  return (
    <PageContainer width="wide">
      <PageHeader
        title={t("users.title")}
        actions={
          <Button type="button" onClick={() => setAdding(true)}>
            <UserPlus className="size-4" aria-hidden />
            {label("add-member")}
          </Button>
        }
      />
      <p className="mt-2 max-w-lg text-sm text-muted-foreground">{t("users.lead")}</p>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <DataTableViewOptions
          columns={columns}
          value={columnVisibility}
          onChange={setColumnVisibility}
          primaryColumn={PRIMARY_COLUMN}
        />
      </div>

      {membersQuery.isError ? (
        <ErrorState
          className="mt-6"
          message={t("users.loadFailed")}
          retryLabel={t("users.retry")}
          onRetry={() => void membersQuery.refetch()}
        />
      ) : (
        <div className="mt-6">
          <DataTable
            columns={columns}
            data={members}
            getRowId={(member) => member.principalId}
            filters={filters}
            filterValues={filterValues}
            onFilterChange={setFilterValues}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            sorting={sorting}
            onSortingChange={setSorting}
            primaryColumn={PRIMARY_COLUMN}
            rowActions={(member) =>
              memberActions(member, actor).map(
                (action): DataTableRowAction<MemberListItem> => ({
                  key: action,
                  label: label(MEMBER_ACTION_COMMANDS[action]),
                  icon: ACTION_ICONS[action],
                  ...(action === "deactivate" ? { destructive: true } : {}),
                  onSelect: (row) => setActing({ member: row, action }),
                }),
              )
            }
            loadMore={{
              hasNextPage: membersQuery.hasNextPage,
              isFetching: membersQuery.isFetchingNextPage,
              onLoadMore: () => void membersQuery.fetchNextPage(),
            }}
            emptyState={
              membersQuery.isPending ? (
                <LoadingState label={t("users.loading")} />
              ) : (
                <EmptyState
                  icon={<Users className="size-7" aria-hidden />}
                  message={t("users.emptyHint")}
                />
              )
            }
          />
        </div>
      )}

      <AddMemberDialog
        open={adding}
        onOpenChange={setAdding}
        branches={branches}
        actor={actor}
        onAdded={() => void membersQuery.refetch()}
      />

      {acting !== undefined && (
        <MemberActionDialog
          member={acting.member}
          action={acting.action}
          branches={branches}
          actor={actor}
          onDismiss={() => setActing(undefined)}
        />
      )}
    </PageContainer>
  );
}
