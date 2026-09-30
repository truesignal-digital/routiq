import type { TFunction } from "i18next";
import type { AssetAttentionItem } from "@routiq/contracts";
import { formatDate, formatMoney, localizedLabel } from "@/lib/format.js";
import { recordReference } from "./model.js";

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
  const ref = item.subject.number ?? recordReference(item.subject.id);
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
    reason: p.completionRejectReason ?? "",
    override: p.overrideRequired === true ? "yes" : "no",
    name: recorder,
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
          : "detail";
  return { title: t(`${key}.title`, values), detail: t(`${key}.${detail}`, values) };
}
