// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MemberListItem } from "@routiq/contracts";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/index.js";
import { committed, describeCommandForm, fakeClient } from "../test/form-harness.js";
import {
  LinkPersonLoginForm,
  loginChoices,
  UnlinkPersonLoginForm,
  type LoginChoice,
} from "./PersonLoginForms.js";

const PERSON_ID = "11111111-1111-4111-8111-111111111111";
const SALI = "22222222-2222-4222-8222-222222222222";
const PAUL = "33333333-3333-4333-8333-333333333333";

const unlinked = { id: PERSON_ID, displayName: "Sali Ngono", rowVersion: 3, loginPrincipalId: null };
const logins: LoginChoice[] = [
  { principalId: SALI, displayName: "Sali Ngono", username: "sali" },
  { principalId: PAUL, displayName: "Paul Etoundi", username: "paul" },
];

describeCommandForm("LinkPersonLoginForm", {
  command: "link-person-login",
  render: ({ client, onDismiss }) => (
    <LinkPersonLoginForm person={unlinked} logins={logins} client={client} onDismiss={onDismiss} />
  ),
  opened: () => {
    expect(screen.getByText("Sali Ngono", { selector: "[data-slot=form-pinned] *" })).toBeTruthy();
    expect(screen.getAllByRole("radio").every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
  },
  fill: async (user) => {
    await user.click(screen.getByLabelText("Sali Ngono (sali)"));
  },
  payload: { personId: PERSON_ID, principalId: SALI },
  refusal: "LOGIN_ALREADY_LINKED",
});

describe("person login forms (#569)", () => {
  beforeAll(() => i18n.changeLanguage("en"));
  afterAll(() => i18n.changeLanguage("fr-CM"));
  afterEach(cleanup);

  function open(element: React.ReactElement) {
    render(<QueryClientProvider client={new QueryClient()}>{element}</QueryClientProvider>);
    return userEvent.setup();
  }

  it("links at the person's version, so a stale screen cannot overwrite someone else's change", async () => {
    const client = fakeClient();
    const onDone = vi.fn();
    const user = open(
      <LinkPersonLoginForm person={unlinked} logins={logins} client={client} onDone={onDone} onDismiss={vi.fn()} />,
    );

    await user.click(screen.getByLabelText("Paul Etoundi (paul)"));
    await user.click(screen.getByRole("button", { name: "Link login" }));

    await waitFor(() => expect(client.seen).toHaveLength(1));
    expect(client.seen[0]).toMatchObject({
      name: "link-person-login",
      version: 1,
      payload: { personId: PERSON_ID, principalId: PAUL },
      envelope: { expectedVersion: 3 },
    });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("calls a person with a login a change of login, through the same command", async () => {
    const client = fakeClient();
    const user = open(
      <LinkPersonLoginForm
        person={{ ...unlinked, loginPrincipalId: SALI }}
        logins={logins.filter((login) => login.principalId !== SALI)}
        client={client}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Change login" })).toBeTruthy();
    await user.click(screen.getByLabelText("Paul Etoundi (paul)"));
    await user.click(screen.getByRole("button", { name: "Change login" }));

    await waitFor(() => expect(client.seen).toHaveLength(1));
    expect(client.seen[0]).toMatchObject({ name: "link-person-login", payload: { principalId: PAUL } });
  });

  it("says so when no login is left to link, instead of an empty choice", () => {
    open(<LinkPersonLoginForm person={unlinked} logins={[]} client={fakeClient()} onDismiss={vi.fn()} />);

    expect(screen.getByText("No login is free to link. Add the user first, under Users.")).toBeTruthy();
  });

  it("unlinks as a decision on the person, at their version, then closes and toasts", async () => {
    const client = fakeClient(committed({ rowVersion: 4 }));
    const onDismiss = vi.fn();
    const onDone = vi.fn();
    const user = open(
      <UnlinkPersonLoginForm
        person={{ ...unlinked, loginPrincipalId: SALI }}
        loginLabel="Sali Ngono (sali)"
        client={client}
        onDone={onDone}
        onDismiss={onDismiss}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Unlink login" });
    expect(dialog.textContent).toContain("Sali Ngono (sali)");
    await user.click(screen.getByRole("button", { name: "Unlink login" }));

    await waitFor(() => expect(client.seen).toHaveLength(1));
    expect(client.seen[0]).toMatchObject({
      name: "unlink-person-login",
      version: 1,
      payload: { personId: PERSON_ID },
      envelope: { expectedVersion: 3 },
    });
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
    expect(onDone).toHaveBeenCalled();
  });

  it("shows a refusal to unlink in the dialog", async () => {
    const user = open(
      <UnlinkPersonLoginForm
        person={{ ...unlinked, loginPrincipalId: SALI }}
        loginLabel="Sali Ngono (sali)"
        client={fakeClient({ ok: false, code: "MEMBER_ROLE_NOT_GRANTABLE" })}
        onDismiss={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Unlink login" }));

    expect(await screen.findByText("You cannot give or remove this role. Ask a Director.")).toBeTruthy();
  });
});

describe("loginChoices", () => {
  const member = (overrides: Partial<MemberListItem>): MemberListItem => ({
    principalId: SALI,
    displayName: "Sali Ngono",
    username: "sali",
    role: "DRIVER",
    branchScope: ["b1"],
    status: "ACTIVE",
    rowVersion: 1,
    createdAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  });
  const admin = { principalId: "admin", role: "ADMIN" as const, branchScope: ["b1"] };

  it("offers the logins the actor may manage, with a username, held by nobody else", () => {
    const members = [
      member({}),
      member({ principalId: PAUL, displayName: "Paul Etoundi", username: "paul" }),
      member({ principalId: "fin", displayName: "Finance", username: "fin", role: "FINANCE" }),
      member({ principalId: "far", displayName: "Far", username: "far", branchScope: ["b2"] }),
      member({ principalId: "nologin", displayName: "No login", username: null }),
      member({ principalId: "gone", displayName: "Gone", username: "gone", status: "DEACTIVATED" }),
      member({ principalId: "taken", displayName: "Taken", username: "taken" }),
    ];

    const choices = loginChoices(members, admin, { current: SALI, taken: new Set(["taken"]) });

    expect(choices).toEqual([{ principalId: PAUL, displayName: "Paul Etoundi", username: "paul" }]);
  });
});
