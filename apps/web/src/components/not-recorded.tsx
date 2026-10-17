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
          // Padding grows the box past the text (44 px on a phone, 24 with a
          // mouse, #23) and the negative margins take it back, so the row
          // keeps its height and the word keeps its 8 px gap.
          className="-my-3 -mr-3 ml-[-0.25rem] inline-flex min-h-11 items-center px-3 font-medium text-primary underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none desktop:-my-0.5 desktop:min-h-6"
        >
          {t("common.add")}
        </button>
      )}
    </span>
  );
}
