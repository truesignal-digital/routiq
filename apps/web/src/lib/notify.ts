import { toast } from "@/components/ui/toast.js";
import { i18n } from "../i18n/index.js";

/**
 * Which domain's strings a notification reads. Success titles are
 * domain-specific, so each namespace owns its own; warning and error codes are
 * shared vocabulary and fall back to the root `notify.*` block.
 */
export type NotifyNamespace = "activities" | "assets" | "documents" | "finance";

type NotifyKind = "success" | "warnings" | "errors";

function localizedNotifyMessage(
  namespace: NotifyNamespace,
  kind: NotifyKind,
  key: string,
): string {
  const scoped = `${namespace}.notify.${kind}.${key}`;
  if (i18n.exists(scoped)) return i18n.t(scoped);

  const shared = `notify.${kind}.${key}`;
  if (i18n.exists(shared)) return i18n.t(shared);

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
  /**
   * Replaces the domain's success title. For where a record landed rather than
   * what happened to it: the outcome is the same, the surprise is not.
   */
  title?: string;
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
    options.title ?? localizedNotifyMessage(namespace, "success", messageKey),
    [warningLines(namespace, warnings), ...(options.extraLines ?? [])],
    options.action,
  );
}

/**
 * A success the caller has already phrased — where a record landed, say, which
 * no namespace owns a code for. Same toast, no message catalogue lookup: there
 * is no key to miss, so nothing can fall back to a generic line.
 */
export function notifySuccess(
  options: NotifySuccessOptions & { title: string },
): void {
  addSuccessToast(options.title, options.extraLines ?? [], options.action);
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
