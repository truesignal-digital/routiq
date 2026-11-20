// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/index.js";
import { errorMessage } from "../lib/error-message.js";
import { RecordFileRow } from "./record-file-row.js";

const PATH = "/v1/issues/i1/artifacts/a1/download-url";
const SIGNED = "https://files.test/a1.jpg";

function list(row: React.ReactNode) {
  return render(<ul>{row}</ul>);
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ url: SIGNED }), { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("RecordFileRow", () => {
  it("opens an image in a dialog with the picture and a download action", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    vi.stubGlobal("open", open);
    list(<RecordFileRow name="voyant-frein.jpg" mimeType="image/jpeg" downloadPath={PATH} />);

    const trigger = screen.getByRole("button", { name: "View voyant-frein.jpg" });
    await user.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "voyant-frein.jpg" });
    const picture = await screen.findByRole("img", { name: "voyant-frein.jpg" });
    expect(picture.getAttribute("src")).toBe(SIGNED);
    expect(fetch).toHaveBeenCalledWith(PATH, expect.anything());

    await user.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(SIGNED, "_blank", "noopener"));
    expect(dialog).toBeTruthy();
  });

  it("closes on Escape and gives focus back to the row", async () => {
    const user = userEvent.setup();
    list(<RecordFileRow name="recu.png" mimeType="image/png" downloadPath={PATH} />);

    const trigger = screen.getByRole("button", { name: "View recu.png" });
    await user.click(trigger);
    await screen.findByRole("dialog", { name: "recu.png" });

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("says so in words when the picture fails to load, and keeps the download", async () => {
    const user = userEvent.setup();
    list(<RecordFileRow name="photo.webp" mimeType="image/webp" downloadPath={PATH} />);

    await user.click(screen.getByRole("button", { name: "View photo.webp" }));
    fireEvent.error(await screen.findByRole("img", { name: "photo.webp" }));

    expect(await screen.findByText("The picture could not be shown. You can still download it.")).toBeTruthy();
    expect(screen.queryByRole("img", { name: "photo.webp" })).toBeNull();
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
  });

  it("says so when the file link cannot be fetched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { code: "NOT_FOUND" } }), { status: 404 })),
    );
    const user = userEvent.setup();
    list(<RecordFileRow name="photo.jpg" mimeType="image/jpeg" downloadPath={PATH} />);

    await user.click(screen.getByRole("button", { name: "View photo.jpg" }));
    expect(await screen.findByText("The picture could not be shown. You can still download it.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
  });

  it("shows a failed download once, in the open dialog", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ url: SIGNED }), { status: 200 }))
        .mockResolvedValue(new Response(JSON.stringify({ error: { code: "NOT_FOUND" } }), { status: 404 })),
    );
    const user = userEvent.setup();
    list(<RecordFileRow name="photo.jpg" mimeType="image/jpeg" downloadPath={PATH} />);

    await user.click(screen.getByRole("button", { name: "View photo.jpg" }));
    const dialog = await screen.findByRole("dialog", { name: "photo.jpg" });
    await screen.findByRole("img", { name: "photo.jpg" });
    await user.click(within(dialog).getByRole("button", { name: "Download" }));

    const text = errorMessage(i18n, "NOT_FOUND");
    expect(await within(dialog).findByText(text)).toBeTruthy();
    expect(screen.getAllByText(text)).toHaveLength(1);
  });

  it("keeps a PDF on download only", async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    vi.stubGlobal("open", open);
    list(<RecordFileRow name="carte-grise.pdf" mimeType="application/pdf" downloadPath={PATH} />);

    expect(screen.queryByRole("button", { name: /^View/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Open the file" }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(SIGNED, "_blank", "noopener"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([
    ["fr-CM", "Voir recu.jpg", "Télécharger"],
    ["en", "View recu.jpg", "Download"],
  ] as const)("names the preview and download actions in %s", async (locale, view, download) => {
    await i18n.changeLanguage(locale);
    const user = userEvent.setup();
    list(<RecordFileRow name="recu.jpg" mimeType="image/jpeg" downloadPath={PATH} />);
    await user.click(screen.getByRole("button", { name: view }));
    expect(await screen.findByRole("button", { name: download })).toBeTruthy();
    await i18n.changeLanguage("en");
  });
});
