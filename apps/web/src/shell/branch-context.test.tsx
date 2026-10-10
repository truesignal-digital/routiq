// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { BranchBearing } from "./branch-scope.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nextProvider } from "react-i18next";
import { i18n } from "../i18n/index.js";

const mocks = vi.hoisted(() => ({ toastAdd: vi.fn() }));

vi.mock("@/components/ui/toast.js", () => ({ toast: { add: mocks.toastAdd } }));

interface ReferenceState {
  data: unknown;
  isError: boolean;
  refetch: () => void;
}

const reference: { current: ReferenceState } = {
  current: { data: undefined, isError: false, refetch: vi.fn() },
};

vi.mock("../reference/asset-registration.js", () => ({
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
const { useCreatedElsewhereNotice } = await import("./branch-scope.js");
const { OtherBranchNotice } = await import("./BranchScopeNotices.js");

const DLA = { id: "branch-dla", code: "DLA", name: "Douala" };
const YDE = { id: "branch-yde", code: "YDE", name: "Yaoundé" };

function Probe() {
  const { currentBranchId, locked, options, status, announcement } = useCurrentBranch();
  const ambient = useAmbientBranchId();
  const explicit = useAmbientBranchId(YDE.id);
  const code = useCurrentBranchCode();
  return (
    <dl>
      <dd data-testid="current">{currentBranchId}</dd>
      <dd data-testid="locked">{String(locked)}</dd>
      <dd data-testid="status">{status}</dd>
      <dd data-testid="options">{options.length}</dd>
      <dd data-testid="ambient">{ambient ?? "none"}</dd>
      <dd data-testid="explicit">{explicit ?? "none"}</dd>
      <dd data-testid="code">{code ?? "none"}</dd>
      <dd data-testid="announcement">{announcement}</dd>
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
  reference.current = {
    data: { assetClasses: [], branches },
    isError: false,
    refetch: vi.fn(),
  };
}

function whileLoading() {
  reference.current = { data: undefined, isError: false, refetch: vi.fn() };
}

function withReferenceError() {
  reference.current = { data: undefined, isError: true, refetch: vi.fn() };
}

const KEY = branchStorageKey("transports-ngwa");

beforeEach(async () => {
  localStorage.clear();
  mocks.toastAdd.mockClear();
  session.current = { workspaceSlug: "transports-ngwa" };
  withBranches(DLA, YDE);
  await i18n.changeLanguage("fr-CM");
});

afterEach(cleanup);

describe("resolveCurrentBranchId", () => {
  it("defaults to every branch in scope when nothing was stored", () => {
    expect(resolveCurrentBranchId(null, [DLA, YDE], "ready")).toBe(ALL_BRANCHES);
  });

  it("keeps a stored branch that is still in scope", () => {
    expect(resolveCurrentBranchId(DLA.id, [DLA, YDE], "ready")).toBe(DLA.id);
  });

  it("resets a branch that left the scope or was deactivated", () => {
    expect(resolveCurrentBranchId("branch-gone", [DLA, YDE], "ready")).toBe(
      ALL_BRANCHES,
    );
  });

  it("locks onto the single branch a one-branch scope has", () => {
    expect(resolveCurrentBranchId(null, [DLA], "ready")).toBe(DLA.id);
    expect(resolveCurrentBranchId(YDE.id, [DLA], "ready")).toBe(DLA.id);
  });

  it("honours the stored branch until the branches have loaded", () => {
    // Resetting first would show every branch's rows and narrow one render later.
    expect(resolveCurrentBranchId(DLA.id, [], "loading")).toBe(DLA.id);
  });

  it("drops the stored branch when the branch list failed", () => {
    // Nothing on screen could name or reset a scope resolved against branches
    // that never arrived.
    expect(resolveCurrentBranchId(DLA.id, [], "error")).toBe(ALL_BRANCHES);
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

  it("announces the switch in a toast and to screen readers", async () => {
    renderProvider(
      <>
        <Probe />
        <BranchSwitcher />
      </>,
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Agence courante" }));
    await userEvent.click(await screen.findByRole("option", { name: "Yaoundé" }));

    expect(mocks.toastAdd).toHaveBeenCalledWith({
      type: "info",
      title: "Vous consultez : Yaoundé",
    });
    expect(screen.getByTestId("announcement").textContent).toBe(
      "Vous consultez : Yaoundé",
    );
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
    whileLoading();
    renderProvider();

    expect(screen.getByTestId("current").textContent).toBe(DLA.id);
    expect(localStorage.getItem(KEY)).toBe(DLA.id);
  });

  it("falls back to all my branches when the branch list failed", () => {
    localStorage.setItem(KEY, DLA.id);
    withReferenceError();
    renderProvider();

    expect(screen.getByTestId("status").textContent).toBe("error");
    expect(screen.getByTestId("current").textContent).toBe(ALL_BRANCHES);
    expect(screen.getByTestId("ambient").textContent).toBe("none");
    // The choice survives the outage; only the narrowing is suspended.
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

/** Stands in for a creation form that has settled on a branch. */
function CreationProbe({ record }: { record: BranchBearing }) {
  const noticeFor = useCreatedElsewhereNotice();
  const notice = noticeFor(record);
  return (
    <>
      <span data-testid="notice">{notice?.extraLines?.join("\n") ?? "none"}</span>
      {notice?.action !== undefined && (
        <button type="button" onClick={notice.action.onClick}>
          {notice.action.label}
        </button>
      )}
    </>
  );
}

describe("useCreatedElsewhereNotice", () => {
  it("says nothing when the record lands in the agency on screen", () => {
    localStorage.setItem(KEY, DLA.id);
    renderProvider(<CreationProbe record={{ branchCode: "DLA" }} />);

    expect(screen.getByTestId("notice").textContent).toBe("none");
  });

  it("says nothing while the lens spans every agency", () => {
    renderProvider(<CreationProbe record={{ branchCode: "YDE" }} />);

    expect(screen.getByTestId("notice").textContent).toBe("none");
  });

  it("says nothing before the form has answered which agency", () => {
    localStorage.setItem(KEY, DLA.id);
    renderProvider(<CreationProbe record={{ branchCode: "" }} />);

    expect(screen.getByTestId("notice").textContent).toBe("none");
  });

  it("names the agency a record landed in outside the current lens", () => {
    localStorage.setItem(KEY, DLA.id);
    renderProvider(<CreationProbe record={{ branchCode: "YDE" }} />);

    expect(screen.getByTestId("notice").textContent).toBe(
      "Enregistré dans Yaoundé",
    );
    expect(screen.getByRole("button", { name: "Voir" })).toBeTruthy();
  });

  it("follows the record's agency when the notice is taken up", async () => {
    localStorage.setItem(KEY, DLA.id);
    renderProvider(
      <>
        <Probe />
        <CreationProbe record={{ branchCode: "YDE" }} />
      </>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Voir" }));

    expect(screen.getByTestId("current").textContent).toBe(YDE.id);
  });

  it("offers no follow-up to an agency the switcher cannot hold", () => {
    localStorage.setItem(KEY, DLA.id);
    renderProvider(<CreationProbe record={{ branchId: "branch-gone" }} />);

    // Deactivated, or gone from this member's scope: nothing names it, and
    // switching there would be undone on the next resolve.
    expect(screen.getByTestId("notice").textContent).toBe(
      "Enregistré dans une autre agence",
    );
    expect(screen.queryByRole("button", { name: "Voir" })).toBeNull();
  });
});

describe("OtherBranchNotice", () => {
  it("names the agency a record belongs to", () => {
    localStorage.setItem(KEY, DLA.id);
    renderProvider(<OtherBranchNotice branchCode="YDE" />);

    expect(screen.getByText("Autre agence : Yaoundé")).toBeTruthy();
  });

  it("says only that an unnamed agency holds it, never a blank name", () => {
    localStorage.setItem(KEY, DLA.id);
    renderProvider(<OtherBranchNotice branchId="branch-gone" />);

    expect(screen.getByText("Autre agence")).toBeTruthy();
  });

  it("says nothing about a record the current lens already covers", () => {
    localStorage.setItem(KEY, DLA.id);
    const { container } = renderProvider(<OtherBranchNotice branchCode="DLA" />);

    expect(container.textContent).toBe("");
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

  it("names the sole branch of a single-branch scope without offering a choice", () => {
    withBranches(DLA);
    renderProvider(<BranchSwitcher />);

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByLabelText("Agence courante").textContent).toBe("Douala");
  });

  it("stays on screen with a retry when the branch list failed", async () => {
    withReferenceError();
    renderProvider(<BranchSwitcher />);

    const retry = screen.getByRole("button", { name: "Agences indisponibles" });
    await userEvent.click(retry);

    expect(reference.current.refetch).toHaveBeenCalled();
  });

  it("holds the pill's place while the branches load", () => {
    whileLoading();
    renderProvider(<BranchSwitcher />);

    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText("Agences…")).toBeTruthy();
  });

  it("shows the full scope name on hover when the pill has to cut it short", async () => {
    renderProvider(<BranchSwitcher />);
    const trigger = screen.getByRole("combobox", { name: "Agence courante" });

    expect(trigger.getAttribute("title")).toBe("Toutes mes agences");

    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole("option", { name: "Yaoundé" }));

    expect(trigger.getAttribute("title")).toBe("Yaoundé");
  });

  // #137: the select value is a flex box, and text-overflow never draws an
  // ellipsis on a flex container's own text, so the label clipped mid-word.
  it("puts the label in a block that can end in an ellipsis", () => {
    renderProvider(<BranchSwitcher />);
    const label = screen.getByText("Toutes mes agences");

    expect(label.dataset.slot).not.toBe("select-value");
    expect(label.className.split(" ")).toContain("truncate");
  });

  it("names a single-branch member's agency on hover too", () => {
    withBranches(DLA);
    renderProvider(<BranchSwitcher />);

    expect(screen.getByLabelText("Agence courante").getAttribute("title")).toBe("Douala");
  });

  it("gives the trigger a 44px touch target", () => {
    renderProvider(<BranchSwitcher />);

    expect(
      screen.getByRole("combobox", { name: "Agence courante" }).className,
    ).toContain("h-11");
  });
});
