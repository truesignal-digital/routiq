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
import { historyEventLabelKey } from "@/components/record-history-sheet.js";
import { StatusBadge } from "@/components/status-badge.js";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format.js";
import { ISSUE_TONES, WORK_ORDER_TONES } from "./columns.js";
import type {
  MaintenanceDialog,
  WorkOrderDecision,
  WorkOrderRef,
} from "./MaintenanceDialogs.js";
import { useWorkOrder } from "./useMaintenance.js";
import { useCommandLabel } from "../commands/labels.js";

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
 * The work order's life, oldest first, straight off the audit trail. The kind
 * vocabulary is open — a command added later writes a code this list has never
 * seen — so the label is a lookup with the raw code as its own fallback, the
 * same contract the record history sheet keeps.
 */
export function Chronologie({
  events,
  locale,
}: {
  events: readonly WorkOrderChronologieEvent[];
  locale: string;
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
    <ol className="flex flex-col">
      {events.map((event) => {
        const isPlatform = event.actor.scope === "PLATFORM";
        const actorLabel = isPlatform
          ? t("history.actor.platform")
          : (event.actor.displayName ?? t("history.actor.unknown"));

        return (
          <li
            key={event.eventId}
            className="relative border-l border-border pb-5 pl-4 last:pb-0"
          >
            <span
              className="absolute -left-[3.5px] top-1.5 size-1.5 rounded-full bg-foreground/30"
              aria-hidden
            />
            {/* Actor then act, each its own message: the sentence is assembled
                from elements rather than glued together (i18n rule). */}
            <p className="text-sm">
              <span className="font-medium">{actorLabel}</span>{" "}
              <span className="text-muted-foreground">
                {t(historyEventLabelKey(event.kind), { defaultValue: event.kind })}
              </span>
            </p>
            <time
              dateTime={event.occurredAt}
              className="text-xs tabular-nums text-muted-foreground"
            >
              {formatDateTime(event.occurredAt, locale)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}

const ENTRY_STATUS_TONES = {
  POSTED: "success",
  REVERSED: "neutral",
  SUBMITTED: "warning",
} as const;

/**
 * Labour and parts booked against this repair, one list per set: the posted
 * lines are money spent, the pending ones are awaiting finance review and are
 * never read into it.
 */
export function CostLines({
  lines,
  locale,
}: {
  lines: readonly (WorkOrderCostLine | WorkOrderPendingCostLine)[];
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
              <span className="font-mono text-xs">{line.entryNumber}</span>
              <StatusBadge tone={ENTRY_STATUS_TONES[line.entryStatus]} icon={null}>
                {t(`maintenance.detail.entryStatus.${line.entryStatus}`)}
              </StatusBadge>
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
    </ul>
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
        className="min-h-9"
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
  onAction,
}: {
  row: WorkOrderListItem;
  /** Signalements already loaded by the screen — where availability is published. */
  issues: readonly IssueListItem[];
  permissions: WorkOrderSheetPermissions;
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
            <StatusBadge key="status" tone={WORK_ORDER_TONES[header.status]}>
              {t(`maintenance.workOrders.status.${header.status}`)}
            </StatusBadge>,
          ],
          [
            t("maintenance.workOrders.columns.asset"),
            <span key="asset" className="font-mono">
              {header.asset.assetCode}
            </span>,
          ],
          [t("maintenance.workOrders.columns.branch"), header.branch.name],
          [
            t("maintenance.workOrders.columns.expectedCost"),
            header.expectedCostMinor === null
              ? "—"
              : formatMoney(header.expectedCostMinor, {
                  currency: header.currency,
                  locale,
                }),
          ],
          [
            t("maintenance.workOrders.columns.actualCost"),
            header.actualCostMinor === null
              ? "—"
              : formatMoney(header.actualCostMinor, {
                  currency: header.currency,
                  locale,
                }),
          ],
          [
            t("maintenance.fields.issue"),
            header.issue === null ? (
              t("maintenance.detail.preventive")
            ) : (
              <span key="issue" className="flex flex-wrap items-center gap-1.5">
                <span>{linkedIssue?.description ?? t("maintenance.detail.linkedIssue")}</span>
                {linkedIssue !== undefined && (
                  <StatusBadge tone={ISSUE_TONES[linkedIssue.status]}>
                    {t(`maintenance.issues.status.${linkedIssue.status}`)}
                  </StatusBadge>
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
          <Chronologie events={detail?.chronologie ?? []} locale={locale} />
        )}
      </div>

      {detail !== undefined && (
        <div>
          <h3 className="mb-3 text-sm font-semibold">
            {t("maintenance.detail.costLines")}
          </h3>
          {detail.costLines.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("maintenance.detail.costLinesEmpty")}
            </p>
          ) : (
            <CostLines lines={detail.costLines} locale={locale} />
          )}
        </div>
      )}

      {detail !== undefined && detail.pendingCostLines.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold">
            {t("maintenance.detail.pendingCostLines")}
          </h3>
          <p className="mb-3 text-xs text-muted-foreground">
            {t("maintenance.detail.pendingCostLinesHint")}
          </p>
          <CostLines lines={detail.pendingCostLines} locale={locale} />
        </div>
      )}
    </div>
  );
}
