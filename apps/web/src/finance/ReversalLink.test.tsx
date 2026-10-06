// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/index.js";
import { ReversalLink } from "./ReversalLink.js";

const ENTRY_ID = "00000000-0000-4000-8000-000000000061";

const mocks = vi.hoisted(() => ({ entry: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("./useEntry.js", () => ({ useEntry: mocks.entry }));

afterEach(cleanup);

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

const numbersIn = (element: HTMLElement) =>
  [...element.querySelectorAll("[data-record-number]")].map((node) => node.textContent);

describe("ReversalLink (#442)", () => {
  const cases = [
    ["en", "reverses", "Reverses entry YDE-2026-00012"],
    ["en", "reversedBy", "Reversed by entry YDE-2026-00012"],
    ["fr-CM", "reverses", "Extourne l'écriture YDE-2026-00012"],
    ["fr-CM", "reversedBy", "Extournée par l'écriture YDE-2026-00012"],
  ] as const;

  for (const [language, type, name] of cases) {
    it(`${language} ${type}: one sentence, the number kept whole`, async () => {
      await i18n.changeLanguage(language);
      mocks.entry.mockReturnValue({ data: { entryNumber: "YDE-2026-00012" } });
      render(<ReversalLink entryId={ENTRY_ID} type={type} />);
      const link = screen.getByRole("button", { name });
      expect(numbersIn(link)).toEqual(["YDE-2026-00012"]);
    });
  }
});
