// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n/index.js";
import { sessionStore } from "../auth/store.js";
import type { CommandClient, SubmitResult } from "../commands/client.js";
import { RegisterPersonDialog } from "./RegisterPersonDialog.js";

const sessionIdentity = { username: "amina", workspaceSlug: "sotrafret" };

beforeEach(() => {
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

function fakeClient(result: SubmitResult): CommandClient & { seen: unknown[] } {
  const seen: unknown[] = [];
  return {
    seen,
    submit: async (submission) => {
      seen.push(submission);
      return result;
    },
  };
}

const committed: SubmitResult = {
  ok: true,
  outcome: {
    commandId: "c1",
    recordId: "p-new",
    rowVersion: 1,
    warnings: [],
    idempotentReplay: false,
  },
};

function renderDialog(client: CommandClient, queryClient = new QueryClient()) {
  const onRegistered = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <RegisterPersonDialog
        open
        onOpenChange={onOpenChange}
        branchCode="DLA"
        onRegistered={onRegistered}
        client={client}
      />
    </QueryClientProvider>,
  );
  return { onRegistered, onOpenChange };
}

interface SeenSubmission {
  name: string;
  version: number;
  payload: {
    personId: string;
    displayName: string;
    branchCode: string;
    phone?: string;
    defaultRole?: string;
  };
}

describe("RegisterPersonDialog", () => {
  it("submits register-person v1 with a client-minted id and the branch it was given", async () => {
    const client = fakeClient(committed);
    const { onRegistered, onOpenChange } = renderDialog(client);

    await userEvent.type(screen.getByLabelText("Nom complet"), "  Amadou Bello  ");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(client.seen).toHaveLength(1));
    const submission = client.seen[0] as SeenSubmission;
    expect(submission.name).toBe("register-person");
    expect(submission.version).toBe(1);
    expect(submission.payload.displayName).toBe("Amadou Bello");
    expect(submission.payload.branchCode).toBe("DLA");
    expect(submission.payload.personId).toMatch(/^[0-9a-f-]{36}$/);
    // Blank optionals stay out of the payload entirely.
    expect("phone" in submission.payload).toBe(false);
    expect("defaultRole" in submission.payload).toBe(false);

    // The picker selects what it just created, then the dialog steps aside.
    await waitFor(() =>
      expect(onRegistered).toHaveBeenCalledWith(submission.payload.personId),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("carries the optional phone and role when they are filled", async () => {
    const client = fakeClient(committed);
    renderDialog(client);

    await userEvent.type(screen.getByLabelText("Nom complet"), "Estelle Ngo");
    await userEvent.type(screen.getByLabelText("Téléphone"), "699112233");
    await userEvent.click(screen.getByLabelText("Rôle habituel"));
    await userEvent.click(await screen.findByRole("option", { name: "Receveur" }));
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(client.seen).toHaveLength(1));
    const { payload } = client.seen[0] as SeenSubmission;
    expect(payload.phone).toBe("699112233");
    expect(payload.defaultRole).toBe("CONDUCTOR");
  });

  it("a rejected command keeps the dialog open and names the failure", async () => {
    const client = fakeClient({ ok: false, code: "MODULE_DISABLED" });
    const { onRegistered, onOpenChange } = renderDialog(client);

    await userEvent.type(screen.getByLabelText("Nom complet"), "Amadou Bello");
    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(onRegistered).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("refuses to submit a nameless person", async () => {
    const client = fakeClient(committed);
    renderDialog(client);

    await userEvent.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() =>
      expect(screen.getByText("Ce champ est obligatoire.")).toBeTruthy(),
    );
    expect(client.seen).toHaveLength(0);
  });
});
