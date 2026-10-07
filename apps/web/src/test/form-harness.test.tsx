// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { z } from "zod";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CommandClient } from "../commands/client.js";
import { CommandForm } from "../components/command-form.js";
import { useCommandForm } from "../components/use-command-form.js";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../components/ui/form.js";
import { Input } from "../components/ui/input.js";
import { i18n } from "../i18n/index.js";
import { describeCommandForm, fakeClient } from "./form-harness.js";

const fixturePayload = z.strictObject({
  branchId: z.uuid(),
  code: z.string().trim().min(1).max(8),
  name: z.string().trim().min(1).max(120),
});

/** The smallest form on the hook: a pinned id and two required fields. */
function FixtureForm({ client, onDismiss }: { client: CommandClient; onDismiss: () => void }) {
  const { form, formProps } = useCommandForm(fixturePayload, "create-branch", 1, {
    defaults: () => ({ branchId: crypto.randomUUID(), code: "", name: "" }),
    success: { namespace: "branches", message: "created" },
    onDismiss,
    client,
  });
  return (
    <CommandForm surface="dialog" title="Open a branch" {...formProps}>
      <Form {...form}>
        {(["code", "name"] as const).map((name) => (
          <FormField
            key={name}
            control={form.control}
            name={name}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{name === "code" ? "Code" : "Name"}</FormLabel>
                <FormControl>
                  <Input {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ))}
      </Form>
    </CommandForm>
  );
}

describeCommandForm("FixtureForm", {
  command: "create-branch",
  render: (props) => <FixtureForm {...props} />,
  opened: () => {
    expect(screen.getByRole("dialog", { name: "Open a branch" })).toBeTruthy();
    expect((screen.getByLabelText("Code") as HTMLInputElement).value).toBe("");
  },
  fill: async (user) => {
    await user.type(screen.getByLabelText("Code"), "kri ");
    await user.type(screen.getByLabelText("Name"), " Kribi");
  },
  payload: { branchId: expect.any(String), code: "kri", name: "Kribi" },
});

describe("useCommandForm", () => {
  beforeAll(() => i18n.changeLanguage("en"));
  afterAll(() => i18n.changeLanguage("fr-CM"));
  afterEach(cleanup);

  function open(client: CommandClient) {
    return render(
      <QueryClientProvider client={new QueryClient()}>
        <FixtureForm client={client} onDismiss={vi.fn()} />
      </QueryClientProvider>,
    );
  }

  it("counts what to fix, names each field, and moves focus to the one picked", async () => {
    const user = userEvent.setup();
    open(fakeClient());
    await user.click(screen.getByRole("button", { name: "Create branch" }));
    const summary = await screen.findByRole("region", { name: "2 things to fix" });
    expect(document.activeElement).toBe(summary);
    const links = within(summary).getAllByRole("button");
    expect(links.map((link) => link.textContent)).toEqual([
      "Code: This field is required.",
      "Name: This field is required.",
    ]);
    await user.click(links[1]!);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Name")));
    await user.type(screen.getByLabelText("Name"), "Kribi");
    expect(await screen.findByRole("region", { name: "1 thing to fix" })).toBeTruthy();
  });

  it("says the contract's bounds in the reader's words, in French too", async () => {
    await i18n.changeLanguage("fr-CM");
    const user = userEvent.setup();
    open(fakeClient());
    await user.type(screen.getByLabelText("Code"), "TOOLONGCODE");
    await user.type(screen.getByLabelText("Name"), "Kribi");
    await user.click(screen.getByRole("button", { name: "Créer l'agence" }));
    const summary = await screen.findByRole("region", { name: "1 point à corriger" });
    expect(within(summary).getByRole("button").textContent).toBe("Code : Au plus 8 caractères.");
    await i18n.changeLanguage("en");
  });

  it("retries a network failure with the same ids, and mints new ones when reopened", async () => {
    const user = userEvent.setup();
    const offline = fakeClient({ ok: false, code: "NETWORK_ERROR" });
    open(offline);
    await user.type(screen.getByLabelText("Code"), "KRI");
    await user.type(screen.getByLabelText("Name"), "Kribi");
    await user.click(screen.getByRole("button", { name: "Create branch" }));
    await waitFor(() => expect(offline.seen).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: "Create branch" }));
    await waitFor(() => expect(offline.seen).toHaveLength(2));
    const [first, retry] = offline.seen;
    expect(retry?.envelope).toEqual(first?.envelope);
    expect(retry?.payload).toEqual(first?.payload);
    cleanup();

    const reopened = fakeClient({ ok: false, code: "NETWORK_ERROR" });
    open(reopened);
    await user.type(screen.getByLabelText("Code"), "KRI");
    await user.type(screen.getByLabelText("Name"), "Kribi");
    await user.click(screen.getByRole("button", { name: "Create branch" }));
    await waitFor(() => expect(reopened.seen).toHaveLength(1));
    const [again] = reopened.seen;
    expect(again?.envelope.commandId).not.toBe(first?.envelope.commandId);
    expect(again?.envelope.idempotencyKey).not.toBe(first?.envelope.idempotencyKey);
    expect((again?.payload as { branchId: string }).branchId).not.toBe((first?.payload as { branchId: string }).branchId);
  });
});
