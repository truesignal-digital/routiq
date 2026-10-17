import { useEffect, useRef, useState } from "react";
import { Camera, Check, FileText, Image as ImageIcon, Upload, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { downscaleImage, uploadArtifact } from "../../artifacts/upload.js";
import { sessionStore } from "../../auth/store.js";
import { errorMessage } from "../../lib/error-message.js";
import { cn } from "../../lib/utils.js";

type UploadState =
  | { kind: "uploading" }
  | { kind: "complete" }
  | { kind: "error"; code: string };

interface UploadFile {
  artifactId: string;
  file: File;
  previewUrl?: string;
  state: UploadState;
}

export interface FileUploadProps {
  /** Receives finalized artifact UUIDs in file-selection order. */
  onChange: (artifactIds: string[]) => void;
  /** Lets an owning form prevent submission until every active upload settles. */
  onUploadingChange?: (uploading: boolean) => void;
  /** Passed directly to the native picker, including `image/*` for mobile capture. */
  accept?: string | undefined;
  /** Camera first: the main button opens a phone's camera, with choosing a file under it. */
  camera?: boolean | undefined;
  className?: string;
  uploadImpl?: typeof uploadArtifact;
}

export function FileUpload({
  onChange,
  onUploadingChange,
  accept,
  camera = false,
  className,
  uploadImpl = uploadArtifact,
}: FileUploadProps) {
  const { t, i18n } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef(new Set<string>());
  const onChangeRef = useRef(onChange);
  const onUploadingChangeRef = useRef(onUploadingChange);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [dragging, setDragging] = useState(false);

  onChangeRef.current = onChange;
  onUploadingChangeRef.current = onUploadingChange;

  useEffect(() => {
    onChangeRef.current(
      files
        .filter((item) => item.state.kind === "complete")
        .map((item) => item.artifactId),
    );
    onUploadingChangeRef.current?.(
      files.some((item) => item.state.kind === "uploading"),
    );
  }, [files]);

  useEffect(
    () => () => {
      for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
      previewUrlsRef.current.clear();
    },
    [],
  );

  function updateState(artifactId: string, state: UploadState) {
    setFiles((current) =>
      current.map((item) => (item.artifactId === artifactId ? { ...item, state } : item)),
    );
  }

  async function startUpload(item: UploadFile) {
    const token = sessionStore.getToken();
    if (token === undefined) {
      updateState(item.artifactId, { kind: "error", code: "AUTH_REQUIRED" });
      return;
    }

    try {
      let blob: Blob = item.file;
      try {
        blob = await downscaleImage(item.file);
      } catch {
        // Image optimization is best-effort; the original remains uploadable.
      }
      const result = await uploadImpl(
        item.artifactId,
        blob,
        item.file.name,
        token,
      );
      updateState(
        item.artifactId,
        result.ok
          ? { kind: "complete" }
          : { kind: "error", code: result.code },
      );
    } catch {
      updateState(item.artifactId, { kind: "error", code: "NETWORK_ERROR" });
    }
  }

  function addFiles(selected: FileList | File[]) {
    const additions = Array.from(selected).map<UploadFile>((file) => {
      let previewUrl: string | undefined;
      if (file.type.startsWith("image/") && typeof URL.createObjectURL === "function") {
        previewUrl = URL.createObjectURL(file);
        previewUrlsRef.current.add(previewUrl);
      }
      return {
        artifactId: crypto.randomUUID(),
        file,
        ...(previewUrl === undefined ? {} : { previewUrl }),
        state: { kind: "uploading" },
      };
    });

    setFiles((current) => [...current, ...additions]);
    for (const item of additions) void startUpload(item);
  }

  function removeFile(item: UploadFile) {
    if (item.previewUrl !== undefined) {
      URL.revokeObjectURL(item.previewUrl);
      previewUrlsRef.current.delete(item.previewUrl);
    }
    setFiles((current) => current.filter(({ artifactId }) => artifactId !== item.artifactId));
  }

  function formatFileSize(sizeBytes: number) {
    const [value, unitKey] =
      sizeBytes < 1_000
        ? [sizeBytes, "bytes"]
        : sizeBytes < 1_000_000
          ? [sizeBytes / 1_000, "kilobytes"]
          : [sizeBytes / 1_000_000, "megabytes"];
    const formattedValue = new Intl.NumberFormat(i18n.resolvedLanguage, {
      maximumFractionDigits: value < 10 && unitKey !== "bytes" ? 1 : 0,
    }).format(value);
    return t("fileUpload.fileSize", {
      value: formattedValue,
      unit: t(`fileUpload.units.${unitKey}`),
    });
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="sr-only"
        aria-label={t("fileUpload.dropzone")}
        onChange={(event) => {
          if (event.currentTarget.files !== null) addFiles(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
      {camera && (
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(event) => {
            if (event.currentTarget.files !== null) addFiles(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
        />
      )}
      <button
        type="button"
        className={cn(
          "group flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-5 text-center transition-colors",
          dragging
            ? "border-primary bg-primary/10 text-primary"
            : "border-border bg-muted/30 text-muted-foreground hover:border-primary/60 hover:bg-primary/[0.04]",
        )}
        onClick={() => (camera ? cameraRef : inputRef).current?.click()}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          addFiles(event.dataTransfer.files);
        }}
      >
        <span className="grid size-9 place-items-center rounded-full bg-primary/10 text-primary transition-transform group-hover:-translate-y-0.5">
          {camera ? <Camera className="size-4" aria-hidden /> : <Upload className="size-4" aria-hidden />}
        </span>
        <span className="text-sm font-medium text-foreground">
          {t(camera ? "fileUpload.takePhoto" : "fileUpload.dropzone")}
        </span>
      </button>
      {camera && (
        <button
          type="button"
          className="min-h-11 self-start rounded-md px-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
          onClick={() => inputRef.current?.click()}
        >
          {t("fileUpload.chooseFile")}
        </button>
      )}

      {files.map((item) => (
        <div
          key={item.artifactId}
          className="overflow-hidden rounded-xl border border-border bg-card"
        >
          <div className="flex items-center gap-3 p-3">
            <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted text-muted-foreground">
              {item.previewUrl !== undefined ? (
                <img
                  src={item.previewUrl}
                  alt=""
                  className="size-full object-cover"
                />
              ) : item.file.type.startsWith("image/") ? (
                <ImageIcon className="size-5" aria-hidden />
              ) : (
                <FileText className="size-5" aria-hidden />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{item.file.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                <span>{formatFileSize(item.file.size)}</span>
                {item.state.kind === "uploading" && (
                  <>
                    <span aria-hidden> · </span>
                    <span>{t("fileUpload.uploading")}</span>
                  </>
                )}
              </p>
            </div>
            {item.state.kind === "complete" && (
              <Check className="size-4 shrink-0 text-success" aria-hidden />
            )}
            <button
              type="button"
              aria-label={t("fileUpload.removeFile", { name: item.file.name })}
              className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => removeFile(item)}
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>

          {item.state.kind === "uploading" && (
            <div
              role="progressbar"
              aria-label={t("fileUpload.uploading")}
              className="h-1 overflow-hidden bg-primary/15"
            >
              <div className="file-upload-indeterminate h-full w-2/5 bg-primary" />
            </div>
          )}

          {item.state.kind === "error" && (
            <p
              role="alert"
              aria-label={t("fileUpload.error", {
                message: errorMessage(i18n, item.state.code),
              })}
              className="border-t border-destructive/20 bg-destructive/[0.06] px-3 py-2 text-xs text-destructive"
            >
              {t("fileUpload.error", {
                message: errorMessage(i18n, item.state.code),
              })}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
