// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandSubmission, MemberListItem } from "@routiq/contracts";
import "../i18n/index.js";
import { sessionStore } from "../auth/store.js";
import type { CommandClient, SubmitResult } from "../commands/client.js";
import { openSelect } from "../test-select.js";
import type { MemberActor } from "./permissions.js";
import {
  memberActions,
  MemberActionDialog,
  type MemberActionKey,
} from "./MemberActionDialog.js";

const toast = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock("@/components/ui/toast.js", () => ({ toast }));

/** Success is one toast, and nothing in the dialog repeats it. */
function expectOneSuccessToast(title: string, description?: string) {
  expect(toast.add).toHaveBeenCalledTimes(1);
  expect(toast.add).toHaveBeenCalledWith({
    type: "success",
    title,
    ...(description === undefined ? {} : { description }),
  });
  expect(screen.queryByRole("status")).toBeNull();
}

const sessionIdentity = { username: "amina", workspaceSlug: "sotrafret" };

const branches = [
  { id: "branch-dla", name: "Douala" },
  { id: "branch-yde", name: "Yaoundé" },
];

const director: MemberActor = {
  principalId: "99999999-9999-4999-8999-999999999999",
  role: "DIRECTOR",
  branchScope: "ALL",
};
const doualaAdmin: MemberActor = {
  principalId: "88888888-8888-4888-8888-888888888888",
  role: "ADMIN",
  branchScope: ["branch-dla"],
};

const member: MemberListItem = {
  principalId: "11111111-1111-4111-8111-111111111111",
  displayName: "Estelle Ngo",
  username: "estelle",
  role: "DRIVER",
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
  actor: MemberActor = director,
) {
  const onDismiss = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemberActionDialog
        member={target}
        action={action}
        branches={branches}
        actor={actor}
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
    expect(memberActions({ ...member, status: "DEACTIVATED" }, director)).toEqual(["reactivate"]);
  });

  it("offers a locked member a PIN reset — the reset is the unlock", () => {
    expect(memberActions({ ...member, status: "LOCKED" }, director)).toContain("pin");
  });

  it("offers no PIN reset to a membership that has no login", () => {
    expect(memberActions({ ...member, username: null }, director)).not.toContain("pin");
  });

  it("lets the Director act on every role but Direction", () => {
    for (const role of ["ADMIN", "FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"] as const) {
      expect(memberActions({ ...member, role }, director)).toEqual(["role", "pin", "deactivate"]);
    }
    // Direction is appointed by the vendor, never managed from Users (ADR-0009).
    expect(memberActions({ ...member, role: "DIRECTOR" }, director)).toEqual([]);
    expect(memberActions({ ...member, role: "DIRECTOR", status: "DEACTIVATED" }, director)).toEqual([]);
  });

  it("lets an Administrateur act only on field roles in their own branches", () => {
    const inDouala = { ...member, branchScope: ["branch-dla"] };
    for (const role of ["DRIVER", "TECHNICIAN", "CASHIER"] as const) {
      expect(memberActions({ ...inDouala, role }, doualaAdmin)).toEqual(["role", "pin", "deactivate"]);
    }
    for (const role of ["DIRECTOR", "ADMIN", "FINANCE"] as const) {
      expect(memberActions({ ...inDouala, role }, doualaAdmin)).toEqual([]);
    }
    expect(memberActions({ ...member, branchScope: ["branch-yde"] }, doualaAdmin)).toEqual([]);
    expect(memberActions({ ...member, branchScope: "ALL" }, doualaAdmin)).toEqual([]);
    expect(
      memberActions({ ...inDouala, status: "DEACTIVATED", role: "FINANCE" }, doualaAdmin),
    ).toEqual([]);
  });

  it("never offers anyone an action on themselves", () => {
    const self = { ...member, principalId: director.principalId, role: "DIRECTOR" as const };
    expect(memberActions(self, director)).toEqual([]);
    const adminSelf = { ...member, ...doualaAdmin, role: "ADMIN" as const };
    expect(memberActions(adminSelf, doualaAdmin)).toEqual([]);
  });

  it("offers nothing to a role that manages no one", () => {
    const finance: MemberActor = { ...director, role: "FINANCE" };
    expect(memberActions(member, finance)).toEqual([]);
  });
});

describe("the role picker, per actor", () => {
  async function pickerOptions(actor: MemberActor, target: MemberListItem = member) {
    renderDialog("role", fakeClient(committed), target, actor);
    await openSelect(userEvent.setup(), screen.getByRole("combobox", { name: "Rôle" }));
    return (await screen.findAllByRole("option")).map((option) => option.textContent);
  }

  it("shows the Director every role but Direction", async () => {
    expect(await pickerOptions(director)).toEqual([
      "Administrateur",
      "Finance",
      "Caissier / Caissière",
      "Technicien",
      "Chauffeur",
    ]);
  });

  it("shows an Administrateur the three field roles", async () => {
    expect(
      await pickerOptions(doualaAdmin, { ...member, branchScope: ["branch-dla"] }),
    ).toEqual(["Chauffeur", "Technicien", "Caissier / Caissière"]);
  });

  it("offers an Administrateur only their own branches, never all of them", () => {
    renderDialog("role", fakeClient(committed), { ...member, branchScope: ["branch-dla"] }, doualaAdmin);
    expect(screen.queryByRole("checkbox", { name: "Toutes les agences" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Douala" })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Yaoundé" })).toBeNull();
  });
});

