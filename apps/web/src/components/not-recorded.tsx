import { useTranslation } from "react-i18next";

import { notRecorded } from "@/lib/format.js";
import { cn } from "@/lib/utils.js";

/**
 * A value nobody recorded, said in words ("Non renseigné" / "Not recorded"),
 * never a bare dash (#306, guard `no-bare-dash`). Pass `onAdd` only when the
 * viewer may fill the value: it adds an inline "Add" that opens the edit.
 */
export function NotRecorded({ onAdd, className }: { onAdd?: (() => void) | undefined; className?: string }) {
  const { t, i18n } = useTranslation();
  return (
    <span
      data-slot="not-recorded"
      // Words, not a figure: the sans face even inside a monospace code cell.
      className={cn("font-sans font-normal text-muted-foreground", className)}
    >
      {notRecorded(i18n.language)}
      {onAdd !== undefined && (
        <button
          type="button"
          onClick={onAdd}
          // The hit area grows past the text so a phone thumb finds it without
          // making the row taller (44 px targets, #23).
          className="relative ml-2 font-medium text-primary underline-offset-4 after:absolute after:-inset-x-2 after:-inset-y-3 hover:underline focus-visible:underline focus-visible:outline-none"
        >
          {t("common.add")}
        </button>
      )}
    </span>
  );
}
