import { useTranslation } from "react-i18next";
import { ChevronRight, TriangleAlert } from "lucide-react";
import type { WorkOrderDetail } from "@routiq/contracts";
import { RecordEntryForm } from "@/finance/RecordEntryForm.js";
import { formatDateTime, formatMoney } from "@/lib/format.js";
import { cn } from "@/lib/utils";
import {
  CancelWorkOrderForm,
  CompleteWorkOrderForm,
  ReleaseForm,
  WorkOrderDecisionForm,
  type WorkOrderRef,
} from "@/maintenance/MaintenanceDialogs.js";
import { Chronologie, CostLines } from "@/maintenance/WorkOrderSheet.js";
import { useWorkOrder } from "@/maintenance/useMaintenance.js";
import { WorkOrderStatusBadge } from "@/maintenance/WorkOrderStatusBadge.js";
import { useVehicle, type PanelForm } from "../context.js";
import { groundingFacts, situationOf, workOrderSteps, workOrderWaiting } from "../flow.js";
import { recordReference } from "../model.js";
import { DetailHeader, DetailSection, FactList, Note, SafetyMark } from "../parts.js";
import {
  PanelFooter,
  PanelLoading,
  PanelMissing,
  useFormHost,
} from "./shared.js";
import { RecordHistorySheet } from "@/components/record-history-sheet.js";

export function WorkOrderRecord({ id, form }: { id: string; form: PanelForm | undefined }) {
  const { t, i18n } = useTranslation();
  const { asset, attention, viewer, panel, gates } = useVehicle();
  const query = useWorkOrder(id);
  const host = useFormHost(t("vehicle.panel.workOrderTitle", { ref: recordReference(id) }));
  const locale = i18n.language;

  if (query.isPending) return <PanelLoading />;
  if (query.isError || query.data === undefined) return <PanelMissing onRetry={() => void query.refetch()} />;
  const wo = query.data;
  if (wo.asset.id !== asset.id) return <PanelMissing />;

  const grounding = groundingFacts(asset);
  const isGrounding = grounding?.workOrder?.id === wo.id;
  const steps = workOrderSteps(wo, viewer, grounding);

  if (form !== undefined) {
    return <WorkOrderForm stepKey={form.key} wo={wo} host={host} />;
  }

  // Another safety-critical problem blocks the release, whoever signs it (#588).
  const others = isGrounding ? (grounding?.grounded.otherOpenSafetyIssues ?? []) : [];
  const [otherIssue] = others;
  const otherIssueParams =
    otherIssue === undefined ? undefined : { count: others.length, description: otherIssue.description };
  const waiting = workOrderWaiting(wo.status, isGrounding, otherIssue !== undefined);
  const actor = (name: string | null) => name ?? t("history.actor.unknown");
  // The vehicle header's own test, so the panel and the header never disagree on one screen.
  const situation = situationOf(asset, attention, new Date());
  const repaired = situation.kind === "grounded" && situation.repaired;

  return (
    <>
      <DetailHeader
        eyebrow={t("vehicle.panel.workOrderEyebrow", { ref: recordReference(wo.id) })}
        title={wo.description}
        meta={
          <>
            <WorkOrderStatusBadge status={wo.status} />
            {wo.issue?.safetyCritical === true && <SafetyMark />}
          </>
        }
      />
      <div className="space-y-6 p-4">
        {wo.issue !== null && (
          <button
            type="button"
            onClick={() => panel.openRecord({ kind: "issue", id: wo.issue?.id ?? "" })}
            className="flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
          >
            <TriangleAlert
              className={cn(
                "mt-0.5 size-4 shrink-0",
                wo.issue.safetyCritical ? "text-destructive" : "text-warning-foreground",
              )}
              aria-hidden
            />
            <span className="min-w-0 flex-1 text-sm font-medium">
              {t("vehicle.panel.fromProblem", { ref: recordReference(wo.issue.id) })}
            </span>
            <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        )}
        {isGrounding && (
          <Note tone={repaired ? "warning" : "danger"}>
            {wo.status !== "COMPLETED"
              ? t("vehicle.panel.keepsGrounded")
              : otherIssueParams === undefined
                ? t("vehicle.panel.keepsGroundedUntilRelease")
                : t("vehicle.panel.keepsGroundedOtherIssueOpen", otherIssueParams)}
          </Note>
        )}
        {wo.status === "APPROVED" && wo.completionRejectReason !== null && (
          <Note>{t("vehicle.panel.completionSentBack", { reason: wo.completionRejectReason })}</Note>
        )}
        {wo.costToCome !== null && (
          <Note tone="warning">
            {wo.costToCome.reason === "INVOICE_PENDING"
              ? t(
                  wo.costToCome.awaitingApproval
                    ? "vehicle.panel.costToCome.invoiceAwaitingApproval"
                    : "vehicle.panel.costToCome.invoicePending",
                )
              : t(
                  wo.costToCome.awaitingApproval
                    ? "vehicle.panel.costToCome.declaredAwaitingApproval"
                    : "vehicle.panel.costToCome.declared",
                  {
                    declared: formatMoney(wo.costToCome.declaredCostMinor, { currency: wo.currency, locale }),
                    recorded: formatMoney(wo.costToCome.recordedCostMinor, { currency: wo.currency, locale }),
                  },
                )}
          </Note>
        )}

        <FactList
          rows={[
            [
              t("vehicle.panel.opened"),
              t("vehicle.panel.atBy", {
                date: formatDateTime(wo.createdAt, locale),
                name: actor(wo.createdBy.displayName),
              }),
            ],
            // Costs a viewer may not read are left out, not shown as blanks.
            ...(!gates.workOrderCosts
              ? []
              : ([
                  [
                    t("vehicle.panel.expectedCost"),
                    wo.expectedCostMinor === null
                      ? t("vehicle.maintenance.noEstimate")
                      : formatMoney(wo.expectedCostMinor, { currency: wo.currency, locale }),
                  ],
                  [
                    t("vehicle.panel.actualCost"),
                    wo.actualCostMinor === null
                      ? t("vehicle.panel.actualCostLater")
                      : wo.costOutcome === "INVOICE_PENDING" && wo.actualCostMinor === 0
                        ? t("vehicle.panel.invoicePending")
                        : formatMoney(wo.actualCostMinor, { currency: wo.currency, locale }),
                  ],
                ] as const)),
            ...(wo.completedAt === null
              ? []
              : ([
                  [
                    t("vehicle.panel.completed"),
                    wo.completedBy === null
                      ? formatDateTime(wo.completedAt, locale)
                      : t("vehicle.panel.atBy", {
                          date: formatDateTime(wo.completedAt, locale),
                          name: actor(wo.completedBy.displayName),
                        }),
                  ],
                ] as const)),
          ]}
        />

        {wo.summary !== null && (
          <DetailSection title={t("vehicle.panel.whatWasDone")}>
            <p className="text-sm">{wo.summary}</p>
          </DetailSection>
        )}
        {(wo.rejectReason ?? wo.cancelReason) !== null && (
          <DetailSection title={t("vehicle.panel.reason")}>
            <p className="text-sm">{wo.rejectReason ?? wo.cancelReason}</p>
          </DetailSection>
        )}

        {/* Null when the reader may not see work-order costs (#390). The lines
            awaiting review are listed too, marked as such: the actual cost
            counts them (#81), and the list must add up to it (#612). */}
        {wo.costLines !== null && (
          <DetailSection title={t("vehicle.panel.costs")}>
            {wo.costLines.length + (wo.pendingCostLines?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">{t("maintenance.detail.costLinesEmpty")}</p>
            ) : (
              <CostLines lines={[...wo.costLines, ...(wo.pendingCostLines ?? [])]} locale={locale} />
            )}
          </DetailSection>
        )}

        <DetailSection title={t("maintenance.detail.chronologie")}>
          <Chronologie events={wo.chronologie} />
        </DetailSection>
        <div>
          <RecordHistorySheet entityType="work_order" entityId={wo.id} />
        </div>
      </div>
      <PanelFooter
        steps={steps}
        waiting={waiting === null ? null : t(`vehicle.panel.waitingOn.${waiting}`, otherIssueParams ?? {})}
        onStep={panel.openStep}
      />
    </>
  );
}

