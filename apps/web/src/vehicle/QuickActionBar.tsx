import { useTranslation } from "react-i18next";
import { LayoutGrid } from "lucide-react";
import { actionDef, quickActions } from "./actions.js";
import { useVehicle } from "./context.js";

/**
 * The phone's three most frequent actions for this role, then More. A toolbar,
 * not navigation: the shell has no bottom nav, and this bar only acts.
 */
export function QuickActionBar() {
  const { t } = useTranslation();
  const { viewer, facts, runAction, openAllActions } = useVehicle();
  const keys = quickActions(facts, viewer);

  return (
    <div
      role="toolbar"
      aria-label={t("vehicle.bar.label")}
      className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 grid grid-cols-4 gap-1 rounded-xl border bg-background/95 p-1 shadow-lg backdrop-blur supports-backdrop-filter:bg-background/85 md:hidden"
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
            {t(`vehicle.actions.${key}.short`)}
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
