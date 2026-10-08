import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useCommandLabel } from "@/commands/labels.js";
import type { AttachEvidencePayload } from "@routiq/contracts";
import {
  CommandForm,
  PinnedField,
  useCommandSubmission,
  type CommandFormBack,
  type CommandSurface,
} from "@/components/command-form.js";
import { FileUpload } from "@/components/ui/file-upload";
import { useActiveSession } from "../auth/store.js";
import { commandClient, type CommandClient } from "../commands/instance.js";
import { createCommandIntent, type CommandIntent } from "../commands/intent.js";
import { notifyCommandSuccess } from "../lib/notify.js";

export interface AttachEvidenceFormProps {
  surface: CommandSurface;
  entry: { id: string; entryNumber: string };
  client?: CommandClient | undefined;
  back?: CommandFormBack | undefined;
  /** After the files were linked and the entry reads refreshed. */
  onDone?: (() => void) | undefined;
  onDismiss: () => void;
}

/**
 * Links a receipt to an entry that was recorded without one. The entry is not
 * edited — its amount, status and version stay — so the form quotes no version;
 * the attachment is its own audited record.
 */
export function AttachEvidenceForm({
  surface,
  entry,
  client = commandClient,
  back,
  onDone,
  onDismiss,
}: AttachEvidenceFormProps) {
  const { t } = useTranslation();
  const label = useCommandLabel();
  const queryClient = useQueryClient();
  const session = useActiveSession();
  const submission = useCommandSubmission();
  const intent = useRef<CommandIntent<AttachEvidencePayload> | undefined>(undefined);
  const [artifactIds, setArtifactIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const ready = artifactIds.length > 0 && !uploading;

  async function submit() {
    if (!ready) return;
    const result = await submission.run(() => {
      intent.current ??= createCommandIntent<AttachEvidencePayload>(client, "attach-evidence", 1);
      // The payload names the same files the envelope links (the contract's rule).
      return intent.current.submit(
        { entryId: entry.id, artifactIds },
        { sourceArtifactIds: artifactIds },
      );
    });
    if (!result.ok) return;
    notifyCommandSuccess("vehicle", "evidenceAttached", result.outcome.warnings);
    await queryClient.invalidateQueries({ queryKey: ["ws", session?.workspaceSlug, "finance"] });
    onDone?.();
    onDismiss();
  }

  return (
    <CommandForm
      surface={surface}
      title={label("attach-evidence")}
      description={t("vehicle.forms.evidence.description")}
      back={back}
      error={submission.error}
      command="attach-evidence"
      ready={ready}
      submitting={submission.submitting}
      onSubmit={() => void submit()}
      onDismiss={onDismiss}
    >
      <PinnedField label={t("vehicle.forms.evidence.entry")}>{entry.entryNumber}</PinnedField>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">{t("vehicle.forms.evidence.files")}</span>
        <FileUpload
          accept="image/*,application/pdf"
          onChange={setArtifactIds}
          onUploadingChange={setUploading}
        />
        <p className="text-xs text-muted-foreground">{t("vehicle.forms.evidence.hint")}</p>
      </div>
    </CommandForm>
  );
}
