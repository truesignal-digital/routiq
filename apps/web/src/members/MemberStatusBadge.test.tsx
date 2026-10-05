// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import type { MemberStatus } from "@routiq/contracts";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { i18n } from "../i18n/index.js";
import { MemberStatusBadge } from "./MemberStatusBadge.js";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

afterEach(cleanup);

describe("MemberStatusBadge", () => {
  const cases = [
    ["ACTIVE", "bg-success/10", "lucide-circle-check", "Active"],
    ["LOCKED", "bg-warning/10", "lucide-lock", "Locked"],
    ["DEACTIVATED", "bg-foreground/[0.05]", null, "Deactivated"],
  ] as const satisfies readonly (readonly [MemberStatus, string, string | null, string])[];

  it.each(cases)("shows %s with its one tone, glyph and label", (status, tone, icon, label) => {
    const { container } = render(<MemberStatusBadge status={status} />);
    const badge = container.firstElementChild;

    expect(badge?.className).toContain(tone);
    if (icon === null) expect(badge?.querySelector("svg")).toBeNull();
    else expect(badge?.querySelector(`.${icon}`)).toBeTruthy();
    expect(badge?.textContent).toBe(label);
  });
});
