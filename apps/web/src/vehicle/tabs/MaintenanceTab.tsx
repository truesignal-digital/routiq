import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, CircleCheck, ShieldAlert, TriangleAlert, Wrench } from "lucide-react";
import type { IssueListItem, WorkOrderListItem } from "@routiq/contracts";
import { EmptyState, ErrorState, LoadingState } from "@/components/page";
import { deniedCode, PermissionDenied } from "@/components/permission-denied.js";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDate, formatMoney, formatRelativeTime } from "@/lib/format.js";
import { cn } from "@/lib/utils";
import { useIssues, useWorkOrders } from "@/maintenance/useMaintenance.js";
import { ALL_BRANCHES } from "@/shell/branch-context.js";
import { actionDef } from "../actions.js";
import { useVehicle } from "../context.js";
import { groundingFacts, isActiveWorkOrder, issueSteps, workOrderSteps } from "../flow.js";
import { recordReference, type VehicleActionKey } from "../model.js";
import { RecordRow, RowIcon, RowMenu, SafetyMark, Sep, SubHead, TabHeader } from "../parts.js";
import { IssueStatusBadge } from "@/maintenance/IssueStatusBadge.js";
import { WorkOrderStatusBadge } from "@/maintenance/WorkOrderStatusBadge.js";
import { useIssueCategoryLabel } from "../panel/IssueRecord.js";

/** The one primary button a tab carries; it starts the action the way the catalogue says. */
export function TabAction({ actionKey }: { actionKey: VehicleActionKey }) {
  const { t } = useTranslation();
  const { can, availability, runAction } = useVehicle();
  if (!can(actionKey) || availability(actionKey).state !== "enabled") return null;
  const Icon = actionDef(actionKey).icon;
  return (
    <Button className="h-10 self-start sm:h-9 sm:self-auto" onClick={() => runAction(actionKey)}>
      <Icon aria-hidden />
      {t(`vehicle.actions.${actionKey}.label`)}
    </Button>
  );
}

export function MaintenanceTab() {
  const { t } = useTranslation();
  const { gates } = useVehicle();
  if (!gates.maintenance) {
    return (
      <PermissionDenied
        title={t("vehicle.tabs.maintenance")}
        icon={<Wrench className="size-7" aria-hidden />}
        code={deniedCode(false)}
      />
    );
  }
  return <MaintenanceSection />;
}

