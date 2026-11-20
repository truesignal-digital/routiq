import { sessionStore } from "../auth/store.js";
import { extractApiError } from "../lib/api-error.js";

/** The list's own filters: the file holds exactly what the screen lists (#429). */
export interface EntriesExportParams {
  status?: string | undefined;
  direction?: string | undefined;
  periodCode?: string | undefined;
  economicMonth?: string | undefined;
  evidence?: string | undefined;
  assetId?: string | undefined;
  branchId?: string | undefined;
}

export type EntriesExportResult = { ok: true } | { ok: false; code: string };

/** The server names the file (`<company>-ecritures-2026-09.xlsx`). */
export function fileNameOf(disposition: string | null): string {
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition ?? "")?.[1];
  if (encoded !== undefined) return decodeURIComponent(encoded);
  return /filename="([^"]+)"/i.exec(disposition ?? "")?.[1] ?? "routiq.xlsx";
}

export async function downloadEntriesExport(
  params: EntriesExportParams,
  language: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EntriesExportResult> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.append(key, value);
  }
  query.append("lang", language.startsWith("en") ? "en" : "fr");
  const token = sessionStore.getActive()?.token;

  let response: Response;
  try {
    response = await fetchImpl(`/v1/finance/entries/export?${query.toString()}`, {
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false, code: "NETWORK_ERROR" };
  }
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    return { ok: false, code: extractApiError(body, "generic").code };
  }

  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = fileNameOf(response.headers.get("content-disposition"));
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return { ok: true };
}
