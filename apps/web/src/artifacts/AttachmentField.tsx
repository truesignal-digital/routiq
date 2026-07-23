import { useRef, useState } from "react";
import { Paperclip, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { sessionStore } from "../auth/store.js";
import { errorMessage } from "../lib/error-message.js";
import { downscaleImage, uploadArtifact } from "./upload.js";

interface Attachment {
  artifactId: string;
  name: string;
  state:
    | { kind: "uploading" }
    | { kind: "finalized"; sha256: string }
    | { kind: "failed"; code: string };
  blob: Blob;
}

export function AttachmentField({
  onChange,
  uploadImpl = uploadArtifact,
}: {
  /** Called with the ids of every FINALIZED artifact, in pick order. */
  onChange: (artifactIds: string[]) => void;
  uploadImpl?: typeof uploadArtifact;
}) {
  const { t, i18n } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  function publish(next: Attachment[]) {
    setAttachments(next);
    onChange(
      next.filter((a) => a.state.kind === "finalized").map((a) => a.artifactId),
    );
  }

  function update(artifactId: string, state: Attachment["state"]) {
    setAttachments((current) => {
      const next = current.map((a) => (a.artifactId === artifactId ? { ...a, state } : a));
      onChange(
        next.filter((a) => a.state.kind === "finalized").map((a) => a.artifactId),
      );
      return next;
    });
  }

  async function startUpload(attachment: Attachment) {
    const token = sessionStore.getToken();
    if (token === undefined) {
      update(attachment.artifactId, { kind: "failed", code: "AUTH_REQUIRED" });
      return;
    }
    const result = await uploadImpl(attachment.artifactId, attachment.blob, attachment.name, token);
    if (result.ok) {
      update(attachment.artifactId, { kind: "finalized", sha256: result.artifact.sha256 });
    } else {
      update(attachment.artifactId, { kind: "failed", code: result.code });
    }
  }

  async function onPick(files: FileList | null) {
    if (files === null) return;
    for (const file of Array.from(files)) {
      const blob = await downscaleImage(file);
      const attachment: Attachment = {
        artifactId: crypto.randomUUID(),
        name: file.name,
        state: { kind: "uploading" },
        blob,
      };
      publish([...attachments, attachment]);
      void startUpload(attachment);
    }
    if (inputRef.current) inputRef.current.value = "";
  }

  function onRemove(artifactId: string) {
    publish(attachments.filter((a) => a.artifactId !== artifactId));
  }

  function onRetry(attachment: Attachment) {
    update(attachment.artifactId, { kind: "uploading" });
    void startUpload(attachment);
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,application/pdf"
        capture="environment"
        multiple
        className="hidden"
        data-testid="attachment-input"
        onChange={(e) => void onPick(e.target.files)}
      />
      <Button
        type="button"
        variant="outline"
        className="min-h-11 justify-start gap-2"
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip className="size-4" aria-hidden />
        {t("attachments.add")}
      </Button>

      {attachments.map((a) => (
        <div
          key={a.artifactId}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs"
        >
          <span className="min-w-0 flex-1 truncate">{a.name}</span>
          {a.state.kind === "uploading" ? (
            <span className="text-muted-foreground">{t("attachments.uploading")}</span>
          ) : a.state.kind === "finalized" ? (
            <span className="font-mono text-muted-foreground" title={a.state.sha256}>
              ✓ {a.state.sha256.slice(0, 8)}
            </span>
          ) : (
            <>
              <span role="alert" className="text-destructive">
                {errorMessage(i18n, a.state.code)}
              </span>
              <button
                type="button"
                aria-label={t("attachments.retry")}
                className="text-foreground"
                onClick={() => onRetry(a)}
              >
                <RefreshCw className="size-4" aria-hidden />
              </button>
            </>
          )}
          <button
            type="button"
            aria-label={t("attachments.remove")}
            className="text-muted-foreground"
            onClick={() => onRemove(a.artifactId)}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
