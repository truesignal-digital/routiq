import { useMemo, useState } from "react";
import type { VisibilityState } from "@tanstack/react-table";
import { UserPlus, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCommandLabel } from "@/commands/labels.js";
import type { PersonListItem } from "@routiq/contracts";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DataTable,
  DataTableViewOptions,
  type DataTableFilter,
  type DataTableFilterValues,
  type DataTableColumn,
} from "@/components/data-table";
import { ErrorState, LoadingState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { StatusBadge } from "@/components/status-badge.js";
import { useMeContext } from "@/auth/me.js";
import { useAssetRegistrationReference } from "@/assets/reference.js";
import { BranchScopedEmptyState, BranchScopeLine } from "@/shell/BranchScopeNotices.js";
import {
  useCreatedElsewhereNotice,
  useFollowShellBranch,
} from "@/shell/branch-scope.js";
import { notifyCommandSuccess } from "@/lib/notify.js";
import { RegisterPersonDialog } from "@/activities/RegisterPersonDialog.js";
import { canRegisterPersons } from "@/activities/permissions.js";
import { usePersons } from "@/activities/usePersons.js";
import { NotRecorded } from "@/components/not-recorded.js";

const PRIMARY_COLUMN = { columnId: "displayName" } as const;
const SEARCH_FILTER_ID = "search";

export function PersonsScreen() {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const me = useMeContext();
  const canRegister = canRegisterPersons(me?.role, me?.enabledModules);

  const [filterValues, setFilterValues] = useState<DataTableFilterValues>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [registering, setRegistering] = useState(false);

  const search = filterValues[SEARCH_FILTER_ID] ?? "";
  // `/v1/persons` does the matching; narrowing the loaded rows here would
  // describe the page instead of the payroll.
  const personsQuery = usePersons(search === "" ? {} : { search });
  const persons = personsQuery.data?.items ?? [];

  // A new person joins a branch, and the command names it by code — so the
  // screen has to know which one before it can offer to register anyone. The
  // dialog never asks, so this picker is the only place the branch is said.
  const reference = useAssetRegistrationReference();
  const branches = useMemo(() => reference.data?.branches ?? [], [reference.data]);
  const [branchCode, setBranchCode] = useState("");
  useFollowShellBranch(branches, branchCode, setBranchCode);
  // Registering into the agency on screen is confirmed by the new row itself;
  // registering into another one lands where this list cannot show it, so the
  // toast says which.
  const createdElsewhereNotice = useCreatedElsewhereNotice();

  const filters = useMemo<DataTableFilter[]>(
    () => [
      {
        columnId: SEARCH_FILTER_ID,
        type: "search",
        placeholder: t("persons.searchPlaceholder"),
      },
    ],
    [t],
  );

  const columns = useMemo<DataTableColumn<PersonListItem>[]>(
    () => [
      {
        accessorKey: "displayName",
        header: t("persons.columns.displayName"),
        enableSorting: true,
        meta: { phone: "title", label: t("persons.columns.displayName") },
        cell: ({ row }) => row.original.displayName,
      },
      {
        accessorKey: "personCode",
        header: t("persons.columns.personCode"),
        enableSorting: true,
        meta: { phone: "meta", label: t("persons.columns.personCode") },
        cell: ({ row }) => (
          <span className="tabular-nums whitespace-nowrap">
            {row.original.personCode ?? <NotRecorded />}
          </span>
        ),
      },
      {
        accessorKey: "defaultRole",
        header: t("persons.columns.defaultRole"),
        meta: { phone: "meta", label: t("persons.columns.defaultRole") },
        cell: ({ row }) => {
          const role = row.original.defaultRole;
          return role === null ? <NotRecorded /> : t(`persons.roles.${role}`);
        },
      },
      {
        accessorKey: "active",
        header: t("persons.columns.active"),
        meta: { phone: "status", label: t("persons.columns.active") },
        cell: ({ row }) => (
          <StatusBadge tone={row.original.active ? "success" : "neutral"}>
            {t(row.original.active ? "persons.active" : "persons.inactive")}
          </StatusBadge>
        ),
      },
    ],
    [t],
  );


  return (
    <PageContainer width="wide">
      <PageHeader
        title={t("persons.title")}
        actions={
          canRegister ? (
            <>
              {branches.length > 1 && (
                <Select
                  items={branches.map((branch) => ({
                    value: branch.code,
                    label: branch.name,
                  }))}
                  value={branchCode === "" ? null : branchCode}
                  onValueChange={(value: string | null) => setBranchCode(value ?? "")}
                >
                  <SelectTrigger
                    aria-label={t("persons.branchLabel")}
                    className="w-40"
                  >
                    <SelectValue placeholder={t("persons.branchPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((branch) => (
                      <SelectItem key={branch.code} value={branch.code}>
                        {branch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button
                type="button"
                disabled={branchCode === ""}
                onClick={() => setRegistering(true)}
              >
                <UserPlus className="size-4" aria-hidden />
                {label("register-person")}
              </Button>
            </>
          ) : undefined
        }
      />
      <p className="mt-2 max-w-lg text-sm text-muted-foreground">{t("persons.lead")}</p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <BranchScopeLine
          count={personsQuery.isPending ? undefined : persons.length}
        />
        <DataTableViewOptions
          className="ms-auto"
          columns={columns}
          value={columnVisibility}
          onChange={setColumnVisibility}
          primaryColumn={PRIMARY_COLUMN}
        />
      </div>

      {personsQuery.isError ? (
        <ErrorState
          className="mt-6"
          message={t("persons.loadFailed")}
          retryLabel={t("persons.retry")}
          onRetry={() => void personsQuery.refetch()}
        />
      ) : (
        <div className="mt-6">
          {/* The read hands back the whole branch at once, so the table can
              count its pages honestly instead of stepping a cursor. */}
          <DataTable
            columns={columns}
            data={persons}
            filters={filters}
            filterValues={filterValues}
            onFilterChange={setFilterValues}
            columnVisibility={columnVisibility}
            onColumnVisibilityChange={setColumnVisibility}
            defaultSorting={[{ id: "displayName", desc: false }]}
            primaryColumn={PRIMARY_COLUMN}
            pagination={{ defaultPageSize: 20 }}
            getRowId={(person) => person.id}
            emptyState={
              personsQuery.isPending ? (
                <LoadingState label={t("persons.loading")} />
              ) : (
                <BranchScopedEmptyState
                  icon={<Users className="size-7" aria-hidden />}
                  message={t("persons.branchEmptyHint")}
                  firstRun={{ message: t("persons.emptyHint") }}
                />
              )
            }
          />
        </div>
      )}

      {canRegister && branchCode !== "" && (
        <RegisterPersonDialog
          open={registering}
          onOpenChange={setRegistering}
          branchCode={branchCode}
          onRegistered={() => {
            notifyCommandSuccess(
              "activities",
              "personRegistered",
              [],
              createdElsewhereNotice({ branchCode }) ?? {},
            );
            void personsQuery.refetch();
          }}
        />
      )}
    </PageContainer>
  );
}
