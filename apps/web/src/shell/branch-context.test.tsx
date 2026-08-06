// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { i18n } from "../i18n/index.js";

const reference: { current: { data: unknown } } = { current: { data: undefined } };

vi.mock("../assets/reference.js", () => ({
  useAssetRegistrationReference: () => reference.current,
}));

const session: { current: { workspaceSlug: string } | undefined } = {
  current: { workspaceSlug: "transports-ngwa" },
};

vi.mock("../auth/store.js", () => ({
  sessionStore: { getToken: () => "tok" },
  useActiveSession: () => session.current,
}));

const {
  ALL_BRANCHES,
  BranchProvider,
  branchStorageKey,
  resolveCurrentBranchId,
  useAmbientBranchId,
  useCurrentBranch,
  useCurrentBranchCode,
} = await import("./branch-context.js");
const { BranchSwitcher } = await import("./BranchSwitcher.js");

const DLA = { id: "branch-dla", code: "DLA", name: "Douala" };
const YDE = { id: "branch-yde", code: "YDE", name: "Yaoundé" };

function Probe() {
  const { currentBranchId, locked, options } = useCurrentBranch();
  const ambient = useAmbientBranchId();
  const explicit = useAmbientBranchId(YDE.id);
  const code = useCurrentBranchCode();
  return (
    <dl>
      <dd data-testid="current">{currentBranchId}</dd>
      <dd data-testid="locked">{String(locked)}</dd>
      <dd data-testid="options">{options.length}</dd>
      <dd data-testid="ambient">{ambient ?? "none"}</dd>
      <dd data-testid="explicit">{explicit ?? "none"}</dd>
      <dd data-testid="code">{code ?? "none"}</dd>
    </dl>
  );
}

function renderProvider(children: ReactNode = <Probe />) {
  return render(
    <I18nextProvider i18n={i18n}>
      <BranchProvider>{children}</BranchProvider>
    </I18nextProvider>,
  );
}

function withBranches(...branches: Array<{ id: string; code: string; name: string }>) {
  reference.current = { data: { assetClasses: [], branches } };
}

const KEY = branchStorageKey("transports-ngwa");

beforeEach(async () => {
  localStorage.clear();
  session.current = { workspaceSlug: "transports-ngwa" };
  withBranches(DLA, YDE);
  await i18n.changeLanguage("fr-CM");
});

afterEach(cleanup);

describe("resolveCurrentBranchId", () => {
  it("defaults to every branch in scope when nothing was stored", () => {
    expect(resolveCurrentBranchId(null, [DLA, YDE], true)).toBe(ALL_BRANCHES);
  });

  it("keeps a stored branch that is still in scope", () => {
    expect(resolveCurrentBranchId(DLA.id, [DLA, YDE], true)).toBe(DLA.id);
  });

  it("resets a branch that left the scope or was deactivated", () => {
    expect(resolveCurrentBranchId("branch-gone", [DLA, YDE], true)).toBe(ALL_BRANCHES);
  });

  it("locks onto the single branch a one-branch scope has", () => {
    expect(resolveCurrentBranchId(null, [DLA], true)).toBe(DLA.id);
    expect(resolveCurrentBranchId(YDE.id, [DLA], true)).toBe(DLA.id);
  });

  it("honours the stored branch until the branches have loaded", () => {
    // Resetting first would show every branch's rows and narrow one render later.
    expect(resolveCurrentBranchId(DLA.id, [], false)).toBe(DLA.id);
  });
});

describe("BranchProvider", () => {
  it("starts on all my branches", () => {
    renderProvider();

    expect(screen.getByTestId("current").textContent).toBe(ALL_BRANCHES);
    expect(screen.getByTestId("ambient").textContent).toBe("none");
    expect(screen.getByTestId("code").textContent).toBe("none");
    expect(screen.getByTestId("locked").textContent).toBe("false");
  });

  it("reads the branch stored for this workspace", () => {
    localStorage.setItem(KEY, DLA.id);
    renderProvider();

    expect(screen.getByTestId("current").textContent).toBe(DLA.id);
    expect(screen.getByTestId("ambient").textContent).toBe(DLA.id);
    expect(screen.getByTestId("code").textContent).toBe("DLA");
  });

  it("ignores another workspace's stored branch", () => {
    localStorage.setItem(branchStorageKey("autre-espace"), DLA.id);
    renderProvider();

    expect(screen.getByTestId("current").textContent).toBe(ALL_BRANCHES);
  });

  it("persists a switch under the workspace's own key", async () => {
    renderProvider(
      <>
        <Probe />
        <BranchSwitcher />
      </>,
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Agence courante" }));
    await userEvent.click(await screen.findByRole("option", { name: "Yaoundé" }));

    expect(screen.getByTestId("current").textContent).toBe(YDE.id);
    expect(localStorage.getItem(KEY)).toBe(YDE.id);
  });

  it("forgets a stored branch that is no longer in scope", async () => {
    localStorage.setItem(KEY, "branch-deactivated");
    renderProvider();

    expect(screen.getByTestId("current").textContent).toBe(ALL_BRANCHES);
    // Cleared, or it would come back the moment the branch is reactivated.
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("keeps a stored branch while the branches are still loading", () => {
    localStorage.setItem(KEY, DLA.id);
    reference.current = { data: undefined };
    renderProvider();

    expect(screen.getByTestId("current").textContent).toBe(DLA.id);
    expect(localStorage.getItem(KEY)).toBe(DLA.id);
  });

  it("locks a single-branch scope onto its one branch", () => {
    withBranches(DLA);
    renderProvider();

    expect(screen.getByTestId("current").textContent).toBe(DLA.id);
    expect(screen.getByTestId("locked").textContent).toBe("true");
    expect(screen.getByTestId("code").textContent).toBe("DLA");
  });

  it("lets an explicit filter win over the ambient branch", () => {
    localStorage.setItem(KEY, DLA.id);
    renderProvider();

    expect(screen.getByTestId("ambient").textContent).toBe(DLA.id);
    expect(screen.getByTestId("explicit").textContent).toBe(YDE.id);
  });
});

describe("BranchSwitcher", () => {
  it("offers every branch in scope plus all my branches", async () => {
    renderProvider(<BranchSwitcher />);

    await userEvent.click(screen.getByRole("combobox", { name: "Agence courante" }));
    expect(
      (await screen.findAllByRole("option")).map((option) => option.textContent),
    ).toEqual(["Toutes mes agences", "Douala", "Yaoundé"]);
  });

  it("names the choice in English too", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    renderProvider(<BranchSwitcher />);

    await userEvent.click(screen.getByRole("combobox", { name: "Current branch" }));
    expect(
      (await screen.findAllByRole("option")).map((option) => option.textContent),
    ).toEqual(["All my branches", "Douala", "Yaoundé"]);
  });

  it("renders nothing for a single-branch scope", () => {
    withBranches(DLA);
    renderProvider(<BranchSwitcher />);

    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("renders nothing while the branches are still loading", () => {
    reference.current = { data: undefined };
    renderProvider(<BranchSwitcher />);

    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
