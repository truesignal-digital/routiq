import { createElement, type ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import type { CommandResult, CommandSubmission } from "@routiq/contracts";
import type { CommandClient, SubmitResult } from "../commands/client.js";
import { commandLabelKeys, type CommandName } from "../commands/labels.js";
import { i18n } from "../i18n/index.js";
import { errorMessage } from "../lib/error-message.js";


export interface FormUnderTest {
  command: CommandName;
  version?: number;
  /** The form, writing through `client`; `onDismiss` is how it closes. */
  render(props: { client: CommandClient; onDismiss: () => void }): ReactElement;
  /** Checks the pinned context and the defaults the form opened with. */
  opened(): void | Promise<void>;
  /** A form that opens filled (an edit of current values) empties its fields here, before the empty submit. */
  empty?(user: UserEvent): Promise<void>;
  /** Fills every required field with valid values. */
  fill(user: UserEvent): Promise<void>;
  /** Exactly what a valid fill sends; asymmetric matchers for minted ids. */
  payload: Record<string, unknown>;
  /** A refusal this form shows as a banner over its fields. */
  refusal?: string;
}

/** A command client that records what it was given and answers `result`. */
export function fakeClient(result: SubmitResult = committed()): CommandClient & { seen: CommandSubmission<unknown>[] } {
  const seen: CommandSubmission<unknown>[] = [];
  return {
    seen,
    submit: async (submission) => {
      seen.push(submission);
      return result;
    },
  };
}

export function committed(outcome: Partial<CommandResult> = {}): SubmitResult {
  return {
    ok: true,
    outcome: { commandId: "c1", recordId: "r1", rowVersion: 1, warnings: [], idempotentReplay: false, ...outcome },
  };
}

/**
 * The six tests every command form passes (docs/design/consistency/README.md,
 * "Recipe: a new form"), in English.
 */
export function describeCommandForm(name: string, form: FormUnderTest): void {
  describe(`${name}: the six command-form tests`, () => {
    // Watches the toast manager lib/notify.ts writes to; forms never import it.
    let toasts: MockInstance;
    beforeAll(async () => {
      const { toast } = await import("../components/ui/toast.js");
      toasts = vi.spyOn(toast, "add");
      await i18n.changeLanguage("en");
    });
    afterAll(async () => {
      toasts.mockRestore();
      await i18n.changeLanguage("fr-CM");
    });
    afterEach(() => {
      cleanup();
      toasts.mockClear();
    });

    function open(result?: SubmitResult) {
      const client = fakeClient(result);
      const onDismiss = vi.fn();
      render(
        createElement(QueryClientProvider, { client: new QueryClient() }, form.render({ client, onDismiss })),
      );
      return { client, onDismiss, user: userEvent.setup() };
    }

    const submit = () => screen.getByRole("button", { name: i18n.t(commandLabelKeys(form.command, "submit")) });

    it("opens with the pinned context and defaults", async () => {
      open();
      await form.opened();
    });

    it("shows what to fix when submitted empty, and sends nothing", async () => {
      const { client, user } = open();
      await form.empty?.(user);
      await user.click(submit());
      const summary = await screen.findByRole("region", { name: /things? to fix/ });
      const [first] = within(summary).getAllByRole("button");
      await user.click(first!);
      await waitFor(() =>
        expect(document.activeElement?.matches("input, textarea, select, button[role=combobox]")).toBe(true),
      );
      expect(summary.contains(document.activeElement)).toBe(false);
      expect(client.seen).toHaveLength(0);
    });

    it("sends exactly the expected payload through the command client", async () => {
      const { client, user } = open();
      await form.fill(user);
      await user.click(submit());
      await waitFor(() => expect(client.seen).toHaveLength(1));
      expect(client.seen[0]).toMatchObject({ name: form.command, version: form.version ?? 1 });
      expect(client.seen[0]?.payload).toEqual(form.payload);
    });

    it("shows a refusal as a banner and keeps the values", async () => {
      const code = form.refusal ?? "ROLE_FORBIDDEN";
      const { user } = open({ ok: false, code });
      await form.fill(user);
      const before = fieldValues();
      await user.click(submit());
      expect(await screen.findByText(errorMessage(i18n, code))).toBeTruthy();
      expect(fieldValues()).toEqual(before);
    });

    it("replaces the form with Refresh on VERSION_CONFLICT", async () => {
      const { user } = open({ ok: false, code: "VERSION_CONFLICT" });
      await form.fill(user);
      await user.click(submit());
      expect(await screen.findByRole("button", { name: i18n.t("commandForm.reload") })).toBeTruthy();
      expect(screen.queryByRole("button", { name: i18n.t(commandLabelKeys(form.command, "submit")) })).toBeNull();
    });

    it("closes and toasts on success", async () => {
      const { onDismiss, user } = open();
      await form.fill(user);
      await user.click(submit());
      await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
      expect(toasts).toHaveBeenCalledTimes(1);
      expect(toasts).toHaveBeenCalledWith(expect.objectContaining({ type: "success" }));
    });
  });
}

function fieldValues(): string[] {
  return [...document.querySelectorAll<HTMLInputElement>("form input, form textarea")].map((field) => field.value);
}
