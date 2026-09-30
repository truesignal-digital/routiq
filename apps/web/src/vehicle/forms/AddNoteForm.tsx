import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { NOTE_BODY_MAX, type AddNotePayload } from "@routiq/contracts";
import {
  CommandForm,
  useCommandSubmission,
  type CommandFormBack,
  type CommandSurface,
} from "@/components/command-form.js";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PinnedAssetField } from "../../assets/PinnedAssetField.js";
import { commandClient, type CommandClient } from "../../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../../commands/intent.js";
import { notifyCommandSuccess } from "../../lib/notify.js";

export interface AddNoteFormProps {
  surface: CommandSurface;
  assetId: string;
  assetLabel?: string | undefined;
  client?: CommandClient | undefined;
  back?: CommandFormBack | undefined;
  /** After the note committed; the host refreshes what it shows. */
  onDone?: (() => void) | undefined;
  onDismiss: () => void;
}

/**
 * A remark on the vehicle's history. Notes are append-only: a correction is
 * another note, so the form says so rather than offering an edit later.
 */
export function AddNoteForm({
  surface,
  assetId,
  assetLabel,
  client = commandClient,
  back,
  onDone,
  onDismiss,
}: AddNoteFormProps) {
  const { t } = useTranslation();
  const submission = useCommandSubmission();
  // Minted once per opening, so a retry replays this note instead of adding a second.
  const noteId = useRef(crypto.randomUUID());
  const intent = useRef<CommandIntent<AddNotePayload> | undefined>(undefined);
  const [body, setBody] = useState("");
  const trimmed = body.trim();
  const ready = trimmed !== "" && trimmed.length <= NOTE_BODY_MAX;

  async function submit() {
    if (!ready) return;
    const result = await submission.run(() => {
      intent.current ??= createCommandIntent<AddNotePayload>(client, "add-note", 1);
      return intent.current.submit({
        noteId: noteId.current,
        entityType: "asset",
        entityId: assetId,
        body: trimmed,
      });
    });
    if (!result.ok) return;
    notifyCommandSuccess("vehicle", "noteAdded", result.outcome.warnings);
    onDone?.();
    onDismiss();
  }

  return (
    <CommandForm
      surface={surface}
      title={t("vehicle.forms.note.title")}
      description={t("vehicle.forms.note.description")}
      back={back}
      error={submission.error}
      informativeCodes={["ASSET_NOT_OPERATIONAL"]}
      submitLabel={t("vehicle.forms.note.submit")}
      ready={ready}
      submitting={submission.submitting}
      onSubmit={() => void submit()}
      onDismiss={onDismiss}
    >
      <PinnedAssetField assetId={assetId} label={assetLabel} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="vehicle-note-body">{t("vehicle.forms.note.label")}</Label>
        <Textarea
          id="vehicle-note-body"
          rows={4}
          maxLength={NOTE_BODY_MAX}
          placeholder={t("vehicle.forms.note.placeholder")}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </div>
    </CommandForm>
  );
}