/** Problems reported on this vehicle and the work orders that fix them. */
function MaintenanceSection() {
  const { t } = useTranslation();
  const { asset } = useVehicle();
  const [showDone, setShowDone] = useState(false);
  // The vehicle's page never narrows to the shell's agency.
  const workOrdersQuery = useWorkOrders({ assetId: asset.id, branchId: ALL_BRANCHES });
  const issuesQuery = useIssues({ assetId: asset.id, branchId: ALL_BRANCHES });

  if (workOrdersQuery.isPending || issuesQuery.isPending) {
    return <LoadingState label={t("vehicle.maintenance.loading")} />;
  }
  if (workOrdersQuery.isError || issuesQuery.isError) {
    return (
      <ErrorState
        message={t("vehicle.maintenance.loadFailed")}
        retryLabel={t("vehicle.panel.retry")}
        onRetry={() => {
          void workOrdersQuery.refetch();
          void issuesQuery.refetch();
        }}
      />
    );
  }

  const workOrders = workOrdersQuery.data.pages.flatMap((page) => page.items);
  const issues = issuesQuery.data.pages.flatMap((page) => page.items);
  const planned = (issue: IssueListItem) => issue.workOrders.some((wo) => isActiveWorkOrder(wo.status));
  const active = workOrders.filter((wo) => isActiveWorkOrder(wo.status));
  const unplanned = issues.filter((issue) => issue.status === "OPEN" && !planned(issue));
  const doneOrders = workOrders.filter((wo) => !isActiveWorkOrder(wo.status));
  const doneIssues = issues.filter((issue) => issue.status !== "OPEN");

  return (
    <div className="space-y-7">
      <TabHeader
        title={t("vehicle.maintenance.title")}
        description={t("vehicle.maintenance.description")}
        action={<TabAction actionKey="report-issue" />}
      />

      <section>
        <SubHead
          title={t("vehicle.maintenance.workOrders")}
          count={active.length}
          description={t("vehicle.maintenance.workOrdersHint")}
        />
        {active.length === 0 ? (
          <EmptyState icon={<Wrench className="size-6" aria-hidden />} message={t("vehicle.maintenance.workOrdersEmpty")} />
        ) : (
          <Card className="gap-0 py-0">
            <ul className="divide-y">
              {active.map((wo) => (
                <WorkOrderRow key={wo.id} wo={wo} />
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section>
        <SubHead
          title={t("vehicle.maintenance.newProblems")}
          count={unplanned.length}
          description={t("vehicle.maintenance.newProblemsHint")}
        />
        {unplanned.length === 0 ? (
          <EmptyState
            icon={<CircleCheck className="size-6" aria-hidden />}
            message={t("vehicle.maintenance.newProblemsEmpty")}
            className="py-8"
          />
        ) : (
          <Card className="gap-0 py-0">
            <ul className="divide-y">
              {unplanned.map((issue) => (
                <IssueRow key={issue.id} issue={issue} />
              ))}
            </ul>
          </Card>
        )}
      </section>

      {(doneOrders.length > 0 || doneIssues.length > 0) && (
        <section>
          <button
            type="button"
            onClick={() => setShowDone((open) => !open)}
            aria-expanded={showDone}
            className="flex w-full items-center gap-2 rounded-md py-1 text-left text-sm font-semibold hover:text-foreground/80"
          >
            <ChevronRight className={cn("size-4 transition-transform", showDone && "rotate-90")} aria-hidden />
            {t("vehicle.maintenance.done")}
            <span className="font-normal text-muted-foreground">
              {t("vehicle.maintenance.doneSummary", {
                workOrders: doneOrders.length,
                problems: doneIssues.length,
              })}
            </span>
          </button>
          {showDone && (
            <Card className="mt-3 gap-0 py-0">
              <ul className="divide-y">
                {doneOrders.map((wo) => (
                  <WorkOrderRow key={wo.id} wo={wo} />
                ))}
                {doneIssues.map((issue) => (
                  <IssueRow key={issue.id} issue={issue} />
                ))}
              </ul>
            </Card>
          )}
        </section>
      )}
    </div>
  );
}

function WorkOrderRow({ wo }: { wo: WorkOrderListItem }) {
  const { t, i18n } = useTranslation();
  const { asset, viewer, panel } = useVehicle();
  const locale = i18n.language;
  const active = isActiveWorkOrder(wo.status);
  const steps = workOrderSteps(wo, viewer, groundingFacts(asset));
  const safety = wo.issue?.safetyCritical === true;
  const money = (minor: number) => formatMoney(minor, { currency: wo.currency, locale });
  const over =
    wo.actualCostMinor !== null && wo.expectedCostMinor !== null && wo.expectedCostMinor > 0 &&
    wo.actualCostMinor > wo.expectedCostMinor;
  // A close that recorded nothing says why, the way the order's panel does; never a derived 0.
  const closedWithoutCost =
    wo.actualCostMinor === 0
      ? wo.costOutcome === "INVOICE_PENDING"
        ? t("vehicle.panel.invoicePending")
        : wo.costOutcome === "NO_COST"
          ? t("vehicle.panel.noCost")
          : null
      : null;
  const offered = [
    ...steps.offered.filter((s) => s.lock === undefined),
    ...(steps.primary.kind === "locked" ? [{ step: steps.primary.step, lock: steps.primary.lock }] : []),
  ];

  return (
    <RecordRow
      icon={<RowIcon icon={Wrench} tone={active && safety ? "danger" : active ? "info" : "neutral"} />}
      title={wo.description}
      muted={!active}
      detail={
        <span className="flex flex-wrap items-center gap-x-1.5">
          <span className="tabular-nums">{recordReference(wo.id)}</span>
          {wo.issue !== null && (
            <>
              <Sep />
              <span>{t("vehicle.maintenance.fromProblem", { ref: recordReference(wo.issue.id) })}</span>
            </>
          )}
          {active && safety && (
            <>
              <Sep />
              <SafetyMark />
            </>
          )}
        </span>
      }
      status={
        <span className="flex flex-col items-start gap-1">
          <WorkOrderStatusBadge status={wo.status} />
          {steps.primary.kind === "go" && (
            <span className="text-xs font-medium text-foreground">{t("vehicle.maintenance.nextStepYours")}</span>
          )}
        </span>
      }
      aside={
        <>
          <div className={cn(!active && "text-muted-foreground")}>
            {closedWithoutCost !== null
              ? closedWithoutCost
              : wo.actualCostMinor !== null
                ? money(wo.actualCostMinor)
                : wo.expectedCostMinor !== null
                  ? t("vehicle.maintenance.planned", { amount: money(wo.expectedCostMinor) })
                  : t("vehicle.maintenance.noEstimate")}
            {over && wo.expectedCostMinor !== null && wo.actualCostMinor !== null && (
              <span className="ml-1 text-xs font-medium text-warning-foreground">
                {t("vehicle.maintenance.overBudget", {
                  percent: Math.round(((wo.actualCostMinor - wo.expectedCostMinor) / wo.expectedCostMinor) * 100),
                })}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {wo.completedAt !== null
              ? t("vehicle.maintenance.doneOn", { date: formatDate(wo.completedAt, locale) })
              : wo.cancelledAt !== null
                ? t("vehicle.maintenance.cancelledOn", { date: formatDate(wo.cancelledAt, locale) })
                : wo.rejectedAt !== null
                  ? t("vehicle.maintenance.refusedOn", { date: formatDate(wo.rejectedAt, locale) })
                  : t("vehicle.maintenance.openedOn", { date: formatDate(wo.createdAt, locale) })}
          </div>
        </>
      }
      menu={
        <RowMenu
          label={t("vehicle.panel.workOrderTitle", { ref: recordReference(wo.id) })}
          steps={offered}
          onStep={panel.openStep}
        />
      }
      onOpen={() => panel.openRecord({ kind: "work_order", id: wo.id })}
    />
  );
}

function IssueRow({ issue }: { issue: IssueListItem }) {
  const { t, i18n } = useTranslation();
  const { asset, viewer, panel } = useVehicle();
  const categoryLabel = useIssueCategoryLabel();
  const locale = i18n.language;
  const open = issue.status === "OPEN";
  const planned = issue.workOrders.some((wo) => isActiveWorkOrder(wo.status));
  const steps = issueSteps({ id: issue.id, status: issue.status, planned }, viewer, groundingFacts(asset));
  const category = categoryLabel(issue.category);

  return (
    <RecordRow
      icon={
        <RowIcon
          icon={issue.safetyCritical && open ? ShieldAlert : TriangleAlert}
          tone={!open ? "neutral" : issue.safetyCritical ? "danger" : "warning"}
        />
      }
      title={issue.description}
      muted={!open}
      detail={
        <span className="flex flex-wrap items-center gap-x-1.5">
          <span className="tabular-nums">{recordReference(issue.id)}</span>
          {category !== null && (
            <>
              <Sep />
              <span>{category}</span>
            </>
          )}
          {open && issue.safetyCritical && (
            <>
              <Sep />
              <SafetyMark />
            </>
          )}
        </span>
      }
      status={<IssueStatusBadge issue={issue} />}
      aside={
        <>
          <div className={cn(!open && "text-muted-foreground")}>{formatDate(issue.reportedAt, locale)}</div>
          <div className="text-xs text-muted-foreground">
            {open ? formatRelativeTime(issue.reportedAt, locale) : t("vehicle.maintenance.reported")}
          </div>
        </>
      }
      menu={
        <RowMenu
          label={t("vehicle.panel.issueTitle", { ref: recordReference(issue.id) })}
          steps={steps.offered}
          onStep={panel.openStep}
        />
      }
      onOpen={() => panel.openRecord({ kind: "issue", id: issue.id })}
    />
  );
}
