import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Ban, FileWarning, Hourglass, Undo2 } from "lucide-react";
import type { FinancialEntryDetail } from "@routiq/contracts";
import { ContextBox, ContextRow, Fact, FactsSection } from "@/components/record-page.js";
import type { StatusBlockProps } from "@/components/status-block.js";
import { EntryLinks, visibleEntryLinks } from "@/finance/EntryLinks.js";
import { EntryPostings, EntryReceipt } from "@/finance/EntrySummary.js";
import { ReversalLink } from "@/finance/ReversalLink.js";
import { amountKind, cancellationReasonWords } from "@/finance/model.js";
import { useMeContext } from "@/auth/me.js";
import { formatDate, formatMoney, formatPaymentMethod, localizedLabel } from "@/lib/format.js";

export const ENTRY_TABS = ["overview", "receipt", "history"] as const;
export type EntryTab = (typeof ENTRY_TABS)[number];

/** The trucks the entry's lines are booked on, each once, in line order. */
export function entryAssets(entry: Pick<FinancialEntryDetail, "postings">): { id: string; code: string }[] {
  const seen = new Set<string>();
  return entry.postings.flatMap((posting) => {
    if (posting.assetId === null || posting.assetCode === null || seen.has(posting.assetId)) return [];
    seen.add(posting.assetId);
    return [{ id: posting.assetId, code: posting.assetCode }];
  });
}

/** What the entry page lets this viewer do, worked out once by the screen. */
export interface EntryAbilities {
  /** Approve and Reject: an approver on someone else's entry, inside their band. */
  decide: boolean;
  /** An approver kept from deciding by their band: the Director decides. */
  aboveBand: boolean;
  /** Attach a receipt (the receipt is missing and the viewer may attach it). */
  attach: boolean;
  /** Edit the pending entry (its author, one line). */
  edit: boolean;
}

/**
 * The status block's sentence for an entry, when something waits or blocks:
 * waiting for approval, rejected, cancelled, a cancellation, a missing
 * receipt. Nothing for a posted entry with its paperwork in order.
 */
export function useEntryStatus(
  entry: FinancialEntryDetail,
  can: EntryAbilities,
  actions: { decision: ReactNode; attach: ReactNode },
): Omit<StatusBlockProps, "phoneAction"> | undefined {
  const { t } = useTranslation();
  const recorder = entry.recordedBy.displayName ?? t("history.actor.unknown");

  if (entry.status === "SUBMITTED") {
    return {
      tone: "waiting",
      icon: Hourglass,
      lead: t(can.decide ? "finance.entries.detail.statusBlock.waitingYou" : "finance.entries.detail.statusBlock.waiting"),
      follow: can.aboveBand
        ? t("finance.entries.detail.directionDecides")
        : t("finance.entries.detail.statusBlock.waitingFollow", { approver: entry.approver ?? "FINANCE" }),
      action: can.decide ? actions.decision : undefined,
    };
  }

  if (entry.status === "REJECTED") {
    return {
      tone: "critical",
      icon: Ban,
      lead: t("finance.entries.detail.statusBlock.rejected"),
      follow:
        entry.rejectedReason === null
          ? t("finance.entries.detail.statusBlock.rejectedFollow")
          : t("finance.entries.detail.statusBlock.rejectedReason", { reason: entry.rejectedReason }),
    };
  }

  const reason =
    entry.cancellation === null
      ? null
      : t("finance.entries.detail.statusBlock.cancelledReason", {
          reason: cancellationReasonWords(entry.cancellation, t),
        });

  if (entry.reversesEntryId !== null) {
    return {
      tone: "neutral",
      icon: Undo2,
      lead: t("finance.entries.detail.statusBlock.cancellation"),
      follow: reason,
      notes: [
        {
          key: "reverses",
          icon: Undo2,
          body: <ReversalLink entryId={entry.reversesEntryId} type="reverses" />,
        },
      ],
    };
  }

  if (entry.status === "REVERSED" || entry.reversedByEntryId !== null) {
    return {
      tone: "neutral",
      icon: Undo2,
      lead: t("finance.entries.detail.statusBlock.cancelled"),
      follow: reason,
      ...(entry.reversedByEntryId === null
        ? {}
        : {
            notes: [
              {
                key: "reversedBy",
                icon: Undo2,
                body: <ReversalLink entryId={entry.reversedByEntryId} type="reversedBy" />,
              },
            ],
          }),
    };
  }

  if (entry.evidence.state === "NOT_SUPPLIED") {
    return {
      tone: "waiting",
      icon: FileWarning,
      lead: t("finance.entries.detail.statusBlock.noReceipt"),
      follow: t("finance.entries.detail.statusBlock.noReceiptFollow", { name: recorder }),
      action: can.attach ? actions.attach : undefined,
    };
  }

  return undefined;
}

/**
 * The entry's Overview: its facts in the groups of the form that recorded it.
 * A value nobody recorded reads "Not recorded", with "Add" for its author
 * while it waits (the only time it may still change in place, ADR-0008).
 */
