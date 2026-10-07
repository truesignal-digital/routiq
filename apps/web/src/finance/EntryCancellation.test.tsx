// @vitest-environment jsdom
import type { EntryCancellation } from "@routiq/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { i18n } from "../i18n/index.js";
import {
  EntryEventStatus,
  foldTripEntries,
  isFolded,
  type EventLine,
} from "./EntryCancellation.js";

afterEach(cleanup);
afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

const cancellation: EntryCancellation = {
  entryId: "00000000-0000-4000-8000-000000000009",
  entryNumber: "DLA-2026-00009",
  postingPeriodCode: "2026-10",
  postedAt: "2026-10-03T09:30:00.000Z",
  reasonCode: null,
  reasonText: "Saisie en double",
  recordedBy: { principalId: "00000000-0000-4000-8000-0000000000f1", displayName: "Awa Finance", scope: "WORKSPACE" },
  folded: true,
};

function line(overrides: Partial<EventLine> = {}): EventLine {
  return { status: "REVERSED", cancelledBy: null, cancels: null, ...overrides };
}

const words = {
  en: {
    show: "Show cancellation",
    hide: "Hide cancellation",
    entry: "Cancellation entry DLA-2026-00009",
    reason: "Reason: Saisie en double",
    zero: "Counts as 0 in the totals",
    cancelledIn: "Cancelled in October 2026",
    badge: "Cancellation",
    of: "Cancellation of entry DLA-2026-00008 (May 2026)",
  },
  "fr-CM": {
    show: "Voir l'annulation",
    hide: "Masquer l'annulation",
    entry: "Écriture d'annulation DLA-2026-00009",
    reason: "Motif : Saisie en double",
    zero: "Compte pour 0 dans les totaux",
    cancelledIn: "Annulée en octobre 2026",
    badge: "Annulation",
    of: "Annulation de l'écriture DLA-2026-00008 (mai 2026)",
  },
} as const;

describe("one line per event (#427)", () => {
  for (const locale of ["en", "fr-CM"] as const) {
    const w = words[locale];

    it(`folds a same-month cancellation under its original, who, when and why on demand (${locale})`, async () => {
      await i18n.changeLanguage(locale);
      render(<EntryEventStatus entry={line({ cancelledBy: cancellation })} />);
      expect(screen.queryByText(new RegExp("DLA-2026-00009"))).toBeNull();

      const toggle = screen.getByRole("button", { name: w.show });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      await userEvent.click(toggle);

      expect(screen.getByRole("button", { name: w.hide }).getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === w.entry)).toBeTruthy();
      expect(screen.getByText(new RegExp("Awa Finance"))).toBeTruthy();
      expect(screen.getByText(w.reason)).toBeTruthy();
      expect(screen.getByText(w.zero)).toBeTruthy();
    });

    it(`says the month a later cancellation landed in, and keeps the line counting (${locale})`, async () => {
      await i18n.changeLanguage(locale);
      render(<EntryEventStatus entry={line({ cancelledBy: { ...cancellation, folded: false } })} />);
      expect(screen.getByText(w.cancelledIn)).toBeTruthy();
      expect(screen.queryByRole("button", { name: w.show })).toBeNull();
    });

    it(`names the original and its month on a cancellation's own line (${locale})`, async () => {
      await i18n.changeLanguage(locale);
      render(
        <EntryEventStatus
          entry={line({
            status: "POSTED",
            cancels: {
              entryId: "00000000-0000-4000-8000-000000000008",
              entryNumber: "DLA-2026-00008",
              postingPeriodCode: "2026-05",
            },
          })}
        />,
      );
      expect(screen.getByText(w.badge)).toBeTruthy();
      expect(screen.getByText((_, element) => element?.textContent === w.of && element.tagName === "SPAN")).toBeTruthy();
    });
  }

  it("counts a line as 0 only when its cancellation is folded into it", () => {
    expect(isFolded(line({ cancelledBy: cancellation }))).toBe(true);
    expect(isFolded(line({ cancelledBy: { ...cancellation, folded: false } }))).toBe(false);
    expect(isFolded(line())).toBe(false);
  });

  it("folds a trip's cancellation rows under the originals the card lists", () => {
    const original = { entryId: "o1", reversesEntryId: null, cancelledBy: { ...cancellation, entryId: "c1" } };
    const folded = { entryId: "c1", reversesEntryId: "o1", cancelledBy: null };
    // Its original is outside the reader's slice: the cancellation stays a line.
    const orphan = { entryId: "c2", reversesEntryId: "o2", cancelledBy: null };
    const plain = { entryId: "p1", reversesEntryId: null, cancelledBy: null };
    expect(foldTripEntries([original, folded, orphan, plain]).map((entry) => entry.entryId)).toEqual([
      "o1",
      "c2",
      "p1",
    ]);
  });
});
