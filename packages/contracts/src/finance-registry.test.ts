import { describe, expect, it } from "vitest";
import { COMMAND_ERROR_CODES, COMMAND_WARNING_CODES } from "./errors.js";
import { MODULE_CODES } from "./modules.js";

describe("financial-core public registry", () => {
  it("exposes the finance module and the stable finance error vocabulary", () => {
    expect(MODULE_CODES).toContain("FINANCE");
    expect(COMMAND_ERROR_CODES).toEqual(
      expect.arrayContaining([
        "POSTINGS_SUM_MISMATCH",
        "MAKER_CANNOT_APPROVE",
        "ENTRY_ALREADY_REVERSED",
        "ENTRY_IS_REVERSAL",
        "PERIOD_LOCKED",
        "CATEGORY_KIND_MISMATCH",
      ]),
    );
    expect(COMMAND_WARNING_CODES).toEqual(
      expect.arrayContaining([
        "EVIDENCE_MISSING",
        "LATE_POSTING",
        "PERIOD_HAS_SUBMITTED_ENTRIES",
      ]),
    );
  });
});
