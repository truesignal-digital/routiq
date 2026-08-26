import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ShieldAlert, TriangleAlert } from "lucide-react";
import type {
  IssueListItem,
  WorkOrderChronologieEvent,
  WorkOrderCostLine,
  WorkOrderDetail,
  WorkOrderListItem,
} from "@routiq/contracts";
import { ErrorState, LoadingState } from "@/components/page";
import { historyEventLabelKey } from "@/components/record-history-sheet.js";
import { StatusBadge } from "@/components/status-badge.js";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format.js";
import { WORK_ORDER_TONES } from "./columns.js";
import type { MaintenanceDialog, WorkOrderRef } from "./MaintenanceDialogs.js";
import { useWorkOrder } from "./useMaintenance.js";

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
function Chronologie({
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

/**
 * Labour and parts booked against this repair. A submitted-but-unapproved line
 * is stamped as such: it is not money spent yet, and the total would lie if it
 * pretended otherwise.
 */
function CostLines({
  lines,
  locale,
}: {
  lines: readonly WorkOrderCostLine[];
  locale: string;
}) {
  const { t } = useTranslation();

  if (lines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t("maintenance.detail.costLinesEmpty")}
      </p>
    );
  }

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
              <StatusBadge
                tone={line.entryStatus === "POSTED" ? "success" : "warning"}
                icon={null}
              >
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
  onAction,
}: {
  detail: WorkOrderDetail;
  permissions: WorkOrderSheetPermissions;
  onAction: (dialog: MaintenanceDialog) => void;
}) {
  const { t } = useTranslation();
  const workOrder: WorkOrderRef = {
    id: detail.id,
    assetId: detail.asset.id,
    status: detail.status,
    rowVersion: detail.rowVersion,
  };

  const buttons: ReactNode[] = [];

  if (detail.status === "SUBMITTED" && permissions.approve) {
    buttons.push(
      <Button
        key="approve"
        type="button"
        className="min-h-9"
        onClick={() => onAction({ kind: "approve", workOrder })}
      >
        {t("maintenance.actions.approve")}
      </Button>,
    );
  }

  if (detail.status === "OPEN" && permissions.manage) {
    buttons.push(
      <Button
        key="complete"
        type="button"
        className="min-h-9"
        onClick={() => onAction({ kind: "complete", workOrder })}
      >
        {t("maintenance.actions.declareClosure")}
      </Button>,
    );
  }

  if (detail.status === "PENDING_CLOSE" && permissions.approve) {
    buttons.push(
      <Button
        key="approve-closure"
        type="button"
        className="min-h-9"
        onClick={() => onAction({ kind: "approve-closure", workOrder })}
      >
        {t("maintenance.actions.approveClosure")}
      </Button>,
    );
  }

  if (detail.status === "CLOSED" && permissions.release) {
    buttons.push(
      <Button
        key="release"
        type="button"
        className="min-h-9"
        onClick={() => onAction({ kind: "release", workOrder })}
      >
        {t("maintenance.actions.release")}
      </Button>,
    );
  }

  if (
    (detail.status === "SUBMITTED" || detail.status === "OPEN") &&
    permissions.manage
  ) {
    buttons.push(
      <Button
        key="cancel"
        type="button"
        variant="outline"
        className="min-h-9"
        onClick={() => onAction({ kind: "cancel", workOrder })}
      >
        {t("maintenance.actions.cancelWorkOrder")}
      </Button>,
    );
  }

  if (buttons.length === 0) return null;
  return <div className="flex flex-wrap gap-2">{buttons}</div>;
}

/**
 * One work order's whole story, opened from its row. The header comes from the
 * list row so the sheet is never blank while the detail lands; the chronologie
 * and the cost lines are what the detail read adds.
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

  const linkedIssue =
    row.issue === null
      ? undefined
      : issues.find((issue) => issue.id === row.issue?.id);
  const safetyCritical = row.issue?.safetyCritical ?? false;

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
            <StatusBadge key="status" tone={WORK_ORDER_TONES[row.status]}>
              {t(`maintenance.workOrders.status.${row.status}`)}
            </StatusBadge>,
          ],
          [
            t("maintenance.workOrders.columns.asset"),
            <span key="asset" className="font-mono">
              {row.asset.assetCode}
            </span>,
          ],
          [t("maintenance.workOrders.columns.branch"), row.branch.name],
          [
            t("maintenance.workOrders.columns.expectedCost"),
            row.expectedCostMinor === null
              ? "—"
              : formatMoney(row.expectedCostMinor, { currency: row.currency, locale }),
          ],
          [
            t("maintenance.workOrders.columns.actualCost"),
            row.actualCostMinor === null
              ? "—"
              : formatMoney(row.actualCostMinor, { currency: row.currency, locale }),
          ],
          [
            t("maintenance.fields.issue"),
            row.issue === null ? (
              t("maintenance.detail.preventive")
            ) : (
              <span key="issue" className="flex flex-wrap items-center gap-1.5">
                <span>{linkedIssue?.description ?? t("maintenance.detail.linkedIssue")}</span>
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
        <p className="mt-1 text-sm">{row.description}</p>
      </div>

      {detail?.summary != null && detail.summary !== "" && (
        <div>
          <h3 className="text-xs text-muted-foreground">
            {t("maintenance.fields.summary")}
          </h3>
          <p className="mt-1 text-sm">{detail.summary}</p>
        </div>
      )}

      {detail?.cancelReason != null && detail.cancelReason !== "" && (
        <div>
          <h3 className="text-xs text-muted-foreground">
            {t("maintenance.fields.cancelReason")}
          </h3>
          <p className="mt-1 text-sm">{detail.cancelReason}</p>
        </div>
      )}

      {detail !== undefined && (
        <SheetActions
          detail={detail}
          permissions={permissions}
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
          <CostLines lines={detail.costLines} locale={locale} />
        </div>
      )}
    </div>
  );
}
