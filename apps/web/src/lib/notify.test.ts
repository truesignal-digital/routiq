import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/index.js";
import {
  notifyCommandError,
  notifyCommandSuccess,
  notifyCommandWarnings,
} from "./notify.js";

const mocks = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.mock("sonner", () => ({
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

describe("finance command notifications", () => {
  it("localizes success and error messages", () => {
    notifyCommandSuccess("approved");
    notifyCommandError("PERIOD_LOCKED");

    expect(mocks.success).toHaveBeenCalledWith("Entry approved");
    expect(mocks.error).toHaveBeenCalledWith(
      "This period is locked. No postings are possible.",
    );
  });

  it("emits one localized warning toast per stable code", () => {
    notifyCommandWarnings([
      "LATE_POSTING",
      "LATE_POSTING",
      "PERIOD_HAS_SUBMITTED_ENTRIES",
    ]);

    expect(mocks.warning).toHaveBeenCalledTimes(2);
    expect(mocks.warning).toHaveBeenNthCalledWith(
      1,
      "This transaction was posted to a previous accounting period.",
    );
    expect(mocks.warning).toHaveBeenNthCalledWith(
      2,
      "This period contains entries awaiting approval.",
    );
  });
});
