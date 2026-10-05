// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/index.js";
import { DocumentStatusBadge, documentIconTone } from "./DocumentStatusBadge.js";

beforeAll(async () => {
  await i18n.changeLanguage("en");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 4, 12));
});

afterAll(async () => {
  vi.useRealTimers();
  await i18n.changeLanguage("fr-CM");
});

afterEach(cleanup);

const doc = (expiresAt: string | null, supersededByDocumentId: string | null = null) => ({
  expiresAt,
  supersededByDocumentId,
});

describe("DocumentStatusBadge", () => {
  const cases = [
    ["replaced", doc("2027-01-01", "d2"), "bg-foreground/[0.05]", null, "Replaced"],
    ["expired", doc("2026-10-01"), "bg-destructive/10", "lucide-circle-x", "Expired"],
    ["expiring soon", doc("2026-10-14"), "bg-warning/10", "lucide-clock", "Expires in 10 days"],
    ["valid", doc("2027-06-30"), "bg-success/10", "lucide-circle-check", "Valid"],
    ["without expiry", doc(null), "bg-foreground/[0.05]", "lucide-circle", "No expiry date"],
  ] as const;

  it.each(cases)("shows a %s document with its one tone, glyph and label", (_, document, tone, icon, label) => {
    const { container } = render(<DocumentStatusBadge doc={document} />);
    const badge = container.firstElementChild;

    expect(badge?.className).toContain(tone);
    if (icon === null) expect(badge?.querySelector("svg")).toBeNull();
    else expect(badge?.querySelector(`.${icon}`)).toBeTruthy();
    expect(badge?.textContent).toBe(label);
  });

  it("raises a row icon only for an expired or expiring document", () => {
    expect(documentIconTone("expired")).toBe("danger");
    expect(documentIconTone("expiringSoon")).toBe("warning");
    expect(documentIconTone("ok")).toBe("neutral");
    expect(documentIconTone("none")).toBe("neutral");
  });
});
