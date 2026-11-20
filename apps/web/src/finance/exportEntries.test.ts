import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadEntriesExport, fileNameOf } from "./exportEntries.js";

describe("downloadEntriesExport (#429)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks for the list's filters in the reader's language and saves the server's file name", async () => {
    const createObjectURL = vi.fn(() => "blob:export");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    });
    const fetchImpl = vi.fn(async () =>
      new Response(new Blob(["xlsx"]), {
        status: 200,
        headers: {
          "content-disposition": `attachment; filename="ngwa-ecritures-2026-09.xlsx"; filename*=UTF-8''ngwa-%C3%A9critures-2026-09.xlsx`,
        },
      }),
    );

    const result = await downloadEntriesExport(
      { status: "LEDGER", periodCode: "2026-09", assetId: undefined, direction: "" },
      "en",
      fetchImpl,
    );

    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/v1/finance/entries/export?status=LEDGER&periodCode=2026-09&lang=en",
      expect.anything(),
    );
    expect(clicked).toEqual(["ngwa-écritures-2026-09.xlsx"]);
  });

  it("asks in French unless the reader chose English", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 500 }));
    await downloadEntriesExport({}, "fr-CM", fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith("/v1/finance/entries/export?lang=fr", expect.anything());
  });

  it("hands back the server's refusal code", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: { code: "EXPORT_TOO_LARGE", metadata: { limit: 50_000, count: 61_204 } } }, { status: 400 }),
    );
    expect(await downloadEntriesExport({}, "fr", fetchImpl)).toEqual({ ok: false, code: "EXPORT_TOO_LARGE" });
  });

  it("reports no connection as NETWORK_ERROR", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await downloadEntriesExport({}, "fr", fetchImpl)).toEqual({ ok: false, code: "NETWORK_ERROR" });
  });

  it("falls back to the plain file name", () => {
    expect(fileNameOf(`attachment; filename="a-tout.xlsx"`)).toBe("a-tout.xlsx");
    expect(fileNameOf(null)).toBe("routiq.xlsx");
  });
});
