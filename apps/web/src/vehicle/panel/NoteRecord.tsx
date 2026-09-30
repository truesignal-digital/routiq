import { useTranslation } from "react-i18next";
import { formatDateTime } from "@/lib/format.js";
import { DetailHeader, Note } from "../parts.js";
import { useNote } from "../useVehicle.js";
import { PanelLoading, PanelMissing } from "./shared.js";

/** A note never changes, so its record is the text, who wrote it and when. */
export function NoteRecord({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const query = useNote(id);

  if (query.isPending) return <PanelLoading />;
  if (query.isError || query.data === undefined || query.data === null) {
    return <PanelMissing onRetry={() => void query.refetch()} />;
  }
  const note = query.data;

  return (
    <>
      <DetailHeader
        eyebrow={t("vehicle.panel.noteEyebrow")}
        title={t("vehicle.panel.noteBy", {
          name: note.actor.displayName ?? t("history.actor.unknown"),
        })}
        description={formatDateTime(note.occurredAt, i18n.language)}
      />
      <div className="space-y-4 p-4">
        <p className="text-sm whitespace-pre-line">{note.body}</p>
        <Note>{t("vehicle.panel.noteAppendOnly")}</Note>
      </div>
    </>
  );
}
