import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApprovalChain, ApprovalChainStep } from "@routiq/contracts";
import { i18n } from "../i18n/index.js";
import { ruleHint } from "./chain-text.js";

const chain = (steps: ApprovalChainStep[]): ApprovalChain => ({ commandType: "record-expense", steps });
const normal = chain([
  { upToMinor: 100_000, outcome: "POSTS_DIRECTLY" },
  { upToMinor: 1_000_000, outcome: "FINANCE_APPROVES" },
  { upToMinor: null, outcome: "DIRECTION_APPROVES" },
]);
const hint = (rules: ApprovalChain, amount: number | null = null, lng = "en") =>
  ruleHint(i18n.getFixedT(lng), rules, "XAF", amount).map((sentence) => sentence.replace(/\s/g, " "));

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

describe("the approval hint beside the amount (#534)", () => {
  it("names every band that waits before an amount is typed", () => {
    expect(hint(normal)).toEqual([
      "Above FCFA 100,000, this entry waits for Finance.",
      "Above FCFA 1,000,000, this entry waits for the Director.",
    ]);
  });

  it("names the band the typed amount falls in, bounds included", () => {
    expect(hint(normal, 1_500_000)).toEqual(["Above FCFA 1,000,000, this entry waits for the Director."]);
    expect(hint(normal, 1_000_000)).toEqual(["Above FCFA 100,000, this entry waits for Finance."]);
    expect(hint(normal, 100_001)).toEqual(["Above FCFA 100,000, this entry waits for Finance."]);
    expect(hint(normal, 100_000)).toEqual(["At this amount, the entry posts directly."]);
    expect(hint(normal, 0)).toHaveLength(2);
  });

  it("says when every entry waits, and when none does", () => {
    const always = chain([
      { upToMinor: 1_000_000, outcome: "FINANCE_PEER_APPROVES" },
      { upToMinor: null, outcome: "DIRECTION_APPROVES" },
    ]);
    expect(hint(always)).toEqual([
      "This entry waits for another Finance member or the Director.",
      "Above FCFA 1,000,000, this entry waits for the Director.",
    ]);
    expect(hint(chain([{ upToMinor: null, outcome: "POSTS_DIRECTLY" }]), 5_000_000)).toEqual([
      "Your entries post directly at any amount.",
    ]);
  });

  it("speaks French too", async () => {
    await i18n.changeLanguage("fr-CM");
    expect(hint(normal, 1_500_000, "fr")).toEqual(["Au-delà de 1 000 000 FCFA, cette saisie attend la Direction."]);
    expect(hint(normal, 50_000, "fr")).toEqual(["À ce montant, la saisie est enregistrée directement."]);
    await i18n.changeLanguage("en");
  });
});
