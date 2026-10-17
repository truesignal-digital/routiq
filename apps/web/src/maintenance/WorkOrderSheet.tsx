import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert, TriangleAlert } from "lucide-react";
import type {
  IssueListItem,
  WorkOrderChronologieEvent,
  WorkOrderCostLine,
  WorkOrderDetail,
  WorkOrderListItem,
  WorkOrderPendingCostLine,
} from "@routiq/contracts";
import { ErrorState, LoadingState } from "@/components/page";
import { historyNote, Timeline, timelineAct } from "@/components/timeline.js";
import { StatusBadge } from "@/components/status-badge.js";
import { EntryStatusBadge } from "@/finance/EntryStatusBadge.js";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format.js";
import type {
  MaintenanceDialog,
  WorkOrderDecision,
  WorkOrderRef,
} from "./MaintenanceDialogs.js";
import { IssueStatusBadge } from "./IssueStatusBadge.js";
import type { WorkOrderMoneyShown } from "./permissions.js";
import { useWorkOrder } from "./useMaintenance.js";
import { WorkOrderStatusBadge } from "./WorkOrderStatusBadge.js";
import { useCommandLabel } from "../commands/labels.js";
import { NotRecorded } from "@/components/not-recorded.js";

export interface WorkOrderSheetPermissions {
  manage: boolean;
  approve: boolean;
  release: boolean;
}

function Facts({ facts }: { facts: ReadonlyArray<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
      {facts.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-sm">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The work order's (or problem's) life, oldest first, straight off the audit
 * trail, on the same timeline as every other record's history: a decision's
 * note shows under the decision.
 */
export function Chronologie({
  events,
}: {
  events: readonly WorkOrderChronologieEvent[];
}) {
  const { t } = useTranslation();

  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("maintenance.detail.chronologieEmpty")}
      </p>
    );
  }

  return (
    <Timeline
      // Recorded, not happened: a problem's report time can be earlier (#396).
      timeLabel={(date) => t("maintenance.detail.recordedAt", { date })}
      events={events.map((event) => ({
        id: event.eventId,
        occurredAt: event.occurredAt,
        actor: event.actor,
        act: timelineAct(event.kind, t),
        note: historyNote(event, t),
      }))}
    />
  );
}

/**
 * Labour and parts booked against this repair, each line with its entry's
 * status, so a line awaiting review reads as such. `otherBranchesMinor` adds
 * one line for what was booked in branches the reader cannot see (#643): an
 * amount, never those lines' details.
 */
export function CostLines({
  lines,
  otherBranchesMinor = 0,
  currency,
  locale,
}: {
  lines: readonly (WorkOrderCostLine | WorkOrderPendingCostLine)[];
  otherBranchesMinor?: number;
  currency: string;
  locale: string;
}) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-col gap-2">
      {lines.map((line) => (
        <li
          key={line.postingId}
          className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-md bg-foreground/[0.035] px-3 py-2"
        >
          <span className="flex min-w-0 flex-col">
            <span className="flex flex-wrap items-center gap-2">
              <span className="tabular-nums text-xs">{line.entryNumber}</span>
              <EntryStatusBadge status={line.entryStatus} />
            </span>
            <span className="text-xs text-muted-foreground">
              {line.description ?? formatDate(line.economicDate, locale)}
            </span>
          </span>
          {/* SIGNED minor units — a reversal's line subtracts, and the sign is
              the only thing that says so. */}
          <span className="tabular-nums whitespace-nowrap">
            {formatMoney(line.amountMinor, { currency: line.currency, locale })}
          </span>
        </li>
      ))}
      {otherBranchesMinor !== 0 && (
        <li className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-md bg-foreground/[0.035] px-3 py-2">
          <span className="text-xs text-muted-foreground">{t("maintenance.detail.otherBranchesCost")}</span>
          <span className="tabular-nums whitespace-nowrap">
            {formatMoney(otherBranchesMinor, { currency, locale })}
          </span>
        </li>
      )}
    </ul>
  );
}

/**
 * A work order's costs as one list that adds up to its actual cost: the posted
 * lines, those awaiting review (the actual cost counts them, #81, #612), and
 * the sum booked in other branches (#643). Render only when the read sent the
 * lines (`costLines` is null for a reader who may not see them).
 */
