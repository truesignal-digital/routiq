import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Eye, Megaphone } from "lucide-react";
import type { AcknowledgeNotePayload } from "@routiq/contracts";
import { CommandForm, useCommandSubmission } from "@/components/command-form.js";
import { commandClient } from "@/commands/instance.js";
import { createCommandIntent, type CommandIntent } from "@/commands/intent.js";
import { useCommandLabel } from "@/commands/labels.js";
import { formatDateTime } from "@/lib/format.js";
import { notifyCommandSuccess } from "@/lib/notify.js";
import { useVehicle, type PanelForm } from "../context.js";
import type { RecordSteps } from "../flow.js";
import { DetailHeader, Note } from "../parts.js";
import { useNote } from "../useVehicle.js";
import { PanelFooter, PanelLoading, PanelMissing, useFormHost } from "./shared.js";

/**
 * A note never changes, so its record is the text, who wrote it and when. A
 * note from Direction also says who saw it, or offers "Mark as seen" to anyone
 * but its author (#98).
 */
export function NoteRecord({ id, form }: { id: string; form: PanelForm | undefined }) {
  const { t, i18n } = useTranslation();
  const { asset, viewer, panel } = useVehicle();
  const query = useNote(asset.id, id);
  const host = useFormHost(t("vehicle.panel.noteEyebrow"));

  if (query.isPending) return <PanelLoading />;
  if (query.isError || query.data === undefined) {
    return <PanelMissing onRetry={() => void query.refetch()} />;
  }
  const note = query.data;
  const fromDirection = note.authorRole === "DIRECTOR";
  const author = note.author.displayName ?? t("history.actor.unknown");
  const mayAcknowledge =
    fromDirection && note.acknowledgement === null && note.author.principalId !== viewer.principalId;

  if (form?.key === "acknowledge-note" && mayAcknowledge) {
    return (
      <AcknowledgeNoteForm
        noteId={note.id}
        body={note.body}
        back={host.back}
        onDone={host.onDone}
        onDismiss={host.onDismiss}
      />
    );
  }

  const steps: RecordSteps = {
    primary: mayAcknowledge
      ? { kind: "go", step: { key: "acknowledge-note", record: { kind: "note", id: note.id } } }
      : { kind: "none" },
    offered: mayAcknowledge
      ? [{ step: { key: "acknowledge-note", record: { kind: "note", id: note.id } } }]
      : [],
  };

  return (
    <>
      <DetailHeader
        eyebrow={fromDirection ? t("vehicle.panel.directionNoteEyebrow") : t("vehicle.panel.noteEyebrow")}
        title={t("vehicle.panel.noteBy", { name: author })}
        description={formatDateTime(note.createdAt, i18n.language)}
      />
      <div className="space-y-4 p-4">
        <p className="text-sm whitespace-pre-line">{note.body}</p>
        {fromDirection && (
          <p className="flex items-start gap-2 text-sm">
            {note.acknowledgement === null ? (
              <>
                <Megaphone className="mt-0.5 size-4 shrink-0 text-info-foreground" aria-hidden />
                <span className="text-muted-foreground">{t("vehicle.panel.notSeenYet")}</span>
              </>
            ) : (
              <>
                <Eye className="mt-0.5 size-4 shrink-0 text-success-foreground" aria-hidden />
                <span>
                  {t("vehicle.panel.seenBy", {
                    name: note.acknowledgement.by.displayName ?? t("history.actor.unknown"),
                    date: formatDateTime(note.acknowledgement.at, i18n.language),
                  })}
                </span>
              </>
            )}
          </p>
        )}
        <Note>{t("vehicle.panel.noteAppendOnly")}</Note>
      </div>
      <PanelFooter steps={steps} onStep={panel.openStep} />
    </>
  );
}

function AcknowledgeNoteForm({
  noteId,
  body,
  back,
  onDone,
  onDismiss,
}: {
  noteId: string;
  body: string;
  back: ReturnType<typeof useFormHost>["back"];
  onDone: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const submission = useCommandSubmission();
  const intent = useRef<CommandIntent<AcknowledgeNotePayload> | undefined>(undefined);

  async function submit() {
    const result = await submission.run(() => {
      intent.current ??= createCommandIntent<AcknowledgeNotePayload>(commandClient, "acknowledge-note", 1);
      return intent.current.submit({ noteId });
    });
    if (!result.ok) return;
    notifyCommandSuccess("vehicle", "noteAcknowledged", result.outcome.warnings);
    onDone();
    onDismiss();
  }

  return (
    <CommandForm
      surface="panel"
      back={back}
      onDismiss={onDismiss}
      title={label("acknowledge-note")}
      description={t("vehicle.panel.acknowledgeHint")}
      error={submission.error}
      command="acknowledge-note"
      ready
      submitting={submission.submitting}
      onSubmit={() => void submit()}
    >
      <p className="text-sm whitespace-pre-line text-muted-foreground">{body}</p>
    </CommandForm>
  );
}
