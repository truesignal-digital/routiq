import { toast } from "sonner";
import { i18n } from "../i18n/index.js";

function localizedNotifyMessage(
  key: string,
  fallbackKey: string,
  code: string,
): string {
  if (i18n.exists(key)) return i18n.t(key);

  console.warn(`[finance.notify] no translation for ${code}`);
  return i18n.t(fallbackKey, { code });
}

export function notifyCommandSuccess(messageKey: string): void {
  toast.success(
    localizedNotifyMessage(
      `finance.notify.success.${messageKey}`,
      "finance.notify.success.generic",
      messageKey,
    ),
  );
}

export function notifyCommandWarnings(warnings: string[]): void {
  for (const code of new Set(warnings)) {
    toast.warning(
      localizedNotifyMessage(
        `finance.notify.warnings.${code}`,
        "finance.notify.warnings.generic",
        code,
      ),
    );
  }
}

export function notifyCommandError(code: string): void {
  toast.error(
    localizedNotifyMessage(
      `finance.notify.errors.${code}`,
      "finance.notify.errors.generic",
      code,
    ),
  );
}
