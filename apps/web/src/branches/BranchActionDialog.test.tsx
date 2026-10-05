// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchListItem, CommandSubmission } from "@routiq/contracts";
import "../i18n/index.js";
import { sessionStore } from "../auth/store.js";
import type { CommandClient, SubmitResult } from "../commands/client.js";
import {
  branchActions,
  BranchActionDialog,
  type BranchActionKey,
} from "./BranchActionDialog.js";

const sessionIdentity = { username: "amina", workspaceSlug: "sotrafret" };

const branch: BranchListItem = {
  id: "11111111-1111-4111-8111-111111111111",
  code: "DLA",
  name: "Douala",
  timezone: "Africa/Douala",
  active: true,
  rowVersion: 4,
};

const committed: SubmitResult = {
  ok: true,
  outcome: {
    commandId: "c1",
    recordId: branch.id,
    rowVersion: 5,
    warnings: [],
    idempotentReplay: false,
  },
};

function fakeClient(
  result: SubmitResult,
): CommandClient & { seen: CommandSubmission<Record<string, unknown>>[] } {
  const seen: CommandSubmission<Record<string, unknown>>[] = [];
  return {
    seen,
    submit: async (submission) => {
      seen.push(submission as CommandSubmission<Record<string, unknown>>);
      return result;
    },
  };
}

function renderDialog(
  action: BranchActionKey,
  client: CommandClient,
  target: BranchListItem = branch,
) {
  const onDismiss = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BranchActionDialog
        branch={target}
        action={action}
        client={client}
        onDismiss={onDismiss}
      />
    </QueryClientProvider>,
  );
  return { onDismiss };
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

/**
 * The point of the field-level answer is that it is attached to the input, not
 * merely present on screen: the same sentence rendered in the banner would
 * satisfy a text query while telling the admin nothing about which field to fix.
 */
