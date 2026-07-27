import { useTranslation } from "react-i18next";
import { EmptyState, ErrorState, LoadingState } from "@/components/page";
import { FinanceStatusBadge } from "@/finance/FinanceStatusBadge.js";
import { useEntry } from "@/finance/useEntry.js";
import {
  formatDate,
  formatMoney,
  formatPaymentMethod,
  localizedLabel,
} from "@/lib/format.js";
import { FileText } from "lucide-react";

/**
 * The entry's field list, shared by the detail route and the entries table's
 * row drawer. It owns the read so either host can drop it in without threading
 * the query through; react-query dedupes the two callers onto one request.
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
  );
}
