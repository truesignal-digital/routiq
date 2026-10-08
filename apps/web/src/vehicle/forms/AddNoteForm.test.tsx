// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.js";
import { describeCommandForm, fakeClient } from "../../test/form-harness.js";
import { AddNoteForm } from "./AddNoteForm.js";

const ASSET_ID = "00000000-0000-4000-8000-00000000a001";

describeCommandForm("AddNoteForm", {
  command: "add-note",
  render: ({ client, onDismiss }) => (
    <AddNoteForm surface="dialog" assetId={ASSET_ID} assetLabel="VH003" client={client} onDismiss={onDismiss} />
  ),
  opened: () => {
    expect(screen.getByText("VH003")).toBeTruthy();
    expect((screen.getByLabelText("Note") as HTMLTextAreaElement).value).toBe("");
  },
  fill: (user) => user.type(screen.getByLabelText("Note"), "  Spare wheel missing  "),
  payload: { noteId: expect.any(String), entityType: "asset", entityId: ASSET_ID, body: "Spare wheel missing" },
});

describe("AddNoteForm", () => {
  beforeAll(() => i18n.changeLanguage("en"));
  afterAll(() => i18n.changeLanguage("fr-CM"));

  it("says a vehicle that left the fleet takes no notes, as a note rather than an error", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AddNoteForm
          surface="dialog"
          assetId={ASSET_ID}
          assetLabel="VH003"
          client={fakeClient({ ok: false, code: "ASSET_NOT_OPERATIONAL" })}
          onDismiss={vi.fn()}
        />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Note"), "Late remark");
    await user.click(screen.getByRole("button", { name: "Add the note" }));
    expect((await screen.findByRole("status")).textContent).toBe(
      "This asset has left the fleet: no new operations are possible.",
    );
  });
});
