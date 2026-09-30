import { toast } from "@/components/ui/toast.js";
import { i18n } from "../i18n/index.js";

/**
 * Which domain's strings a notification reads. Success titles are
 * domain-specific, so each namespace owns its own; warning and error codes are
 * shared vocabulary and fall back to the root `notify.*` block.
 */
export type NotifyNamespace =
  | "activities"
  | "assets"
  | "documents"
  | "finance"
  | "maintenance"
  | "vehicle";

type NotifyKind = "success" | "info" | "warnings" | "errors";

function localizedNotifyMessage(
  namespace: NotifyNamespace,
  kind: NotifyKind,
  key: string,
): string {
  const scoped = `${namespace}.notify.${kind}.${key}`;
  if (i18n.exists(scoped)) return i18n.t(scoped);

  const shared = `notify.${kind}.${key}`;
  if (i18n.exists(shared)) return i18n.t(shared);

  // The shared code catalogs (`warnings.*`, `errors.*`) are where a code's
  // wording lives when no domain overrides it.
  const catalog = `${kind}.${key}`;
  if ((kind === "warnings" || kind === "errors") && i18n.exists(catalog)) return i18n.t(catalog);

  console.warn(`[notify] no translation for ${scoped}`);
  const scopedGeneric = `${namespace}.notify.${kind}.generic`;
  const genericKey = i18n.exists(scopedGeneric)
    ? scopedGeneric
    : `notify.${kind}.generic`;
  return i18n.t(genericKey, { code: key });
}

/** One line per distinct warning code, or nothing when there are none. */
function warningLines(
  namespace: NotifyNamespace,
  warnings: readonly string[],
): string | undefined {
  const codes = [...new Set(warnings)];
  if (codes.length === 0) return undefined;
  return codes
    .map((code) => localizedNotifyMessage(namespace, "warnings", code))
    .join("\n");
}

export interface NotifySuccessOptions {
  /**
   * What only the caller knows, under the warnings — a composite command's
   * count of embedded records left waiting for an approver, say.
   */
  extraLines?: readonly string[];
  /** One follow-up the toast offers, already localized. */
  action?: { label: string; onClick: () => void };
}

function addSuccessToast(
  title: string,
  lines: readonly (string | undefined)[],
  action: NotifySuccessOptions["action"],
): void {
  const description = lines
    .filter((line): line is string => line !== undefined && line !== "")
    .join("\n");
  toast.add({
    type: "success",
    title,
    ...(description === "" ? {} : { description }),
    ...(action === undefined
      ? {}
      : { actionProps: { children: action.label, onClick: action.onClick } }),
  });
}

/**
 * The single success surface for a committed command. Warnings ride in the same
 * toast rather than stacking their own, so one action produces one notification.
 */
export function notifyCommandSuccess(
  namespace: NotifyNamespace,
  messageKey: string,
  warnings: readonly string[] = [],
  options: NotifySuccessOptions = {},
): void {
  addSuccessToast(
    localizedNotifyMessage(namespace, "success", messageKey),
    [warningLines(namespace, warnings), ...(options.extraLines ?? [])],
    options.action,
  );
}

export function notifyCommandError(
  namespace: NotifyNamespace,
  code: string,
): void {
  toast.add({
    type: "error",
    priority: "high",
    title: localizedNotifyMessage(namespace, "errors", code),
  });
}

/**
 * A note about a command the user asked for but that did not need sending —
 * "nothing to save" — so it reads as information, not as an error.
 */
export function notifyInfo(namespace: NotifyNamespace, messageKey: string): void {
  toast.add({
    type: "info",
    title: localizedNotifyMessage(namespace, "info", messageKey),
  });
}
