import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileText, TriangleAlert } from "lucide-react";
import { sessionStore } from "@/auth/store.js";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/error-message.js";

/** The picture types the upload accepts; any other file keeps download only. */
const PREVIEWABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

type FileUrl = { ok: true; url: string } | { ok: false; code: string };

async function fetchFileUrl(downloadPath: string): Promise<FileUrl> {
  const token = sessionStore.getToken();
  const response = await fetch(downloadPath, {
    headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (response === null) return { ok: false, code: "NETWORK_ERROR" };
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: { code?: string } } | null;
    return { ok: false, code: body?.error?.code ?? "READ_FAILED" };
  }
  const { url } = (await response.json()) as { url: string };
  return { ok: true, url };
}

type Preview = { kind: "loading" } | { kind: "ready"; url: string } | { kind: "failed" };

/**
 * One file behind a record. It opens through the record-scoped route the host
 * names (entry evidence, a document's scan, an issue's photo): that route
 * checks the record is readable, the generic artifact route never serves it.
 * A picture opens in a dialog first; download stays beside it.
 */
export function RecordFileRow({
  name,
  meta,
  mimeType,
  downloadPath,
}: {
  name: string;
  meta?: string | undefined;
  mimeType: string;
  downloadPath: string;
}) {
  const { t, i18n } = useTranslation();
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<Preview>({ kind: "loading" });
  const [open, setOpen] = useState(false);
  const previewable = PREVIEWABLE.has(mimeType);

  async function download() {
    setError(undefined);
    const result = await fetchFileUrl(downloadPath);
    if (!result.ok) {
      setError(result.code);
      return;
    }
    window.open(result.url, "_blank", "noopener");
  }

  async function loadPreview() {
    setPreview({ kind: "loading" });
    const result = await fetchFileUrl(downloadPath);
    setPreview(result.ok ? { kind: "ready", url: result.url } : { kind: "failed" });
  }

  const label = (
    <>
      <p className="truncate text-sm font-medium">{name}</p>
      {meta !== undefined && <p className="text-xs text-muted-foreground">{meta}</p>}
    </>
  );

  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2.5">
      <div className="flex min-w-0 flex-1 gap-2">
        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          {previewable ? (
            <Dialog
              open={open}
              onOpenChange={(next) => {
                setOpen(next);
                setError(undefined);
                if (next) void loadPreview();
              }}
            >
              <DialogTrigger
                aria-label={t("vehicle.panel.viewPicture", { name })}
                className="block w-full min-w-0 rounded-sm text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                {label}
              </DialogTrigger>
              <DialogContent className="flex h-dvh max-h-dvh max-w-full flex-col rounded-none sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:max-w-3xl sm:rounded-xl">
                <DialogHeader className="pr-10">
                  <DialogTitle className="truncate leading-normal">{name}</DialogTitle>
                </DialogHeader>
                <div className="flex min-h-0 flex-1 items-center justify-center">
                  {preview.kind === "loading" && (
                    <Skeleton className="h-64 w-full" role="status" aria-label={t("vehicle.panel.pictureLoading")} />
                  )}
                  {preview.kind === "ready" && (
                    <img
                      src={preview.url}
                      alt={name}
                      className="max-h-full w-auto max-w-full object-contain sm:max-h-[70dvh]"
                      onError={() => setPreview({ kind: "failed" })}
                    />
                  )}
                  {preview.kind === "failed" && (
                    <p className="flex items-center gap-2 text-sm text-destructive">
                      <TriangleAlert className="size-4 shrink-0" aria-hidden />
                      {t("vehicle.panel.pictureFailed")}
                    </p>
                  )}
                </div>
                {error !== undefined && <p className="text-xs text-destructive">{errorMessage(i18n, error)}</p>}
                <DialogFooter>
                  <Button variant="outline" onClick={() => void download()}>
                    <Download aria-hidden />
                    {t("vehicle.panel.download")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : (
            label
          )}
          {error !== undefined && !open && <p className="text-xs text-destructive">{errorMessage(i18n, error)}</p>}
        </div>
      </div>
      <Button variant="ghost" size="desktop-icon-sm" aria-label={t("vehicle.panel.openFile")} onClick={() => void download()}>
        <Download aria-hidden />
      </Button>
    </li>
  );
}
