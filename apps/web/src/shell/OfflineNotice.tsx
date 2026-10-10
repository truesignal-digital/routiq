import { WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOnline } from "@/lib/online";

/**
 * Under the site header while the device has no connection (#576), and held
 * under it on scroll like the header (h-14). The live region stays mounted so
 * the change is announced, not just drawn.
 */
export function OfflineNotice() {
  const online = useOnline();
  const { t } = useTranslation();
  return (
    <div role="status" aria-live="polite" className="sticky top-14 z-10">
      {!online && (
        <p className="flex items-center gap-2 border-b bg-muted px-4 py-2 text-sm text-muted-foreground">
          <WifiOff className="size-4 shrink-0" aria-hidden />
          <span>{t("shell.offline.banner")}</span>
        </p>
      )}
    </div>
  );
}
