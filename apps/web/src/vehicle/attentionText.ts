import type { TFunction } from "i18next";
import type { AssetAttentionItem } from "@routiq/contracts";
import { formatDate, formatDateTime, formatMoney, localizedLabel } from "@/lib/format.js";
import { recordNumberText } from "@/lib/record-number.js";

/**
 * An attention item's title and one line of facts, in the reader's language.
 * The server sends codes and allowlisted params; every sentence is one message.
 */
export function attentionText(
  item: AssetAttentionItem,
  t: TFunction,
  locale: string,
): { title: string; detail: string } {
  const p = item.params;
  const money = (minor: number | undefined) =>
    minor === undefined ? "" : formatMoney(minor, { currency: p.currency ?? "XAF", locale });
  const { entityType } = item.subject;
  const ref =
    entityType === "work_order" || entityType === "operational_issue"
      ? recordNumberText(t, entityType === "work_order" ? "work_order" : "issue", p.recordNumber ?? null)
      : (item.subject.number ?? "");
  const recorder = p.recordedBy?.displayName ?? t("history.actor.unknown");
  const values = {
    ref,
    description: p.description ?? "",
    category: localizedLabel({ labelFr: p.categoryLabelFr ?? null, labelEn: p.categoryLabelEn ?? null }, locale),
    type: localizedLabel(
      { labelFr: p.documentTypeLabelFr ?? null, labelEn: p.documentTypeLabelEn ?? null },
      locale,
    ),
    date: p.expiresAt === undefined ? "" : formatDate(p.expiresAt, locale),
    days: p.daysLeft ?? 0,
    amount: money(p.amountMinor),
    expected: money(p.expectedCostMinor),
    actual: money(p.actualCostMinor),
    declared: money(p.declaredCostMinor),
    recorded: money(p.recordedCostMinor),
    reason: p.completionRejectReason ?? "",
    override: p.overrideRequired === true ? "yes" : "no",
    name: recorder,
    when: formatDateTime(item.since, locale),
  };
  const key = `vehicle.attention.${item.code}`;
  // Which facts exist picks the whole sentence; nothing is glued together.
  const detail =
    item.code === "WORK_ORDER_AWAITING_AUTHORIZATION" && p.expectedCostMinor !== undefined
      ? "detailWithCost"
      : item.code === "WORK_ORDER_IN_PROGRESS" && p.completionRejectReason !== undefined
        ? "detailSentBack"
        : item.code === "WORK_ORDER_AWAITING_SIGN_OFF" && p.actualCostMinor !== undefined
          ? p.expectedCostMinor !== undefined
            ? "detailCosts"
            : "detailActual"
          : item.code === "WORK_ORDER_COST_TO_COME" && p.declaredCostMinor !== undefined
            ? "detailDeclared"
            : "detail";
  return { title: t(`${key}.title`, values), detail: t(`${key}.${detail}`, values) };
}
