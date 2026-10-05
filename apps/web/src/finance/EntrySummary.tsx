import { useTranslation } from "react-i18next";
import type { EntryEvidenceFile, FinancialEntryDetail } from "@routiq/contracts";
import { EmptyState, ErrorState, LoadingState } from "@/components/page";
import { RecordHistorySheet } from "@/components/record-history-sheet.js";
import { EntryLinks } from "@/finance/EntryLinks.js";
import { FinanceStatusBadge } from "@/finance/FinanceStatusBadge.js";
import { useEntry } from "@/finance/useEntry.js";
import { RecordFileRow } from "@/vehicle/panel/shared.js";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatPaymentMethod,
  localizedLabel,
} from "@/lib/format.js";
import { FileText } from "lucide-react";

/**
 * The entry as a reader needs it before deciding on it: fields, postings,
 * receipt and history. Shared by the detail route and the row drawers of the
 * entries list and the approvals queue. It owns the read so any host can drop
 * it in without threading the query through; react-query dedupes the callers
 * onto one request.
 */
export function EntrySummary({ entryId }: { entryId: string }) {
  const { t } = useTranslation();
  const entryQuery = useEntry(entryId);

  if (entryQuery.isPending) {
    return <LoadingState label={t("finance.entries.loading")} />;
  }

  if (entryQuery.isError) {
    return (
      <ErrorState
        message={t("finance.entries.loadFailed")}
        retryLabel={t("finance.entries.retry")}
        onRetry={() => void entryQuery.refetch()}
      />
    );
  }

  const entry = entryQuery.data;

  if (entry === undefined) {
    return (
      <EmptyState
        icon={<FileText className="size-7" aria-hidden />}
        message={t("finance.entries.detail.notFound")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase text-muted-foreground">
            {t("finance.entries.detail.entryNumber")}
          </dt>
          <dd className="mt-1 font-mono">{entry.entryNumber}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase text-muted-foreground">
            {t("finance.entries.detail.status")}
          </dt>
          <dd className="mt-1">
            <FinanceStatusBadge status={entry.status}>
              {t(`finance.entries.status.${entry.status}`)}
            </FinanceStatusBadge>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase text-muted-foreground">
            {t("finance.entries.detail.category")}
          </dt>
          <dd className="mt-1">{localizedLabel(entry.category)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase text-muted-foreground">
            {t("finance.entries.detail.amount")}
          </dt>
          <dd className="mt-1 font-mono text-lg font-semibold">
            {formatMoney(entry.amountMinor, {
              currency: entry.currency,
              signDisplay: "always",
            })}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase text-muted-foreground">
            {t("finance.entries.detail.date")}
          </dt>
          <dd className="mt-1">{formatDate(entry.economicDate)}</dd>
        </div>
        {entry.postedAt && (
          <div>
            <dt className="text-xs font-semibold uppercase text-muted-foreground">
              {t("finance.entries.detail.postingDate")}
            </dt>
            <dd className="mt-1">{formatDate(entry.postedAt)}</dd>
          </div>
        )}
        {entry.counterpartyName && (
          <div>
            <dt className="text-xs font-semibold uppercase text-muted-foreground">
              {t("finance.entries.detail.counterparty")}
            </dt>
            <dd className="mt-1">{entry.counterpartyName}</dd>
          </div>
        )}
        {(entry.links.workOrderId !== null || entry.links.activityId !== null) && (
          <div>
            <dt className="text-xs font-semibold uppercase text-muted-foreground">
              {t("finance.entries.detail.linkedTo")}
            </dt>
            <dd className="mt-1">
              <EntryLinks links={entry.links} />
            </dd>
          </div>
        )}
        <div>
          <dt className="text-xs font-semibold uppercase text-muted-foreground">
            {t("finance.entries.detail.paymentMethod")}
          </dt>
          <dd className="mt-1">{formatPaymentMethod(entry.paymentMethod, t)}</dd>
        </div>
        {entry.description && (
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold uppercase text-muted-foreground">
              {t("finance.entries.detail.description")}
            </dt>
            <dd className="mt-1">{entry.description}</dd>
          </div>
        )}
        {entry.paymentReference && (
          <div>
            <dt className="text-xs font-semibold uppercase text-muted-foreground">
              {t("finance.entries.detail.paymentReference")}
            </dt>
            <dd className="mt-1 font-mono text-sm">{entry.paymentReference}</dd>
          </div>
        )}
        {entry.sourceReference && (
          <div>
            <dt className="text-xs font-semibold uppercase text-muted-foreground">
              {t("finance.entries.detail.sourceReference")}
            </dt>
            <dd className="mt-1 font-mono text-sm">{entry.sourceReference}</dd>
          </div>
        )}
        {entry.rejectedReason && (
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold uppercase text-muted-foreground">
              {t("finance.entries.detail.rejectedReason")}
            </dt>
            <dd className="mt-1">{entry.rejectedReason}</dd>
          </div>
        )}
      </dl>
      <EntryPostings entry={entry} />
      {/* A reversal carries no receipt of its own; the original does. */}
      {entry.reversesEntryId === null && <EntryReceipt entry={entry} />}
      <div>
        <RecordHistorySheet entityType="financial_entry" entityId={entry.id} />
      </div>
    </div>
  );
}

function EntryPostings({ entry }: { entry: FinancialEntryDetail }) {
  const { t } = useTranslation();
  if (entry.postings.length === 0) return null;
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
        {t("finance.entries.detail.postings")}
      </h3>
      <ul className="divide-y rounded-lg border">
        {entry.postings.map((posting) => (
          <li key={posting.lineNo} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <div className="flex min-w-0 flex-col">
              <span className="font-medium">{localizedLabel(posting.category)}</span>
              {posting.assetCode && (
                <span className="text-xs text-muted-foreground">{posting.assetCode}</span>
              )}
            </div>
            <span className="font-mono font-semibold whitespace-nowrap">
              {formatMoney(posting.amountMinor, {
                currency: entry.currency,
                signDisplay: "always",
              })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function EntryReceipt({ entry }: { entry: FinancialEntryDetail }) {
  const { t } = useTranslation();
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">
          {t("finance.entries.detail.receipt")}
        </h3>
        <span className="text-xs text-muted-foreground">
          {t(`finance.entries.detail.evidence.${entry.evidence.state}`)}
        </span>
      </div>
      {entry.evidenceFiles.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("finance.entries.detail.noReceiptFile")}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {entry.evidenceFiles.map((file) => (
            <ReceiptFileRow key={file.artifactId} entryId={entry.id} file={file} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** A receipt opens through the entry-scoped route, never the workspace-wide one. */
function ReceiptFileRow({ entryId, file }: { entryId: string; file: EntryEvidenceFile }) {
  const { t, i18n } = useTranslation();
  return (
    <RecordFileRow
      name={file.originalFileName ?? file.mimeType}
      meta={t(`finance.entries.detail.evidenceVia.${file.via}`, {
        date: formatDateTime(file.attachedAt, i18n.language),
        name: file.attachedBy.displayName ?? t("history.actor.unknown"),
      })}
      downloadPath={`/v1/finance/entries/${entryId}/evidence/${file.artifactId}/download-url`}
    />
  );
}
