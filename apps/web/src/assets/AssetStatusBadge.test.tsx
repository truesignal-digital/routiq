// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { AssetLifecycleStatus } from "@routiq/contracts";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { i18n } from "../i18n/index.js";
import { AssetStatusBadge } from "./AssetStatusBadge.js";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

afterEach(cleanup);

describe("AssetStatusBadge", () => {
  const cases = [
    ["REGISTERED", "bg-foreground/[0.05]", null, "Registered"],
    ["IN_SERVICE", "bg-success/10", "lucide-circle-check", "In service"],
    ["UNDER_MAINTENANCE", "bg-warning/10", "lucide-wrench", "In maintenance"],
    ["SOLD", "bg-foreground/[0.05]", null, "Sold"],
    ["RETIRED", "bg-foreground/[0.05]", null, "Retired"],
    ["WRITTEN_OFF", "bg-destructive/10", "lucide-circle-x", "Written off"],
  ] as const satisfies readonly (readonly [AssetLifecycleStatus, string, string | null, string])[];

  it.each(cases)("shows %s with its one tone, glyph and label", (status, tone, icon, label) => {
    const { container } = render(<AssetStatusBadge status={status} />);
    const badge = container.firstElementChild;

    expect(badge?.className).toContain(tone);
    if (icon === null) expect(badge?.querySelector("svg")).toBeNull();
    else expect(badge?.querySelector(`.${icon}`)).toBeTruthy();
    expect(badge?.textContent).toBe(label);
  });
});