export function EntryOverview({
  entry,
  can,
  onEdit,
  onAttach,
}: {
  entry: FinancialEntryDetail;
  can: EntryAbilities;
  onEdit: () => void;
  onAttach: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const addable = can.edit ? onEdit : undefined;
  const assets = entryAssets(entry);

  return (
    <div className="flex flex-col gap-5">
      <FactsSection title={t("finance.entries.detail.sections.what")}>
        <Fact label={t("finance.entries.detail.category")} value={localizedLabel(entry.category, locale)} />
        <Fact label={t("finance.entries.detail.date")} value={formatDate(entry.economicDate, locale)} />
        <Fact label={t("finance.entries.detail.description")} value={entry.description} onAdd={addable} wide />
        <Fact
          label={t("finance.entries.detail.truck")}
          value={
            assets.length === 0 ? null : (
              <span className="flex flex-wrap gap-x-3">
                {assets.map((asset) => (
                  <Link
                    key={asset.id}
                    to="/assets/$assetId"
                    params={{ assetId: asset.id }}
                    className="tabular-nums underline decoration-foreground/25 underline-offset-[3px] hover:decoration-foreground"
                  >
                    {asset.code}
                  </Link>
                ))}
              </span>
            )
          }
          onAdd={addable}
        />
        {entry.postedAt !== null && (
          <Fact label={t("finance.entries.detail.postingDate")} value={formatDate(entry.postedAt, locale)} />
        )}
      </FactsSection>

      <FactsSection title={t("finance.entries.detail.sections.howMuch")}>
        <Fact
          label={t("finance.entries.detail.amount")}
          value={
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-base font-semibold tabular-nums">
                {formatMoney(entry.amountMinor, { currency: entry.currency, locale, sign: { context: "record" } })}
              </span>
              <span className="text-muted-foreground">
                {t("finance.entries.detail.amountKind", { kind: amountKind(entry) })}
              </span>
            </span>
          }
        />
        <Fact label={t("finance.entries.detail.paymentMethod")} value={formatPaymentMethod(entry.paymentMethod, t)} />
        <Fact label={t("finance.entries.detail.counterparty")} value={entry.counterpartyName} onAdd={addable} />
        <Fact
          label={t("finance.entries.detail.recordedByLabel")}
          value={entry.recordedBy.displayName ?? t("history.actor.unknown")}
        />
        <Fact
          label={t("finance.entries.detail.paymentReference")}
          value={entry.paymentReference === null ? null : <span className="tabular-nums">{entry.paymentReference}</span>}
          onAdd={addable}
        />
        {entry.sourceReference !== null && (
          <Fact
            label={t("finance.entries.detail.sourceReference")}
            value={<span className="tabular-nums">{entry.sourceReference}</span>}
          />
        )}
      </FactsSection>

      {entry.postings.length > 1 && (
        <FactsSection title={t("finance.entries.detail.postings")}>
          <div className="sm:col-span-2">
            <EntryPostings entry={entry} heading={false} />
          </div>
        </FactsSection>
      )}

      {/* A cancellation carries no receipt of its own; the original does. */}
      {entry.reversesEntryId === null && (
        <FactsSection title={t("finance.entries.detail.sections.proof")}>
          <Fact
            label={t("finance.entries.detail.receipt")}
            value={
              entry.evidence.state === "NOT_SUPPLIED"
                ? null
                : t(`finance.entries.detail.evidence.${entry.evidence.state}`)
            }
            onAdd={can.attach ? onAttach : undefined}
          />
          <Fact
            label={t("finance.entries.detail.files")}
            value={t("finance.entries.detail.fileCount", { count: entry.evidenceFiles.length })}
          />
        </FactsSection>
      )}
    </div>
  );
}

/** The Receipt tab: the files behind the entry, each opened through the entry. */
export function EntryReceiptTab({ entry }: { entry: FinancialEntryDetail }) {
  const { t } = useTranslation();
  if (entry.reversesEntryId !== null) {
    return <p className="text-sm text-muted-foreground">{t("finance.entries.detail.cancellationNoReceipt")}</p>;
  }
  return <EntryReceipt entry={entry} />;
}

/** The context column's money box: the amount and what it counts toward. */
export function EntryMoneyBox({ entry }: { entry: FinancialEntryDetail }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  return (
    <ContextBox title={t("finance.entries.detail.amount")}>
      <p className="mb-2 text-2xl font-semibold tracking-tight tabular-nums">
        {formatMoney(entry.amountMinor, { currency: entry.currency, locale, sign: { context: "record" } })}
      </p>
      <dl>
        <ContextRow
          label={t("finance.entries.detail.kind")}
          value={t("finance.entries.detail.amountKind", { kind: amountKind(entry) })}
        />
        <ContextRow
          label={t("finance.entries.detail.counted")}
          value={t("finance.entries.detail.countedWhen", { status: entry.status })}
        />
        <ContextRow
          label={t("finance.entries.detail.month")}
          value={entry.postingPeriodCode ?? t("finance.entries.detail.notPosted")}
        />
      </dl>
    </ContextBox>
  );
}

/** The records the entry belongs to: its trucks, its trip, its work order. */
export function EntryLinked({ entry }: { entry: FinancialEntryDetail }) {
  const { t } = useTranslation();
  const me = useMeContext();
  const assets = entryAssets(entry);
  const links = visibleEntryLinks(entry.links, me?.enabledModules);
  const none = assets.length === 0 && !links.trip && !links.workOrder;

  return (
    <ContextBox title={t("record.linked")}>
      {none ? (
        <p className="text-muted-foreground">{t("finance.entries.detail.notLinked")}</p>
      ) : (
        <div className="flex flex-col gap-1">
          {assets.map((asset) => (
            <Link
              key={asset.id}
              to="/assets/$assetId"
              params={{ assetId: asset.id }}
              className="inline-flex min-h-11 items-center tabular-nums underline decoration-foreground/25 underline-offset-[3px] hover:decoration-foreground"
            >
              {asset.code}
            </Link>
          ))}
          <EntryLinks links={entry.links} />
        </div>
      )}
    </ContextBox>
  );
}
