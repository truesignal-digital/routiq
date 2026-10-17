import type { ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useMeContext } from "@/auth/me.js";
import { PermissionDenied } from "@/components/permission-denied.js";
import { pageOwner } from "@/modules/manifest.js";
import { ScreenPending } from "./RoutePending.js";

/**
 * A module's pages open only while the module is on. A direct link to one
 * with the module off says the module is not included, and the page's code
 * and reads never run: they could only be refused. Pages no module owns pass
 * straight through.
 */
export function ModulePageGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const me = useMeContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const owner = pageOwner(pathname);
  if (owner === undefined) return children;
  if (me === undefined) return <ScreenPending />;
  if (me.enabledModules.includes(owner.code)) return children;
  const Icon = owner.row.icon;
  return (
    <PermissionDenied
      title={t(owner.row.labelKey)}
      icon={<Icon className="size-7" aria-hidden />}
      code="MODULE_DISABLED"
    />
  );
}
