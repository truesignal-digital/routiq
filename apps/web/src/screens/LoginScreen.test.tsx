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
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useSearch: () => ({ redirect: undefined }),
}));

vi.mock("../auth/api.js", () => ({ login: mocks.login }));

const { LoginScreen } = await import("./LoginScreen.js");

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
});
