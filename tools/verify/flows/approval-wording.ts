import { openSidebar, type DriveScript } from "../browser.js";

/**
 * Approval wording (#542): the Money badge counts what the waiting tile counts,
 * an entry above Finance's band says the Director decides, and the vehicle's
 * "Waiting on others" names the Director rather than Finance. Read-only.
 * Run: pnpm verify drive flow:approval-wording --role finance --lang en --reel
 */
const flow: DriveScript = async ({ page, t, nav, shot, quiet, log, apiGet }) => {
  const failures: string[] = [];
  const check = (ok: boolean, what: string) => {
    log(`${ok ? "PASS" : "FAIL"} ${what}`);
    if (!ok) failures.push(what);
  };

  await quiet();
  const counts = (await apiGet("/v1/nav-counts")).body as { moneyWaiting: number | null };
  const summary = (await apiGet("/v1/finance/summary")).body as { waiting: { count: number } | null };
  check(counts.moneyWaiting === summary.waiting?.count, `badge ${counts.moneyWaiting} = tile ${summary.waiting?.count}`);

  await nav("/finance/entries");
  await quiet();
  await openSidebar(page);
  await page.waitForTimeout(400);
  await shot("badge-and-tile", {
    caption: `Money badge and "Waiting for your approval" tile agree: ${counts.moneyWaiting} entries Finance can decide`,
  });
  await page.keyboard.press("Escape");

  const queue = (await apiGet("/v1/finance/approvals?limit=100")).body as {
    entries: Array<{ id: string; entryNumber: string; directionDecides: boolean }>;
  };
  const above = queue.entries.find((entry) => entry.directionDecides);
  check(above !== undefined, "the queue holds an entry above Finance's band");
  if (above === undefined) throw new Error(failures.join("; "));

  await nav(`/finance/entries/${above.id}`);
  await quiet();
  const note = page.getByText(
    t("Au-dessus de votre seuil d'approbation : la Direction décide.", "Above your approval band: the Director decides."),
  );
  await note.waitFor();
  await shot("above-band-entry", {
    caption: `Entry ${above.entryNumber} is above Finance's band: no Approve button, and the page says the Director decides`,
    highlight: note,
  });

  const detail = (await apiGet(`/v1/finance/entries/${above.id}`)).body as {
    postings: Array<{ assetId: string | null }>;
  };
  const assetId = detail.postings.find((line) => line.assetId !== null)?.assetId;
  if (!assetId) throw new Error("the above-band entry is on no vehicle");
  await nav(`/assets/${assetId}`);
  await quiet();
  const waiting = page.getByRole("button", { name: new RegExp(`^${t("En attente des autres", "Waiting on others")}`) });
  await waiting.click();
  const director = page.getByText(t("La Direction", "The Director"), { exact: true }).first();
  await director.waitFor();
  await shot("vehicle-waiting-on", {
    caption: "On the vehicle, the entry above the band waits on the Director, not on Finance",
    highlight: director,
  });

  if (failures.length > 0) throw new Error(failures.join("; "));
};

export default flow;
