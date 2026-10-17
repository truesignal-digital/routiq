import type { FinanceOverviewResponse } from "@routiq/contracts";
import { TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { InfoPopover } from "@/components/info-popover.js";
import { formatMoney } from "@/lib/format.js";

/** Anything the period's figures leave out: waiting entries, missing receipts, open trips, other currencies. */
export function overviewIncomplete({ notCounted }: Pick<FinanceOverviewResponse, "notCounted">): boolean {
  return (
    notCounted.waitingApproval.count > 0 ||
    notCounted.missingReceipt.count > 0 ||
    (notCounted.openTrips ?? 0) > 0 ||
    notCounted.otherCurrencyEntries > 0
  );
}

/**
 * The way into what Money's figures count. While anything is left out it is a
 * warning at rest, so missing data never passes for a complete period (§9,
 * completeness); when all is counted it is a plain question.
 */
export function CountedPopover({ overview, sentence }: { overview: FinanceOverviewResponse; sentence?: string | undefined }) {
  const { t } = useTranslation();
  const incomplete = overviewIncomplete(overview);
  return (
    <InfoPopover
      label={t(incomplete ? "finance.overview.counted.incomplete" : "finance.overview.counted.open")}
      trigger="text"
      className={incomplete ? "text-warning-foreground" : undefined}
      icon={incomplete ? <TriangleAlert className="size-4" aria-hidden /> : undefined}
    >
      {sentence !== undefined && <p className="font-medium">{sentence}</p>}
      <CountedList overview={overview} />
    </InfoPopover>
  );
}

/** What the figures are made of and what they leave out, one line each. */
function CountedList({ overview }: { overview: FinanceOverviewResponse }) {
  const { t } = useTranslation();
  const { counted, notCounted, currency } = overview;
  const lines = [
    t("finance.overview.counted.posted", { count: counted.postedEntries }),
    notCounted.waitingApproval.count > 0
      ? t("finance.overview.counted.waiting", {
          count: notCounted.waitingApproval.count,
          amount: formatMoney(notCounted.waitingApproval.amountMinor, { currency }),
        })
      : null,
    notCounted.missingReceipt.count > 0
      ? t("finance.overview.counted.missingReceipt", { count: notCounted.missingReceipt.count })
      : null,
    notCounted.openTrips !== null && notCounted.openTrips > 0
      ? t("finance.overview.counted.openTrips", { count: notCounted.openTrips })
      : null,
    notCounted.otherCurrencyEntries > 0
      ? t("finance.overview.counted.otherCurrency", { count: notCounted.otherCurrencyEntries })
      : null,
  ].filter((line): line is string => line !== null);
  return (
    <ul data-slot="money-counted" className="mt-1 flex list-disc flex-col gap-1 pl-4 text-muted-foreground">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}
