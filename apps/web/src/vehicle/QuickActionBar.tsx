import { useTranslation } from "react-i18next";
import { LayoutGrid } from "lucide-react";
import { usePanelOpen } from "../shell/panel-open.js";
import { actionDef, quickActions } from "./actions.js";
import { useVehicle } from "./context.js";
import { useStepLabel } from "./parts.js";

/**
 * The phone's three most frequent actions for this role, then More. A toolbar,
 * not navigation: it sits above the shell's bottom bar and only acts. Both
 * step aside while a panel is open.
 */
export function QuickActionBar() {
  const { t } = useTranslation();
  const stepLabel = useStepLabel();
  const { viewer, facts, runAction, openAllActions } = useVehicle();
  const keys = quickActions(facts, viewer);
  const panelOpen = usePanelOpen();

  if (panelOpen) return null;

  return (
    <div
      role="toolbar"
      aria-label={t("vehicle.bar.label")}
      className="fixed inset-x-3 bottom-[calc(var(--bottom-bar,0px)+0.5rem)] z-40 grid grid-cols-4 gap-1 rounded-xl border bg-background/95 p-1 shadow-lg backdrop-blur supports-backdrop-filter:bg-background/85 md:hidden"
    >
      {keys.map((key) => {
        const Icon = actionDef(key).icon;
        return (
          <button
            key={key}
            type="button"
            onClick={() => runAction(key)}
            className="flex h-14 flex-col items-center justify-center gap-1 rounded-lg text-xs font-medium transition-colors hover:bg-muted active:bg-muted"
          >
            <Icon className="size-5" aria-hidden />
            {stepLabel({ key }, "short")}
          </button>
        );
      })}
      <button
        type="button"
        onClick={openAllActions}
        className="col-start-4 flex h-14 flex-col items-center justify-center gap-1 rounded-lg text-xs font-medium text-muted-foreground transition-colors hover:bg-muted active:bg-muted"
      >
        <LayoutGrid className="size-5" aria-hidden />
        {t("vehicle.bar.more")}
      </button>
    </div>
  );
}