function messageDescribing(label: string): string {
  const input = screen.getByLabelText(label);
  expect(input.getAttribute("aria-invalid")).toBe("true");
  return (input.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

describe("branchActions", () => {
  it("offers a deactivated branch the way back and nothing else", () => {
    expect(branchActions({ ...branch, active: false })).toEqual(["reactivate"]);
  });

  it("offers an active branch a rename and a deactivation", () => {
    expect(branchActions(branch)).toEqual(["rename", "deactivate"]);
  });
});

describe("BranchActionDialog", () => {
  it("renames at the version the row was rendered, and never touches the code", async () => {
    const client = fakeClient(committed);
    const { onDismiss } = renderDialog("rename", client);

    // The code is shown so the admin knows which branch this is, but it is
    // embedded in every record number the branch has printed.
    expect(screen.getByLabelText("Code")).toHaveProperty("readOnly", true);
    expect(
      screen.getByText(
        "Le code apparaît dans les numéros de pièces et ne peut pas changer.",
      ),
    ).toBeTruthy();

    await userEvent.clear(screen.getByLabelText("Nom"));
    await userEvent.type(screen.getByLabelText("Nom"), "Douala Port");
    await userEvent.click(screen.getByRole("button", { name: "Renommer l'agence" }));

    await waitFor(() => expect(client.seen).toHaveLength(1));
    const submission = client.seen[0]!;
    expect(submission.name).toBe("rename-branch");
    expect(submission.payload).toEqual({ branchId: branch.id, name: "Douala Port" });
    expect(submission.envelope.expectedVersion).toBe(4);
    await waitFor(() => expect(onDismiss).toHaveBeenCalled());
  });

  it("will not send a rename that changes nothing", async () => {
    const client = fakeClient(committed);
    renderDialog("rename", client);

    await userEvent.click(screen.getByRole("button", { name: "Renommer l'agence" }));
    expect(client.seen).toHaveLength(0);
  });

  it("will not send a rename the command schema would reject as blank", async () => {
    const client = fakeClient(committed);
    renderDialog("rename", client);

    await userEvent.clear(screen.getByLabelText("Nom"));
    await userEvent.type(screen.getByLabelText("Nom"), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Renommer l'agence" }));

    expect(client.seen).toHaveLength(0);
  });

  /**
   * The failure the issue described: a long agency name pasted into the rename
   * dialog reached the server and came back as an unattributed
   * VALIDATION_FAILED banner. The input deliberately does not cap the length —
   * truncating the paste would hide the rule rather than explain it.
   */
  it("explains the length rule when an over-long name is pasted", async () => {
    const client = fakeClient(committed);
    renderDialog("rename", client);

    await userEvent.clear(screen.getByLabelText("Nom"));
    await userEvent.paste("a".repeat(121));

    expect(messageDescribing("Nom")).toContain(
      "Le nom ne doit pas dépasser 120 caractères.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Renommer l'agence" }));
    expect(client.seen).toHaveLength(0);
  });

  /**
   * A name longer than the schema allows can only arrive from a row written
   * before the rule existed — the input caps typing, so the field error is what
   * tells the admin why the button is dead.
   */
  it("attributes an over-long inherited name to the name field", async () => {
    renderDialog("rename", fakeClient(committed), { ...branch, name: "a".repeat(121) });

    expect(
      await screen.findByText("Le nom ne doit pas dépasser 120 caractères."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Renommer l'agence" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("answers a taken name on the name field rather than as a banner", async () => {
    const client = fakeClient({ ok: false, code: "DUPLICATE_BRANCH_NAME" });
    const { onDismiss } = renderDialog("rename", client);

    await userEvent.clear(screen.getByLabelText("Nom"));
    await userEvent.type(screen.getByLabelText("Nom"), "Yaoundé");
    await userEvent.click(screen.getByRole("button", { name: "Renommer l'agence" }));

    await screen.findByText("Ce nom d'agence existe déjà dans votre espace.");
    expect(messageDescribing("Nom")).toContain(
      "Ce nom d'agence existe déjà dans votre espace.",
    );
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("names the branch before retiring it, then commits on confirm", async () => {
    const client = fakeClient(committed);
    const { onDismiss } = renderDialog("deactivate", client);

    expect(screen.getByText(/Douala/)).toBeTruthy();
    expect(client.seen).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "Désactiver l'agence" }));

    await waitFor(() => expect(client.seen).toHaveLength(1));
    expect(client.seen[0]!.name).toBe("set-branch-status");
    expect(client.seen[0]!.payload).toEqual({ branchId: branch.id, active: false });
    // An absolute state flip does not fight a concurrent rename over a version.
    expect(client.seen[0]!.envelope.expectedVersion).toBeUndefined();
    await waitFor(() => expect(onDismiss).toHaveBeenCalled());
  });

  it("explains the last-branch refusal in place, and keeps the dialog open", async () => {
    const client = fakeClient({ ok: false, code: "LAST_BRANCH" });
    const { onDismiss } = renderDialog("deactivate", client);

    await userEvent.click(screen.getByRole("button", { name: "Désactiver l'agence" }));

    expect(
      await screen.findByText("Votre espace doit garder au moins une agence active."),
    ).toBeTruthy();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("reactivates an inactive branch", async () => {
    const client = fakeClient(committed);
    renderDialog("reactivate", client, { ...branch, active: false });

    await userEvent.click(screen.getByRole("button", { name: "Réactiver l'agence" }));

    await waitFor(() => expect(client.seen).toHaveLength(1));
    expect(client.seen[0]!.payload).toEqual({ branchId: branch.id, active: true });
  });

  it("sends the admin back to a reloaded list when the row moved underneath", async () => {
    const client = fakeClient({ ok: false, code: "VERSION_CONFLICT" });
    const { onDismiss } = renderDialog("rename", client);

    await userEvent.clear(screen.getByLabelText("Nom"));
    await userEvent.type(screen.getByLabelText("Nom"), "Douala Port");
    await userEvent.click(screen.getByRole("button", { name: "Renommer l'agence" }));

    expect(await screen.findByText("Cette agence a changé")).toBeTruthy();
    await userEvent.click(await screen.findByRole("button", { name: "Recharger" }));
    await waitFor(() => expect(onDismiss).toHaveBeenCalled());
  });
});
