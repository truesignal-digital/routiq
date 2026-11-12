// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { sessionStore } from "../auth/store.js";
import { i18n } from "../i18n/index.js";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  login: vi.fn(),
  search: { redirect: undefined as string | undefined },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useSearch: () => mocks.search,
}));

vi.mock("../auth/api.js", () => ({ login: mocks.login }));

const { LoginScreen } = await import("./LoginScreen.js");
const { clearSessionEndedNotice, endSessionIfSignedOut } = await import("../auth/sign-out.js");

function renderLogin(client = new QueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <LoginScreen />
    </QueryClientProvider>,
  );
  return client;
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.search.redirect = undefined;
});

afterEach(() => {
  sessionStore.logout({ username: "amina", workspaceSlug: "sotrafret" });
  cleanup();
});

describe("login form", () => {
  it("reports an empty field through the form's own message, without calling the API", async () => {
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText("Workspace"), "sotrafret");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(screen.getAllByText("This field is required.")).toHaveLength(2),
    );
    expect(mocks.login).not.toHaveBeenCalled();
    // The message belongs to the field it describes.
    expect(screen.getByLabelText("Username").getAttribute("aria-invalid")).toBe(
      "true",
    );
  });

  it("shows a rejected sign-in as a localized banner and clears the PIN", async () => {
    mocks.login.mockResolvedValue({ ok: false, code: "AUTH_FAILED" });
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText("Workspace"), "sotrafret");
    await user.type(screen.getByLabelText("Username"), "amina");
    const pin = screen.getByLabelText("PIN code");
    await user.type(pin, "1234");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain(
      "Incorrect workspace, username, or PIN.",
    );
    expect((pin as HTMLInputElement).value).toBe("");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("saves the session, forgets reads from any earlier session, and lands on the home screen", async () => {
    mocks.login.mockResolvedValue({
      ok: true,
      session: {
        username: "amina",
        workspaceSlug: "sotrafret",
        token: "token",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    const user = userEvent.setup();
    const client = new QueryClient();
    // An expired session never signed out: its profile is still cached.
    client.setQueryData(["ws", "sotrafret", "me"], { role: "ADMIN" });
    renderLogin(client);

    await user.type(screen.getByLabelText("Workspace"), "sotrafret");
    await user.type(screen.getByLabelText("Username"), "amina");
    await user.type(screen.getByLabelText("PIN code"), "1234");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledWith({ to: "/" }),
    );
    expect(client.getQueryData(["ws", "sotrafret", "me"])).toBeUndefined();
    expect(mocks.login).toHaveBeenCalledWith({
      workspaceSlug: "sotrafret",
      username: "amina",
      pin: "1234",
    });
  });

  it.each([
    ["the member whose session ended returns to the kept page", "amina", "/finance/entries"],
    ["someone else starts on the home screen", "herve", "/"],
  ])("after a 401 %s", async (_case, username, landing) => {
    sessionStore.save({
      username: "amina",
      workspaceSlug: "sotrafret",
      token: "revoked",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    endSessionIfSignedOut(new QueryClient(), "MEMBERS_401");
    mocks.search.redirect = "/finance/entries";
    mocks.login.mockResolvedValue({
      ok: true,
      session: { username, workspaceSlug: "sotrafret", token: "token", expiresAt: new Date(Date.now() + 60_000).toISOString() },
    });
    const user = userEvent.setup();
    renderLogin();

    await user.clear(screen.getByLabelText("Username"));
    await user.type(screen.getByLabelText("Username"), username);
    await user.type(screen.getByLabelText("PIN code"), "1234");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: landing }));
    sessionStore.logout({ username, workspaceSlug: "sotrafret" });
  });

  it.each([
    [61, "Try again in 2 minutes"],
    [60, "Try again in 1 minute,"],
    [5, "Try again in 1 minute,"],
  ])("says how long a lock lasts (%i s) and that an administrator can reset the PIN", async (seconds, wait) => {
    mocks.login.mockResolvedValue({ ok: false, code: "AUTH_LOCKED", retryAfterSeconds: seconds });
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText("Workspace"), "sotrafret");
    await user.type(screen.getByLabelText("Username"), "amina");
    await user.type(screen.getByLabelText("PIN code"), "1234");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain(wait);
    expect(banner.textContent).toContain("ask an administrator to reset your PIN");
  });

  it("says the last session ended when a 401 sent the member here", () => {
    sessionStore.save({
      username: "amina",
      workspaceSlug: "sotrafret",
      token: "revoked",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    endSessionIfSignedOut(new QueryClient(), "MEMBERS_401");
    renderLogin();
    expect(screen.getByRole("status").textContent).toBe("Your session ended. Sign in again.");
    clearSessionEndedNotice();
  });

  it("shows no session notice on an ordinary visit", () => {
    renderLogin();
    expect(screen.queryByText("Your session ended. Sign in again.")).toBeNull();
  });
});