describe("MemberActionDialog", () => {
  it("sends only what changed, at the version the row was rendered", async () => {
    const client = fakeClient(committed);
    const { onDismiss } = renderDialog("role", client);

    const user = userEvent.setup();
    await openSelect(user, screen.getByRole("combobox", { name: "Rôle" }));
    await user.click(await screen.findByRole("option", { name: "Technicien" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer le rôle" }));

    await waitFor(() => expect(client.seen).toHaveLength(1));
    const submission = client.seen[0]!;
    expect(submission.name).toBe("update-member-role");
    expect(submission.version).toBe(2);
    expect(submission.payload).toEqual({
      principalId: member.principalId,
      role: "TECHNICIAN",
    });
    expect(submission.envelope.expectedVersion).toBe(7);
    await waitFor(() => expect(onDismiss).toHaveBeenCalled());
    expectOneSuccessToast("Rôle mis à jour : Estelle Ngo");
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
    expectOneSuccessToast("Utilisateur désactivé : Estelle Ngo");
  });

  it("brings a deactivated member back with one toast", async () => {
    const client = fakeClient(committed);
    const { onDismiss } = renderDialog("reactivate", client, {
      ...member,
      status: "DEACTIVATED",
    });

    await userEvent.click(screen.getByRole("button", { name: "Réactiver l'utilisateur" }));

    await waitFor(() => expect(onDismiss).toHaveBeenCalled());
    expect(client.seen[0]!.name).toBe("reactivate-member");
    expectOneSuccessToast("Utilisateur réactivé : Estelle Ngo");
  });

  it("explains the last-director refusal in place, and keeps the dialog open", async () => {
    const client = fakeClient({ ok: false, code: "LAST_DIRECTOR" });
    const { onDismiss } = renderDialog("deactivate", client, {
      ...member,
      role: "DIRECTOR",
    });

    await userEvent.click(screen.getByRole("button", { name: "Désactiver l'utilisateur" }));

    expect(
      await screen.findByText("Votre espace doit garder au moins un membre actif de la Direction."),
    ).toBeTruthy();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(toast.add).not.toHaveBeenCalled();
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

  it("acknowledges a PIN reset in one toast, without printing the PIN back", async () => {
    const client = fakeClient(committed);
    const { onDismiss } = renderDialog("pin", client);

    await userEvent.type(screen.getByLabelText("Code PIN"), "9134");
    await userEvent.type(screen.getByLabelText("Confirmer le code PIN"), "9134");
    await userEvent.click(screen.getByRole("button", { name: "Réinitialiser le code" }));

    await waitFor(() => expect(client.seen).toHaveLength(1));
    expect(client.seen[0]!.name).toBe("reset-member-pin");
    expect(client.seen[0]!.payload).toEqual({
      principalId: member.principalId,
      pin: "9134",
    });

    await waitFor(() => expect(onDismiss).toHaveBeenCalled());
    expectOneSuccessToast(
      "Code réinitialisé : Estelle Ngo",
      "Remettez le nouveau code à Estelle Ngo : il n'apparaît plus nulle part.",
    );
    expect(screen.queryByText(/Code réinitialisé/)).toBeNull();
    expect(document.body.innerHTML).not.toContain("9134");
    expect(JSON.stringify(toast.add.mock.calls)).not.toContain("9134");
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

    const user = userEvent.setup();
    await openSelect(user, screen.getByRole("combobox", { name: "Rôle" }));
    await user.click(await screen.findByRole("option", { name: "Technicien" }));
    await user.click(screen.getByRole("button", { name: "Enregistrer le rôle" }));

    await user.click(await screen.findByRole("button", { name: "Recharger" }));
    await waitFor(() => expect(onDismiss).toHaveBeenCalled());
  });
});

describe("the member refusals the server answers", () => {
  it.each([
    ["SELF_ROLE_CHANGE", "Vous ne pouvez pas changer votre propre rôle ni vos agences. Demandez à la Direction."],
    ["MEMBER_ROLE_NOT_GRANTABLE", "Vous ne pouvez pas donner ni retirer ce rôle. Demandez à la Direction."],
    ["MEMBER_BRANCH_OUT_OF_SCOPE", "Ce membre ou ces agences sont hors de vos agences. Demandez à la Direction."],
    ["DIRECTOR_REQUIRES_ALL_BRANCHES", "La Direction couvre toujours toutes les agences."],
  ])("%s is read in place", async (code, text) => {
    renderDialog("deactivate", fakeClient({ ok: false, code }));
    await userEvent.click(screen.getByRole("button", { name: "Désactiver l'utilisateur" }));
    expect(await screen.findByText(text)).toBeTruthy();
  });
});
