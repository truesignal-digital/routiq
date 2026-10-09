import { useTranslation } from "react-i18next";
import { LoadingState } from "@/components/page";
import { PageContainer } from "@/components/page-container";

/**
 * Shown only when a screen's code takes longer than the router's pending delay
 * (1 s) to arrive. Each one fills the slot its screen will occupy, so the shell
 * around it never moves.
 */

/** Before the shell's own code has arrived: a blank page, no partial chrome. */
export function ShellPending() {
  const { t } = useTranslation();
  return (
    <div role="status" className="min-h-svh bg-background">
      <span className="sr-only">{t("shell.pageLoading")}</span>
    </div>
  );
}

/** A screen inside the shell, in the same skeleton the screens show while their data loads. */
export function ScreenPending() {
  const { t } = useTranslation();
  return (
    <PageContainer width="wide">
      <LoadingState label={t("shell.pageLoading")} />
    </PageContainer>
  );
}

/** A vehicle section, inside the workspace's own page frame. */
export function SectionPending() {
  const { t } = useTranslation();
  return <LoadingState label={t("shell.pageLoading")} />;
}
