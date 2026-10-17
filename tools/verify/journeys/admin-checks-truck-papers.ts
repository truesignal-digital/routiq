import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";
import { openVehicle } from "./admin-checks-truck.js";

export const journey: Journey = {
  id: "admin-checks-truck-papers",
  actor: { role: "admin", person: "The Administrateur (chef d'agence), at the depot gate" },
  arrangeAs: "admin",
  goal: "see whether one truck's papers are in order: what is valid, what expires, what has no scan",
  trigger: "A checkpoint stop, or a driver asking before a long trip, for VH003",
  frequency: "Weekly",
  device: { viewport: { width: 390, height: 844 }, throttle: "phone" },
  doneWhen: "VH003's Documents tab lists every current paper GET /v1/assets/:id/documents returns, each with its number",
  firstGlance: {
    purpose: "This truck's papers",
    state: "Each paper's state and expiry; which have no scan",
    nextAction: "Renew a paper that expires, or add a missing one",
  },
  budgets: {
    taps: 1,
    seconds: 8,
    // Read at a gate on a phone: each paper's name, state and date.
    wordsPerScreen: 160,
    foldWordsPerScreen: 80,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/**
 * Read-only.
 * Run: pnpm verify drive journey:admin-checks-truck-papers --role admin --viewport 390x844 --throttle phone --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, apiGet, log } = ctx;
  assertStartedAs(ctx, journey);
  await ctx.quiet();
  const id = await openVehicle(ctx, "VH003");
  const run = journeyRunner(ctx, journey);
  await run.screen("vehicle-now", "VH003's Overview on the Administrateur's phone");

  const sections = page.getByRole("navigation", { name: t("Sections du véhicule", "Vehicle sections") });
  await run.tap(sections.getByRole("tab", { name: /^Documents/ }));
  await page.waitForURL((url) => url.pathname.endsWith("/documents"));
  await ctx.quiet();
  await run.screen("documents", "VH003's papers");

  const read = await apiGet(`/v1/assets/${id}/documents`);
  const docs = (read.body as { documents?: { documentNumber: string | null; supersededByDocumentId: string | null }[] }).documents ?? [];
  const current = docs.filter((doc) => doc.supersededByDocumentId === null);
  if (read.status !== 200 || current.length === 0) throw new Error(`GET /v1/assets/${id}/documents → ${read.status}, ${current.length} current`);
  const text = (await page.locator("main").textContent()) ?? "";
  const missing = current.filter((doc) => doc.documentNumber !== null && !text.includes(doc.documentNumber));
  if (missing.length > 0) throw new Error(`Documents tab does not show ${missing.map((doc) => doc.documentNumber).join(", ")}`);
  log(`api cross-check: ${current.length} current papers listed`);
  run.finish();
};

export default drive;
