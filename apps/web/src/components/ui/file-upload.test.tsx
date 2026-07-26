// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionStore } from "../../auth/store.js";
import type { UploadOutcome, uploadArtifact } from "../../artifacts/upload.js";
import { i18n } from "../../i18n/index.js";
import { FileUpload } from "./file-upload.js";

const ARTIFACT_ID = "00000000-0000-4000-8000-000000000020";
const identity = { username: "amina", workspaceSlug: "sotrafret" };

function deferredUpload() {
  let resolve!: (outcome: UploadOutcome) => void;
  const promise = new Promise<UploadOutcome>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

beforeEach(() => {
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(ARTIFACT_ID);
  sessionStore.save({
    ...identity,
    token: "token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
});

afterEach(() => {
  sessionStore.logout(identity);
  vi.restoreAllMocks();
  cleanup();
});

describe("FileUpload", () => {
  it("renders a selected file while its upload is in progress", async () => {
    const user = userEvent.setup();
    const pending = deferredUpload();
    const uploadImpl = vi.fn<typeof uploadArtifact>().mockReturnValue(pending.promise);

    render(<FileUpload accept="image/*" onChange={vi.fn()} uploadImpl={uploadImpl} />);
    const input = screen.getByLabelText("Drop files here or click to choose");
    const file = new File(["receipt"], "receipt.jpg", { type: "image/jpeg" });

    await user.upload(input, file);

    expect(screen.getByText("receipt.jpg")).toBeTruthy();
    expect(screen.getByText("7 B")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Uploading…" })).toBeTruthy();
    expect((input as HTMLInputElement).accept).toBe("image/*");
  });

  it("removes a selected file from the list", async () => {
    const user = userEvent.setup();
    const pending = deferredUpload();
    const onChange = vi.fn();
    const uploadImpl = vi.fn<typeof uploadArtifact>().mockReturnValue(pending.promise);

    render(<FileUpload onChange={onChange} uploadImpl={uploadImpl} />);
    await user.upload(
      screen.getByLabelText("Drop files here or click to choose"),
      new File(["invoice"], "invoice.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("button", { name: "Remove invoice.pdf" }));

    expect(screen.queryByText("invoice.pdf")).toBeNull();
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith([]));
  });

  it("renders an upload error for the affected file", async () => {
    const user = userEvent.setup();
    const uploadImpl = vi
      .fn<typeof uploadArtifact>()
      .mockResolvedValue({ ok: false, code: "STORAGE_FAILED" });

    render(<FileUpload onChange={vi.fn()} uploadImpl={uploadImpl} />);
    await user.upload(
      screen.getByLabelText("Drop files here or click to choose"),
      new File(["invoice"], "invoice.pdf", { type: "application/pdf" }),
    );

    expect(
      await screen.findByRole("alert", {
        name: "Upload failed: Storing the file failed. Please retry.",
      }),
    ).toBeTruthy();
  });
});
