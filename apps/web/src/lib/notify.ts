import { toast } from "@/components/ui/toast.js";
import { i18n } from "../i18n/index.js";

/**
 * Which domain's strings a notification reads. Success titles are
 * domain-specific, so each namespace owns its own; warning and error codes are
 * shared vocabulary and fall back to the root `notify.*` block.
 */
export type NotifyNamespace = "assets" | "documents" | "finance";

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

/**
 * The single success surface for a committed command. Warnings ride in the same
 * toast rather than stacking their own, so one action produces one notification.
 */
export function notifyCommandSuccess(
  namespace: NotifyNamespace,
  messageKey: string,
  warnings: readonly string[] = [],
): void {
  const description = warningLines(namespace, warnings);
  toast.add({
    type: "success",
    title: localizedNotifyMessage(namespace, "success", messageKey),
    ...(description === undefined ? {} : { description }),
  });
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
