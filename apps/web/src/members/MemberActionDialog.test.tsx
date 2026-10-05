// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandSubmission, MemberListItem } from "@routiq/contracts";
import "../i18n/index.js";
import { sessionStore } from "../auth/store.js";
import type { CommandClient, SubmitResult } from "../commands/client.js";
import {
  memberActions,
  MemberActionDialog,
  type MemberActionKey,
} from "./MemberActionDialog.js";

const sessionIdentity = { username: "amina", workspaceSlug: "sotrafret" };

const branches = [
  { id: "branch-dla", name: "Douala" },
  { id: "branch-yde", name: "Yaoundé" },
];

const member: MemberListItem = {
  principalId: "11111111-1111-4111-8111-111111111111",
  displayName: "Estelle Ngo",
  username: "estelle",
  role: "FIELD_SUBMITTER",
  branchScope: "ALL",
  status: "ACTIVE",
  rowVersion: 7,
  createdAt: "2026-07-01T08:00:00.000Z",
};

const committed: SubmitResult = {
  ok: true,
  outcome: {
    commandId: "c1",
    recordId: "r1",
    rowVersion: 8,
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
  action: MemberActionKey,
  client: CommandClient,
  target: MemberListItem = member,
) {
  const onDismiss = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemberActionDialog
        member={target}
        action={action}
        branches={branches}
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

describe("memberActions", () => {
  it("offers a deactivated member the way back and nothing else", () => {
    expect(memberActions({ ...member, status: "DEACTIVATED" })).toEqual(["reactivate"]);
  });

  it("offers a locked member a PIN reset — the reset is the unlock", () => {
    expect(memberActions({ ...member, status: "LOCKED" })).toContain("pin");
  });

  it("offers no PIN reset to a membership that has no login", () => {
    expect(memberActions({ ...member, username: null })).not.toContain("pin");
  });
});

describe("MemberActionDialog", () => {
  it("sends only what changed, at the version the row was rendered", async () => {
    const client = fakeClient(committed);
    renderDialog("role", client);

    await userEvent.click(screen.getByRole("combobox", { name: "Rôle" }));
    await userEvent.click(await screen.findByRole("option", { name: "Maintenance" }));
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer le rôle" }));

    await waitFor(() => expect(client.seen).toHaveLength(1));
    const submission = client.seen[0]!;
    expect(submission.name).toBe("update-member-role");
    expect(submission.payload).toEqual({
      principalId: member.principalId,
      role: "MAINTENANCE",
    });
    expect(submission.envelope.expectedVersion).toBe(7);
  });

  it("names the person before revoking them, then commits on confirm", async () => {
    const client = fakeClient(committed);
    const { onDismiss } = renderDialog("deactivate", client);

    expect(screen.getByText(/Estelle Ngo/)).toBeTruthy();
    expect(client.seen).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: "Désactiver l'utilisateur" }));

    await waitFor(() => expect(client.seen).toHaveLength(1));
    expect(client.seen[0]!.name).toBe("deactivate-member");
    expect(client.seen[0]!.payload).toEqual({ principalId: member.principalId });
    await waitFor(() => expect(onDismiss).toHaveBeenCalled());
  });

  it("explains the last-admin refusal in place, and keeps the dialog open", async () => {
    const client = fakeClient({ ok: false, code: "LAST_ADMIN" });
    const { onDismiss } = renderDialog("deactivate", client, {
      ...member,
      role: "ADMIN",
    });

    await userEvent.click(screen.getByRole("button", { name: "Désactiver l'utilisateur" }));

    expect(
      await screen.findByText("Votre espace doit garder au moins un administrateur actif."),
    ).toBeTruthy();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("explains a self-deactivation the same way", async () => {
    const client = fakeClient({ ok: false, code: "SELF_DEACTIVATION" });
    renderDialog("deactivate", client);

    await userEvent.click(screen.getByRole("button", { name: "Désactiver l'utilisateur" }));

    expect(
      await screen.findByText(
        "Vous ne pouvez pas désactiver votre propre compte. Demandez à un autre administrateur.",
      ),
    ).toBeTruthy();
  });

  it("acknowledges a PIN reset without printing the PIN back", async () => {
    const client = fakeClient(committed);
    renderDialog("pin", client);

    await userEvent.type(screen.getByLabelText("Code PIN"), "9134");
    await userEvent.type(screen.getByLabelText("Confirmer le code PIN"), "9134");
    await userEvent.click(screen.getByRole("button", { name: "Réinitialiser le code" }));

    await waitFor(() => expect(client.seen).toHaveLength(1));
    expect(client.seen[0]!.name).toBe("reset-member-pin");
    expect(client.seen[0]!.payload).toEqual({
      principalId: member.principalId,
      pin: "9134",
    });

    expect(await screen.findByText("Code réinitialisé")).toBeTruthy();
    expect(document.body.innerHTML).not.toContain("9134");
  });

  it("will not send a PIN the two fields disagree on", async () => {
    const client = fakeClient(committed);
    renderDialog("pin", client);

    await userEvent.type(screen.getByLabelText("Code PIN"), "9134");
    await userEvent.type(screen.getByLabelText("Confirmer le code PIN"), "9135");

    expect(screen.getByText("Les deux codes ne correspondent pas.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Réinitialiser le code" }));
    expect(client.seen).toHaveLength(0);
  });

  it("sends the admin back to a reloaded list when the row moved underneath", async () => {
    const client = fakeClient({ ok: false, code: "VERSION_CONFLICT" });
    const { onDismiss } = renderDialog("role", client);

    await userEvent.click(screen.getByRole("combobox", { name: "Rôle" }));
    await userEvent.click(await screen.findByRole("option", { name: "Maintenance" }));
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer le rôle" }));

    await userEvent.click(await screen.findByRole("button", { name: "Recharger" }));
    await waitFor(() => expect(onDismiss).toHaveBeenCalled());
  });
});