function WorkOrderForm({
  stepKey,
  wo,
  host,
}: {
  stepKey: string;
  wo: WorkOrderDetail;
  host: ReturnType<typeof useFormHost>;
}) {
  const { asset, pinnedLabel, refresh, panel } = useVehicle();
  const ref: WorkOrderRef = {
    id: wo.id,
    assetId: wo.asset.id,
    status: wo.status,
    issueId: wo.issue?.id ?? null,
    rowVersion: wo.rowVersion,
  };
  const common = { surface: "panel" as const, back: host.back, onDone: host.onDone, onDismiss: host.onDismiss };

  switch (stepKey) {
    case "approve-work-order":
      return <WorkOrderDecisionForm {...common} workOrder={ref} decision="approve" />;
    case "reject-work-order":
      return <WorkOrderDecisionForm {...common} workOrder={ref} decision="reject" />;
    case "approve-completion":
      return <WorkOrderDecisionForm {...common} workOrder={ref} decision="approve-completion" />;
    case "reject-completion":
      return <WorkOrderDecisionForm {...common} workOrder={ref} decision="reject-completion" />;
    case "complete-work-order":
      return <CompleteWorkOrderForm {...common} workOrder={ref} />;
    case "cancel-work-order":
      return <CancelWorkOrderForm {...common} workOrder={ref} />;
    case "release":
      return <ReleaseForm {...common} subject={{ kind: "work-order", workOrder: ref }} />;
    case "add-cost":
      return (
        <RecordEntryForm
          surface="panel"
          initialDirection="EXPENSE"
          lockDirection
          pinnedAssetId={asset.id}
          pinnedAssetLabel={pinnedLabel}
          link={{ workOrderId: wo.id }}
          lateCost={wo.status === "COMPLETED"}
          defaultBranchCode={asset.branch.code}
          back={host.back}
          onRecorded={() => {
            void refresh();
            panel.closeForm();
          }}
          onDismiss={host.onDismiss}
        />
      );
    default:
      return null;
  }
}
