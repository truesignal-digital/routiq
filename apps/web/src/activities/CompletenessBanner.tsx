import type { ActivityCompletenessCode } from "@routiq/contracts";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { StatusBadge } from "@/components/status-badge.js";

export interface CompletenessBannerProps {
  completeness: "COMPLETE" | "COMPLETE_WITH_EXCEPTIONS" | null;
  codes: readonly ActivityCompletenessCode[];
}

/**
 * The screen's whole reason for existing. §3.4 invariant 6 lets a job close with
 * gaps rather than forcing a clerk to invent a number, so the record has to say
 * out loud what it is missing — a figure that silently omits its own caveats is
 * exactly the untrustworthiness the platform exists to fix (§9: reports never
 * invent missing values).
 */
export function CompletenessBanner({ completeness, codes }: CompletenessBannerProps) {
  const { t } = useTranslation();

  if (completeness === null) return null;

  if (completeness === "COMPLETE") {
    return (
      <Alert>
        <AlertTitle>{t("activities.completeness.COMPLETE")}</AlertTitle>
        <AlertDescription>{t("activities.completeness.completeHint")}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert variant="destructive">
      <AlertTitle>{t("activities.completeness.COMPLETE_WITH_EXCEPTIONS")}</AlertTitle>
      <AlertDescription>
        <p>{t("activities.completeness.exceptionsHint")}</p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {codes.map((code) => (
            <li key={code}>
              <StatusBadge tone="warning">{t(`warnings.${code}`)}</StatusBadge>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
