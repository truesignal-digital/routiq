// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.js";
import type { CommandClient, SubmitResult } from "../../commands/client.js";
import { AddNoteForm } from "./AddNoteForm.js";

const ASSET_ID = "00000000-0000-4000-8000-00000000a001";

vi.mock("@/components/ui/toast.js", () => ({ toast: { add: vi.fn() } }));

function client(result: SubmitResult): CommandClient & { seen: unknown[] } {
  const seen: unknown[] = [];
  return { seen, submit: async (submission) => (seen.push(submission), result) };
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});
afterEach(cleanup);

function renderForm(commands: CommandClient, onDismiss = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AddNoteForm surface="dialog" assetId={ASSET_ID} assetLabel="VH003" client={commands} onDismiss={onDismiss} />
    </QueryClientProvider>,
  );
  return onDismiss;
}

describe("AddNoteForm", () => {
  it("sends a trimmed note on the vehicle, and nothing while it is blank", async () => {
    const commands = client({
      ok: true,
      outcome: { commandId: "c1", recordId: "n1", rowVersion: 1, warnings: [], idempotentReplay: false },
    });
    const onDismiss = renderForm(commands);
    const user = userEvent.setup();
    const submit = screen.getByRole("button", { name: "Add note" });
    await user.type(screen.getByLabelText("Note"), "   ");
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("Note"), "Spare wheel missing  ");
    await user.click(submit);
    await waitFor(() => expect(commands.seen).toHaveLength(1));
    expect(commands.seen[0]).toMatchObject({
      name: "add-note",
      payload: { entityType: "asset", entityId: ASSET_ID, body: "Spare wheel missing" },
    });
    expect(onDismiss).toHaveBeenCalled();
  });

  it("says a vehicle that left the fleet takes no notes, in place", async () => {
    renderForm(client({ ok: false, code: "ASSET_NOT_OPERATIONAL" }));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Note"), "Late remark");
    await user.click(screen.getByRole("button", { name: "Add note" }));
    expect(await screen.findByText("This asset has left the fleet: no new operations are possible.")).toBeTruthy();
  });
});
