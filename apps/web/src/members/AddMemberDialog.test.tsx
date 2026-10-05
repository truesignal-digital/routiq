// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddMemberPayload, CommandSubmission } from "@routiq/contracts";
import "../i18n/index.js";
import { sessionStore } from "../auth/store.js";
import type { CommandClient, SubmitResult } from "../commands/client.js";
import { AddMemberDialog } from "./AddMemberDialog.js";

const sessionIdentity = { username: "amina", workspaceSlug: "sotrafret" };

const branches = [
  { id: "branch-dla", name: "Douala" },
  { id: "branch-yde", name: "Yaoundé" },
];

const committed: SubmitResult = {
  ok: true,
  outcome: {
    commandId: "c1",
    recordId: "r1",
    rowVersion: 1,
    warnings: [],
    idempotentReplay: false,
  },
};

function fakeClient(
  result: SubmitResult,
): CommandClient & { seen: CommandSubmission<AddMemberPayload>[] } {
  const seen: CommandSubmission<AddMemberPayload>[] = [];
  return {
    seen,
    submit: async (submission) => {
      seen.push(submission as CommandSubmission<AddMemberPayload>);
      return result;
    },
  };
}

function renderDialog(client: CommandClient, onAdded = vi.fn()) {
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AddMemberDialog
        open
        onOpenChange={onOpenChange}
        branches={branches}
        onAdded={onAdded}
        client={client}
      />
    </QueryClientProvider>,
  );
  return { onOpenChange, onAdded };
}

/** Fills every required field; the caller overrides what its case is about. */
async function fillForm(overrides: Partial<Record<string, string>> = {}) {
  await userEvent.type(
    screen.getByLabelText("Nom complet"),
    overrides["displayName"] ?? "Estelle Ngo",
  );
  await userEvent.type(
    screen.getByLabelText("Identifiant de connexion"),
    overrides["username"] ?? "estelle",
  );
  await userEvent.click(screen.getByRole("combobox", { name: "Rôle" }));
  await userEvent.click(await screen.findByRole("option", { name: "Agent de terrain" }));
  await userEvent.type(screen.getByLabelText("Code PIN"), overrides["pin"] ?? "4821");
  await userEvent.type(
    screen.getByLabelText("Confirmer le code PIN"),
    overrides["confirmPin"] ?? overrides["pin"] ?? "4821",
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStore.save({
    ...sessionIdentity,
    token: "token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
});

afterEach(() => {
  sessionStore.logout(sessionIdentity);
  cleanup();
});

describe("AddMemberDialog", () => {
  it("hires a member with a client-minted id and the scope the admin chose", async () => {
    const client = fakeClient(committed);
    const { onAdded, onOpenChange } = renderDialog(client);

    await fillForm();
    await userEvent.click(screen.getByRole("button", { name: "Ajouter l'utilisateur" }));

    await waitFor(() => expect(client.seen).toHaveLength(1));
    const submission = client.seen[0]!;
    expect(submission.name).toBe("add-member");
    expect(submission.payload).toMatchObject({
      displayName: "Estelle Ngo",
      username: "estelle",
      role: "FIELD_SUBMITTER",
      branchScope: "ALL",
      pin: "4821",
    });
    expect(submission.payload.principalId).toMatch(/^[0-9a-f-]{36}$/);
    expect(onAdded).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("narrows the new member to the branches picked, by id", async () => {
    const client = fakeClient(committed);
    renderDialog(client);

    await fillForm();
    await userEvent.click(screen.getByRole("checkbox", { name: "Toutes les agences" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Yaoundé" }));
    await userEvent.click(screen.getByRole("button", { name: "Ajouter l'utilisateur" }));

    await waitFor(() => expect(client.seen).toHaveLength(1));
    expect(client.seen[0]!.payload.branchScope).toEqual(["branch-dla", "branch-yde"]);
  });

  it("answers a taken username on the username field, not as a toast", async () => {
    const client = fakeClient({ ok: false, code: "USERNAME_TAKEN" });
    const { onOpenChange } = renderDialog(client);

    await fillForm();
    await userEvent.click(screen.getByRole("button", { name: "Ajouter l'utilisateur" }));

    expect(
      await screen.findByText("Ce nom d'utilisateur est déjà pris dans votre espace."),
    ).toBeTruthy();
    // The form stays open on the field that has to change.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("refuses two PINs that disagree before anything is sent", async () => {
    const client = fakeClient(committed);
    renderDialog(client);

    await fillForm({ pin: "4821", confirmPin: "4822" });
    await userEvent.click(screen.getByRole("button", { name: "Ajouter l'utilisateur" }));

    expect(await screen.findByText("Les deux codes ne correspondent pas.")).toBeTruthy();
    expect(client.seen).toHaveLength(0);
  });

  it("keeps the PIN masked, and out of the document once it is sent", async () => {
    const client = fakeClient(committed);
    renderDialog(client);

    await fillForm();
    expect(screen.getByLabelText("Code PIN").getAttribute("type")).toBe("password");

    await userEvent.click(screen.getByRole("button", { name: "Ajouter l'utilisateur" }));
    await waitFor(() => expect(client.seen).toHaveLength(1));

    // Not in a field, not in a confirmation, not anywhere: the PIN leaves this
    // dialog only inside the command.
    expect(document.body.innerHTML).not.toContain("4821");
  });
});
