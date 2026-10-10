import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ErrorState, LoadingState } from "@/components/page";
import { PageContainer } from "@/components/page-container";
import { retryFailedScreens, ScreenLoadError } from "./lazy-screen.js";

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
    <PageContainer>
      <LoadingState label={t("shell.pageLoading")} />
    </PageContainer>
  );
}

/** A vehicle section, inside the workspace's own page frame. */
export function SectionPending() {
  const { t } = useTranslation();
  return <LoadingState label={t("shell.pageLoading")} />;
}

/**
 * A screen that could not open: its code did not arrive (offline, a dropped
 * connection) or it failed while drawing. Shown in the screen's own slot, so
 * the shell stays usable; Retry fetches the code again.
 */
function useScreenError({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation();
  const router = useRouter();
  return {
    message: t(error instanceof ScreenLoadError ? "shell.screenLoadFailed" : "shell.screenFailed"),
    retryLabel: t("shell.retry"),
    onRetry: () => {
      // This page can no longer load a file it already failed on; the server answered, so a new page can.
      if (error instanceof ScreenLoadError && error.needsReload && navigator.onLine) {
        window.location.reload();
        return;
      }
      retryFailedScreens();
      reset();
      void router.invalidate();
    },
  };
}

export function ScreenError(props: ErrorComponentProps) {
  return (
    <PageContainer>
      <ErrorState {...useScreenError(props)} />
    </PageContainer>
  );
}

/** The same, inside the truck workspace's own page frame. */
export function SectionError(props: ErrorComponentProps) {
  return <ErrorState {...useScreenError(props)} />;
}
