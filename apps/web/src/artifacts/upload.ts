/** Client side of presign → PUT → finalize (§6 "blobs first"; spine ticket 09 API). */

export interface FinalizedArtifact {
  id: string;
  sha256: string;
  sizeBytes: number;
}

export type UploadOutcome =
  | { ok: true; artifact: FinalizedArtifact }
  | { ok: false; code: string };

export async function uploadArtifact(
  artifactId: string,
  file: Blob,
  fileName: string | undefined,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<UploadOutcome> {
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };

  let presign: Response;
  try {
    presign = await fetchImpl("/v1/artifacts/presign", {
      method: "POST",
      headers,
      body: JSON.stringify({
        artifactId,
        sizeBytes: file.size,
        ...(fileName === undefined ? {} : { fileName }),
      }),
    });
  } catch {
    return { ok: false, code: "NETWORK_ERROR" };
  }
  const presignBody: unknown = await presign.json().catch(() => undefined);
  if (!presign.ok || !isPresign(presignBody)) {
    return { ok: false, code: extractCode(presignBody) };
  }

  try {
    const put = await fetchImpl(presignBody.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "application/octet-stream" },
      body: file,
    });
    if (!put.ok) return { ok: false, code: "STORAGE_FAILED" };
  } catch {
    return { ok: false, code: "NETWORK_ERROR" };
  }

  let finalize: Response;
  try {
    finalize = await fetchImpl("/v1/artifacts/finalize", {
      method: "POST",
      headers,
      body: JSON.stringify({
        artifactId,
        ...(fileName === undefined ? {} : { fileName }),
      }),
    });
  } catch {
    return { ok: false, code: "NETWORK_ERROR" };
  }
  const finalBody: unknown = await finalize.json().catch(() => undefined);

  // A finalize retry after a lost response hits the unique constraint:
  // the artifact already exists — that is success, not an error.
  if (finalize.status === 409 && extractCode(finalBody) === "UNIQUE_CONSTRAINT_VIOLATION") {
    return { ok: true, artifact: { id: artifactId, sha256: "", sizeBytes: file.size } };
  }
  if (finalize.ok && isFinalized(finalBody)) {
    return {
      ok: true,
      artifact: {
        id: finalBody.id,
        sha256: finalBody.sha256,
        sizeBytes: finalBody.sizeBytes,
      },
    };
  }
  return { ok: false, code: extractCode(finalBody) };
}

/** Downscale an image so receipts stay legible but 2G/3G uploads stay small. */
export async function downscaleImage(file: File, maxBytes = 1_000_000): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.size <= maxBytes) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.8, 0.6, 0.45]) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (blob && blob.size <= maxBytes) return blob;
    if (blob && quality === 0.45) return blob;
  }
  return file;
}

function isPresign(body: unknown): body is { artifactId: string; uploadUrl: string } {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { uploadUrl?: unknown }).uploadUrl === "string"
  );
}

function isFinalized(body: unknown): body is { id: string; sha256: string; sizeBytes: number } {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as { id?: unknown }).id === "string" &&
    typeof (body as { sha256?: unknown }).sha256 === "string"
  );
}

function extractCode(body: unknown): string {
  if (typeof body === "object" && body !== null && "error" in body) {
    const error = (body as { error: unknown }).error;
    if (typeof error === "object" && error !== null && "code" in error) {
      const code = (error as { code: unknown }).code;
      if (typeof code === "string") return code;
    }
  }
  return "STORAGE_FAILED";
}
