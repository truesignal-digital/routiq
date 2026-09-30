// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/index.js";
import type { CommandClient, SubmitResult } from "../commands/client.js";
import { AttachEvidenceForm } from "./AttachEvidenceForm.js";

const ENTRY_ID = "00000000-0000-4000-8000-00000000e001";
const FILE_ID = "00000000-0000-4000-8000-00000000f0f0";
const toastAdd = vi.hoisted(() => vi.fn());

vi.mock("@/components/ui/toast.js", () => ({ toast: { add: toastAdd } }));
// The upload itself is the file-upload component's job; here it hands over an id.
vi.mock("@/components/ui/file-upload", () => ({
  FileUpload: ({ onChange }: { onChange: (ids: string[]) => void }) => (
    <button type="button" onClick={() => onChange([FILE_ID])}>
      pick a file
    </button>
  ),
}));

function recordingClient(): CommandClient & { seen: unknown[] } {
  const seen: unknown[] = [];
  const committed: SubmitResult = {
    ok: true,
    outcome: { commandId: "c1", recordId: ENTRY_ID, rowVersion: 1, warnings: [], idempotentReplay: false },
  };
  return {
    seen,
    submit: async (submission) => {
      seen.push(submission);
      return committed;
    },
  };
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});
afterEach(cleanup);

describe("AttachEvidenceForm", () => {
  it("needs a file, then links it without quoting a version", async () => {
    const client = recordingClient();
    const onDone = vi.fn();
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AttachEvidenceForm
          surface="dialog"
          entry={{ id: ENTRY_ID, entryNumber: "DLA-2026-00006" }}
          client={client}
          onDone={onDone}
          onDismiss={vi.fn()}
        />
      </QueryClientProvider>,
    );
    const attach = screen.getByRole("button", { name: "Attach" });
    expect((attach as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "pick a file" }));
    await user.click(attach);
    await waitFor(() => expect(client.seen).toHaveLength(1));
    expect(client.seen[0]).toMatchObject({
      name: "attach-evidence",
      payload: { entryId: ENTRY_ID, artifactIds: [FILE_ID] },
      envelope: { sourceArtifactIds: [FILE_ID] },
    });
    expect((client.seen[0] as { envelope: Record<string, unknown> }).envelope["expectedVersion"]).toBeUndefined();
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(toastAdd).toHaveBeenCalledWith({ type: "success", title: "Receipt attached" });
  });
});
