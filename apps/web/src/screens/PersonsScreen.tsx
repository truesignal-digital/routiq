import { useEffect, useMemo, useState } from "react";
import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import { UserPlus, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
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
} from "@/components/data-table";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { deniedCode, PermissionDenied } from "@/components/permission-denied.js";
import { StatusBadge } from "@/components/status-badge.js";
import { useMeContext } from "@/auth/me.js";
import { useAssetRegistrationReference } from "@/assets/reference.js";
import { useCurrentBranchCode } from "@/shell/branch-context.js";
import { RegisterPersonDialog } from "@/activities/RegisterPersonDialog.js";
import { canRecordActivities, canViewActivities } from "@/activities/permissions.js";
import { usePersons } from "@/activities/usePersons.js";

const PRIMARY_COLUMN = { columnId: "displayName" } as const;
const SEARCH_FILTER_ID = "search";

export function PersonsScreen() {
  const { t } = useTranslation();
  const me = useMeContext();
  const canView = canViewActivities(me?.enabledModules);
  const canRegister = canRecordActivities(me?.role, me?.enabledModules);

  const [filterValues, setFilterValues] = useState<DataTableFilterValues>({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [registering, setRegistering] = useState(false);
  const [branchCode, setBranchCode] = useState("");

  const search = filterValues[SEARCH_FILTER_ID] ?? "";
  // `/v1/persons` does the matching; narrowing the loaded rows here would
  // describe the page instead of the payroll.
  const personsQuery = usePersons(search === "" ? {} : { search });
  const persons = personsQuery.data?.items ?? [];

  // A new person joins a branch, and the command names it by code — so the
  // screen has to know which one before it can offer to register anyone.
  const reference = useAssetRegistrationReference();
  const branches = useMemo(() => reference.data?.branches ?? [], [reference.data]);
  const currentBranchCode = useCurrentBranchCode();
  // The shell's current agency answers it by default, the only branch there is
  // otherwise; either way the picker stays editable.
  const preselectedBranchCode =
    currentBranchCode ?? (branches.length === 1 ? branches[0]?.code : undefined);
  useEffect(() => {
    if (preselectedBranchCode !== undefined && branchCode === "") {
      setBranchCode(preselectedBranchCode);
    }
  }, [preselectedBranchCode, branchCode]);

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

  const columns = useMemo<ColumnDef<PersonListItem>[]>(
    () => [
      {
        accessorKey: "displayName",
        header: t("persons.columns.displayName"),
        enableSorting: true,
        meta: { mobile: "primary", label: t("persons.columns.displayName") },
        cell: ({ row }) => row.original.displayName,
      },
      {
        accessorKey: "personCode",
        header: t("persons.columns.personCode"),
        enableSorting: true,
        meta: { mobile: "secondary", label: t("persons.columns.personCode") },
        cell: ({ row }) => (
          <span className="font-mono whitespace-nowrap">
            {row.original.personCode ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "defaultRole",
        header: t("persons.columns.defaultRole"),
        meta: { mobile: "secondary", label: t("persons.columns.defaultRole") },
        cell: ({ row }) => {
          const role = row.original.defaultRole;
          return role === null ? "—" : t(`persons.roles.${role}`);
        },
      },
      {
        accessorKey: "active",
        header: t("persons.columns.active"),
        meta: { mobile: "primary", label: t("persons.columns.active") },
        cell: ({ row }) => (
          <StatusBadge tone={row.original.active ? "success" : "neutral"}>
            {t(row.original.active ? "persons.active" : "persons.inactive")}
          </StatusBadge>
        ),
      },
    ],
    [t],
  );

  if (me !== undefined && !canView) {
    return (
      <PermissionDenied
        width="wide"
        title={t("persons.title")}
        icon={<Users className="size-7" aria-hidden />}
        code={deniedCode(me.enabledModules.includes("ACTIVITIES"))}
      />
    );
  }

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
                    className="h-9 w-40"
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
                className="min-h-11"
                disabled={branchCode === ""}
                onClick={() => setRegistering(true)}
              >
                <UserPlus className="size-4" aria-hidden />
                {t("persons.register")}
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <DataTableViewOptions
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
                <EmptyState
                  icon={<Users className="size-7" aria-hidden />}
                  message={t("persons.emptyHint")}
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
          onRegistered={() => void personsQuery.refetch()}
        />
      )}
    </PageContainer>
  );
}
