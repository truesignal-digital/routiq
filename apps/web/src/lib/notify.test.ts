import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/index.js";
import { notifyCommandError, notifyCommandSuccess, notifyInfo } from "./notify.js";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
}));

vi.mock("@/components/ui/toast.js", () => ({
  toast: mocks,
}));

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("command notifications", () => {
  it("localizes success and error messages inside its namespace", () => {
    notifyCommandSuccess("finance", "approved");
    notifyCommandError("finance", "PERIOD_LOCKED");

    expect(mocks.add).toHaveBeenNthCalledWith(1, {
      type: "success",
      title: "Entry approved",
    });
    expect(mocks.add).toHaveBeenNthCalledWith(2, {
      type: "error",
      priority: "high",
      title: "This period is locked. No postings are possible.",
    });
  });

  it("reads success keys from the namespace it is given", () => {
    notifyCommandSuccess("assets", "commissioned");
    notifyCommandSuccess("documents", "renewed");

    expect(mocks.add).toHaveBeenNthCalledWith(1, {
      type: "success",
      title: "Asset commissioned",
    });
    expect(mocks.add).toHaveBeenNthCalledWith(2, {
      type: "success",
      title: "Document renewed",
    });
  });

  it("carries deduplicated warnings as description lines on the success toast", () => {
    notifyCommandSuccess("finance", "posted", [
      "LATE_POSTING",
      "LATE_POSTING",
      "EVIDENCE_MISSING",
    ]);

    expect(mocks.add).toHaveBeenCalledOnce();
    expect(mocks.add).toHaveBeenCalledWith({
      type: "success",
      title: "Entry recorded and posted",
      description:
        "The month of this date is locked, so the entry was posted in the current month. It keeps its own date.\n" +
        "Attach the receipt when you have it.",
    });
  });

  // #543: the success toast read like a failure ("Missing evidence: …"). A
  // missing receipt is a reminder, not a problem, in either language.
  it("words a missing receipt on the success toast as a reminder", async () => {
    for (const lng of ["en", "fr"] as const) {
      await i18n.changeLanguage(lng);
      mocks.add.mockClear();
      notifyCommandSuccess("finance", "posted", ["EVIDENCE_MISSING"]);
      const { description } = mocks.add.mock.calls[0]![0] as { description: string };
      expect(description, lng).not.toMatch(/missing|manquant|exige|requires/i);
    }
    await i18n.changeLanguage("en");
  });

  it("falls back to the shared warnings catalog for a code no domain words itself", () => {
    notifyCommandSuccess("maintenance", "assetReleased", ["GROUNDING_ISSUE_STILL_OPEN"]);

    expect(mocks.add).toHaveBeenCalledWith({
      type: "success",
      title: "Asset returned to service",
      description: "Vehicle released, but the problem that grounded it is still open.",
    });
  });

  it("omits the description when a command reports no warnings", () => {
    notifyCommandSuccess("finance", "locked", []);

    expect(mocks.add).toHaveBeenCalledWith({
      type: "success",
      title: "Period locked",
    });
  });

  it("lets a caller add a line of its own and offer one follow-up", () => {
    const onClick = vi.fn();
    notifyCommandSuccess("finance", "posted", ["LATE_POSTING"], {
      extraLines: ["Saved in Yaoundé"],
      action: { label: "View", onClick },
    });

    expect(mocks.add).toHaveBeenCalledWith({
      type: "success",
      // The domain still names the outcome: where a record landed does not
      // cancel what happened to it, so the caller's line joins the warnings.
      title: "Entry recorded and posted",
      description:
        "The month of this date is locked, so the entry was posted in the current month. It keeps its own date.\n" +
        "Saved in Yaoundé",
      actionProps: { children: "View", onClick },
    });
  });

  it("names the record in the title when the caller passes its values", () => {
    notifyCommandSuccess("branches", "created", [], { values: { name: "Kribi" } });
    notifyInfo("branches", "switched", { branch: "Kribi" });

    expect(mocks.add).toHaveBeenNthCalledWith(1, {
      type: "success",
      title: "Branch created: Kribi",
    });
    expect(mocks.add).toHaveBeenNthCalledWith(2, {
      type: "info",
      title: "You are viewing: Kribi",
    });
  });

  it("falls back to the namespace's generic line for an unknown code", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    notifyCommandError("finance", "SOMETHING_NEW");
    notifyCommandSuccess("assets", "teleported");

    expect(mocks.add).toHaveBeenNthCalledWith(1, {
      type: "error",
      priority: "high",
      title: "The action failed. Please try again. (SOMETHING_NEW)",
    });
    // `assets` has no generic of its own, so the shared root block answers.
    expect(mocks.add).toHaveBeenNthCalledWith(2, {
      type: "success",
      title: "Action completed",
    });
  });

  it("gives an info toast with an unknown key a sentence, not the raw key", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    notifyInfo("assets", "missingKey");

    expect(mocks.add).toHaveBeenCalledWith({ type: "info", title: "Noted" });
  });
});