export function WorkOrderCosts({ detail, locale }: { detail: WorkOrderDetail; locale: string }) {
  const { t } = useTranslation();
  const lines = [...(detail.costLines ?? []), ...(detail.pendingCostLines ?? [])];
  const otherBranchesMinor = detail.otherBranchesCostMinor ?? 0;
  if (lines.length === 0 && otherBranchesMinor === 0) {
    return <p className="text-sm text-muted-foreground">{t("maintenance.detail.costLinesEmpty")}</p>;
  }
  return (
    <CostLines lines={lines} otherBranchesMinor={otherBranchesMinor} currency={detail.currency} locale={locale} />
  );
}

/** The actions the work order's own status allows, filtered by what the role may do. */
function SheetActions({
  detail,
  permissions,
  assetUnavailable,
  onAction,
}: {
  detail: WorkOrderDetail;
  permissions: WorkOrderSheetPermissions;
  /** Only a grounded asset has anything to release. */
  assetUnavailable: boolean;
  onAction: (dialog: MaintenanceDialog) => void;
}) {
  const label = useCommandLabel();
  const workOrder: WorkOrderRef = {
    id: detail.id,
    number: detail.number,
    assetId: detail.asset.id,
    status: detail.status,
    issueId: detail.issue?.id ?? null,
    rowVersion: detail.rowVersion,
  };

  const buttons: ReactNode[] = [];
  const action = (
    key: string,
    label: string,
    dialog: MaintenanceDialog,
    variant: "default" | "outline" | "destructive" = "default",
  ) =>
    buttons.push(
      <Button
        key={key}
        type="button"
        variant={variant}
        onClick={() => onAction(dialog)}
      >
        {label}
      </Button>,
    );
  const decide = (
    decision: WorkOrderDecision,
    label: string,
    variant: "default" | "outline" | "destructive" = "default",
  ) => action(decision, label, { kind: "decide-work-order", decision, workOrder }, variant);

  switch (detail.status) {
    case "SUBMITTED":
      if (permissions.approve) {
        decide("approve", label("approve-work-order"));
        decide("reject", label("reject-work-order"), "destructive");
      }
      break;
    case "APPROVED":
      if (permissions.manage) {
        action("complete", label("complete-work-order"), { kind: "complete", workOrder });
      }
      break;
    case "COMPLETION_SUBMITTED":
      if (permissions.approve) {
        decide("approve-completion", label("approve-work-order-closure"));
        decide("reject-completion", label("reject-work-order-completion"), "destructive");
      }
      break;
    case "COMPLETED":
      if (permissions.release && assetUnavailable) {
        action("release", label("release-asset-to-service"), { kind: "release", workOrder });
      }
      break;
    case "REJECTED":
    case "CANCELLED":
      break;
  }

  if (
    (detail.status === "SUBMITTED" ||
      detail.status === "APPROVED" ||
      detail.status === "COMPLETION_SUBMITTED") &&
    permissions.manage
  ) {
    action(
      "cancel",
      label("cancel-work-order"),
      { kind: "cancel", workOrder },
      "destructive",
    );
  }

  if (buttons.length === 0) return null;
  return <div className="flex flex-wrap gap-2">{buttons}</div>;
}

function LabelledText({ label, text }: { label: string; text: string | null | undefined }) {
  if (text == null || text === "") return null;
  return (
    <div>
      <h3 className="text-xs text-muted-foreground">{label}</h3>
      <p className="mt-1 text-sm">{text}</p>
    </div>
  );
}

/**
 * One work order's whole story, opened from its row. The chronologie and the
 * cost lines are what the detail read adds; everything else is on both reads,
 * and `header` below decides which copy is on screen.
 */
