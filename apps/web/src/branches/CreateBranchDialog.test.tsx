// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandSubmission } from "@routiq/contracts";
import "../i18n/index.js";
import { sessionStore } from "../auth/store.js";
import type { CommandClient, SubmitResult } from "../commands/client.js";
import { CreateBranchDialog } from "./CreateBranchDialog.js";

const sessionIdentity = { username: "amina", workspaceSlug: "sotrafret" };

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

function renderDialog(client: CommandClient) {
  const onOpenChange = vi.fn();
  const onCreated = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CreateBranchDialog
        open
        onOpenChange={onOpenChange}
        onCreated={onCreated}
        client={client}
      />
    </QueryClientProvider>,
  );
  return { onOpenChange, onCreated };
}

async function fillForm(code: string, name: string) {
  await userEvent.type(screen.getByLabelText("Code"), code);
  await userEvent.type(screen.getByLabelText("Nom"), name);
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

describe("CreateBranchDialog", () => {
  it("sends create-branch with a client-generated id and the default time zone", async () => {
    const client = fakeClient(committed);
    const { onCreated, onOpenChange } = renderDialog(client);

    await fillForm("yde", "Yaoundé");
    await userEvent.click(screen.getByRole("button", { name: "Créer" }));

    await waitFor(() => expect(client.seen).toHaveLength(1));
    const submission = client.seen[0]!;
    expect(submission.name).toBe("create-branch");
    expect(submission.payload).toEqual({
      // Minted in the browser: the same form has to work offline (§6).
      branchId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      ),
      code: "YDE",
      name: "Yaoundé",
      timezone: "Africa/Douala",
    });

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("refuses a code the numbering scheme could not carry", async () => {
    const client = fakeClient(committed);
    renderDialog(client);

    await fillForm("y", "Yaoundé");
    await userEvent.click(screen.getByRole("button", { name: "Créer" }));

    expect(
      await screen.findByText("2 à 8 caractères, en majuscules ou chiffres (ex. DLA)."),
    ).toBeTruthy();
    expect(client.seen).toHaveLength(0);
  });

  it("answers a taken code on the code field rather than as a banner", async () => {
    const client = fakeClient({ ok: false, code: "DUPLICATE_BRANCH_CODE" });
    const { onOpenChange } = renderDialog(client);

    await fillForm("DLA", "Douala Nord");
    await userEvent.click(screen.getByRole("button", { name: "Créer" }));

    expect(
      await screen.findByText("Ce code d'agence existe déjà dans votre espace."),
    ).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("refuses a whitespace-only name, as the command schema does", async () => {
    const client = fakeClient(committed);
    renderDialog(client);

    await fillForm("YDE", "   ");
    await userEvent.click(screen.getByRole("button", { name: "Créer" }));

    expect(await screen.findByText("Ce champ est obligatoire.")).toBeTruthy();
    expect(client.seen).toHaveLength(0);
  });

  /**
   * Pasted, not typed, and the input does not cap the length: truncating the
   * paste would silently drop characters the admin can still see in their
   * clipboard. The rule is explained instead.
   */
  it("explains the length rule when an over-long name is pasted", async () => {
    const client = fakeClient(committed);
    renderDialog(client);

    await userEvent.type(screen.getByLabelText("Code"), "YDE");
    await userEvent.click(screen.getByLabelText("Nom"));
    await userEvent.paste("a".repeat(121));
    await userEvent.click(screen.getByRole("button", { name: "Créer" }));

    expect(messageDescribing("Nom")).toContain(
      "Le nom ne doit pas dépasser 120 caractères.",
    );
    expect(client.seen).toHaveLength(0);
  });

  it("answers a taken name on the name field rather than as a banner", async () => {
    const client = fakeClient({ ok: false, code: "DUPLICATE_BRANCH_NAME" });
    const { onOpenChange } = renderDialog(client);

    await fillForm("CTR", "Centre");
    await userEvent.click(screen.getByRole("button", { name: "Créer" }));

    await screen.findByText("Ce nom d'agence existe déjà dans votre espace.");
    expect(messageDescribing("Nom")).toContain(
      "Ce nom d'agence existe déjà dans votre espace.",
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("explains the code will never change", async () => {
    renderDialog(fakeClient(committed));

    expect(
      screen.getByText(
        "Le code apparaît dans les numéros de pièces et ne peut pas changer.",
      ),
    ).toBeTruthy();
  });
});
