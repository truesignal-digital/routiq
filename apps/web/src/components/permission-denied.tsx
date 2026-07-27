import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { EmptyState, PageHeader } from "@/components/page";
import { PageContainer, type PageContainerProps } from "@/components/page-container";
import { errorMessage } from "@/lib/error-message.js";

export interface PermissionDeniedProps {
  title: ReactNode;
  icon: ReactNode;
  /** A stable error code — `errors.*` owns the wording, never the screen. */
  code: string;
  width?: PageContainerProps["width"];
}

/**
 * The one shape a screen shows a user it cannot serve. Callers gate it on
 * `me !== undefined` so a still-loading session never flashes a denial at
 * someone who does have access.
 */
export function PermissionDenied({
  title,
  icon,
  code,
  width,
}: PermissionDeniedProps) {
  const { i18n } = useTranslation();

  return (
    <PageContainer {...(width === undefined ? {} : { width })}>
      <PageHeader title={title} />
      <EmptyState className="mt-6" icon={icon} message={errorMessage(i18n, code)} />
    </PageContainer>
  );
}

/**
 * Distinguishes a module the workspace never bought from a role that may not
 * act — the same blank screen otherwise, but a different thing to do about it.
 */
export function deniedCode(moduleEnabled: boolean): string {
  return moduleEnabled ? "ROLE_FORBIDDEN" : "MODULE_DISABLED";
}