export function WorkOrderSheet({
  row,
  issues,
  permissions,
  money,
  onAction,
}: {
  row: WorkOrderListItem;
  /** Signalements already loaded by the screen — where availability is published. */
  issues: readonly IssueListItem[];
  permissions: WorkOrderSheetPermissions;
  /** Which amounts this reader sees: the estimate (#640), the actual cost (#328, #390). */
  money: WorkOrderMoneyShown;
  onAction: (dialog: MaintenanceDialog) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const detailQuery = useWorkOrder(row.id);
  const detail = detailQuery.data;

  /**
   * The detail read is the live copy; `row` is a snapshot the table handed the
   * drawer when it opened and never revises — activating a row copies the
   * object into the viewer's own state (`data-table.tsx`), so a command
   * committed from inside this sheet leaves it describing the work order as it
   * was. Falling back to it only until the detail lands keeps the sheet from
   * opening blank without letting it go stale afterwards: declaring a closure
   * has to move the status pill and the actual cost, not just the timeline.
   */
  const header: WorkOrderListItem = detail ?? row;

  const linkedIssue =
    header.issue === null
      ? undefined
      : issues.find((issue) => issue.id === header.issue?.id);
  const safetyCritical = header.issue?.safetyCritical ?? false;

  return (
    <div className="flex flex-col gap-5">
      {/* Availability, not lifecycle status: a grounded truck stays IN_SERVICE
          and only a release re-opens the interval (§3.4). */}
      {linkedIssue?.assetUnavailable === true && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0 text-destructive"
            aria-hidden
          />
          <span>
            <span className="block font-semibold text-destructive">
              {t("maintenance.detail.unavailableTitle")}
            </span>
            <span className="block text-muted-foreground">
              {t("maintenance.detail.unavailableHint")}
            </span>
          </span>
        </div>
      )}

      <Facts
        facts={[
          [
            t("maintenance.workOrders.columns.status"),
            <WorkOrderStatusBadge key="status" status={header.status} />,
          ],
          [
            t("maintenance.workOrders.columns.asset"),
            <span key="asset" className="tabular-nums">
              {header.asset.assetCode}
            </span>,
          ],
          [t("maintenance.workOrders.columns.branch"), header.branch.name],
          // Costs the read withheld (#390, #640) are left out, not called unrecorded.
          ...(!money.estimate
            ? []
            : ([
                [
                  t("maintenance.workOrders.columns.expectedCost"),
                  header.expectedCostMinor === null ? (
                    <NotRecorded />
                  ) : (
                    formatMoney(header.expectedCostMinor, { currency: header.currency, locale })
                  ),
                ],
              ] satisfies [string, ReactNode][])),
          ...(!money.actual
            ? []
            : ([
                [
                  t("maintenance.workOrders.columns.actualCost"),
                  header.actualCostMinor === null ? (
                    <NotRecorded />
                  ) : (
                    formatMoney(header.actualCostMinor, { currency: header.currency, locale })
                  ),
                ],
              ] satisfies [string, ReactNode][])),
          [
            t("maintenance.fields.issue"),
            header.issue === null ? (
              t("maintenance.detail.preventive")
            ) : (
              <span key="issue" className="flex flex-wrap items-center gap-1.5">
                <span>{linkedIssue?.description ?? t("maintenance.detail.linkedIssue")}</span>
                {linkedIssue !== undefined && (
                  <IssueStatusBadge issue={linkedIssue} />
                )}
                {safetyCritical && (
                  <StatusBadge tone="danger" icon={ShieldAlert}>
                    {t("maintenance.issues.safetyCritical")}
                  </StatusBadge>
                )}
              </span>
            ),
          ],
        ]}
      />

      <div>
        <h3 className="text-xs text-muted-foreground">
          {t("maintenance.fields.description")}
        </h3>
        <p className="mt-1 text-sm">{header.description}</p>
      </div>

      <LabelledText label={t("maintenance.fields.summary")} text={detail?.summary} />
      <LabelledText label={t("maintenance.fields.cancelReason")} text={detail?.cancelReason} />
      {detail?.status === "REJECTED" && (
        <LabelledText label={t("maintenance.fields.rejectReason")} text={detail.rejectReason} />
      )}
      {/* Kept on the row while the order is open again, so the workshop sees
          what to fix before declaring completion a second time. */}
      {detail?.status === "APPROVED" && (
        <LabelledText
          label={t("maintenance.fields.completionRejectReason")}
          text={detail.completionRejectReason}
        />
      )}

      {detail !== undefined && (
        <SheetActions
          detail={detail}
          permissions={permissions}
          assetUnavailable={linkedIssue?.assetUnavailable === true}
          onAction={onAction}
        />
      )}

      <div>
        <h3 className="mb-3 text-sm font-semibold">
          {t("maintenance.detail.chronologie")}
        </h3>
        {detailQuery.isPending ? (
          <LoadingState label={t("maintenance.detail.loading")} rows={2} />
        ) : detailQuery.isError ? (
          <ErrorState
            message={t("maintenance.detail.loadFailed")}
            retryLabel={t("maintenance.retry")}
            onRetry={() => void detailQuery.refetch()}
          />
        ) : (
          <Chronologie events={detail?.chronologie ?? []} />
        )}
      </div>

      {/* Null when the reader may not see work-order costs (#390, #328). */}
      {detail !== undefined && detail.costLines !== null && (
        <div>
          <h3 className="mb-3 text-sm font-semibold">
            {t("maintenance.detail.costLines")}
          </h3>
          <WorkOrderCosts detail={detail} locale={locale} />
        </div>
      )}
    </div>
  );
}
