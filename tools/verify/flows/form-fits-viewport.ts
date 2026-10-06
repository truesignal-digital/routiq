import type { Page } from "playwright-core";
import { DEMO_ACCOUNTS, DEMO_WORKSPACE, type DemoAccount } from "../accounts.js";
import type { DriveScript } from "../browser.js";

/**
 * Forms opened from the entry detail fit the window (#470). Opens Edit (the
 * author's pending entry), Reject (a pending entry, as Finance) and Reverse (a
 * posted entry, as Finance) at 1440 × 900, 1366 × 768 and 390 × 844, in French
 * and English, and fails when the form's surface runs past the window, when its
 * title is cut off, or when its submit is off-screen or covered.
 * Read-only: every form is closed without submitting.
 * Run: pnpm verify drive flow:form-fits-viewport
 */
export const FORM_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 390, height: 844 },
] as const;

interface ListedEntry {
  id: string;
  entryNumber: string;
  status: string;
  reversesEntryId: string | null;
  recordedBy: { principalId: string };
}

interface FormCase {
  username: string;
  form: string;
  opener: RegExp;
  pick: (entries: ListedEntry[], me: string) => ListedEntry | undefined;
  status: "SUBMITTED" | "POSTED";
}

const CASES: FormCase[] = [
  {
    username: "sali",
    form: "edit",
    opener: /^(Modifier|Edit)$/,
    status: "SUBMITTED",
    pick: (entries, me) => entries.find((entry) => entry.recordedBy.principalId === me),
  },
  {
    username: "nadege",
    form: "reject",
    opener: /^(Rejeter l'écriture|Reject entry)$/,
    status: "SUBMITTED",
    pick: (entries, me) => entries.find((entry) => entry.recordedBy.principalId !== me),
  },
  {
    username: "nadege",
    form: "reverse",
    opener: /^(Contre-passer l'écriture|Reverse entry)$/,
    status: "POSTED",
    pick: (entries) => entries.find((entry) => entry.reversesEntryId === null),
  },
];

/** What of the open form lies outside the window; empty when it all fits. */
function measureForm(page: Page): Promise<string[]> {
  // tsx names inner functions with a `__name` helper the page doesn't have, so
  // the browser-side code below declares no named functions.
  return page.evaluate(() => {
    const height = window.innerHeight;
    const width = window.innerWidth;
    const popups = [...document.querySelectorAll<HTMLElement>("[role='dialog']")].filter(
      (element) => element.getBoundingClientRect().height > 0,
    );
    const popup = popups.at(-1);
    if (popup === undefined) return ["no form surface is open"];
    const problems: string[] = [];
    const box = popup.getBoundingClientRect();
    const slot = popup.dataset.slot ?? "dialog";
    if (box.top < -1 || box.bottom > height + 1 || box.left < -1 || box.right > width + 1) {
      problems.push(`${slot} spans y ${Math.round(box.top)}–${Math.round(box.bottom)} in a ${height} px window`);
    }
    const title = popup.querySelector<HTMLElement>("[data-slot$='-title']");
    const titleBox = title?.getBoundingClientRect();
    if (titleBox === undefined) problems.push("no title");
    else if (titleBox.top < -1 || titleBox.bottom > height + 1) {
      problems.push(`title at y ${Math.round(titleBox.top)}–${Math.round(titleBox.bottom)}`);
    }
    const submit = popup.querySelector<HTMLElement>("button[type='submit']");
    const submitBox = submit?.getBoundingClientRect();
    if (submit === null || submitBox === undefined) problems.push("no submit");
    else if (submitBox.top < -1 || submitBox.bottom > height + 1) {
      problems.push(`submit "${submit.textContent?.trim()}" at y ${Math.round(submitBox.top)}–${Math.round(submitBox.bottom)}`);
    } else {
      const hit = document.elementFromPoint(submitBox.left + submitBox.width / 2, submitBox.top + submitBox.height / 2);
      // A disabled button takes no pointer events, so the hit is then the
      // footer that holds it; anything else on top means it is covered.
      const reached = hit !== null && (submit.contains(hit) || (hit.contains(submit) && popup.contains(hit)));
      if (!reached) problems.push(`submit "${submit.textContent?.trim()}" is covered`);
    }
    return problems;
  });
}

const flow: DriveScript = async ({ page, shot, quiet, log, apiGet }) => {
  const failures: string[] = [];

  const goTo = async (route: string) => {
    await page.evaluate((to) => {
      window.history.pushState({}, "", to);
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
    }, route);
    await quiet();
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 10_000 }).catch(() => undefined);
    await quiet();
  };

  const signIn = async (account: DemoAccount) => {
    if (!new URL(page.url()).pathname.startsWith("/login")) {
      await page.setViewportSize(FORM_VIEWPORTS[0]);
      await goTo("/more");
      await page.getByRole("main").getByRole("button", { name: /^(Se déconnecter|Sign out)$/ }).click();
      await page.waitForURL((url) => url.pathname === "/login");
    }
    await page.getByLabel(/^(Espace de travail|Workspace)$/).fill(DEMO_WORKSPACE);
    await page.getByLabel(/^(Nom d'utilisateur|Username)$/).fill(account.username);
    await page.getByLabel(/^(Code PIN|PIN code)$/).fill(account.pin);
    await page.getByRole("button", { name: /^(Se connecter|Sign in)$/ }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
    await quiet();
  };

  const chooseLanguage = async (lang: "fr" | "en") => {
    await goTo("/more");
    await page.getByRole("button", { name: lang === "en" ? "English" : "Français", exact: true }).click();
    await page.getByRole("heading", { name: lang === "en" ? "Language" : "Langue" }).waitFor({ timeout: 10_000 });
  };

  let measured = 0;
  let signedIn: string | undefined;
  for (const formCase of CASES) {
    const account = DEMO_ACCOUNTS.find((candidate) => candidate.username === formCase.username);
    if (account === undefined) throw new Error(`no demo account ${formCase.username}`);
    if (signedIn !== account.username) {
      await signIn(account);
      signedIn = account.username;
    }
    const me = (await apiGet("/v1/me")).body as { principalId: string };
    const list = await apiGet(`/v1/finance/entries?status=${formCase.status}`);
    const entries = (list.body as { entries?: ListedEntry[] }).entries ?? [];
    const entry = formCase.pick(entries, me.principalId);
    if (entry === undefined) throw new Error(`${account.username}: no ${formCase.status} entry to ${formCase.form}`);

    for (const lang of ["fr", "en"] as const) {
      await page.setViewportSize(FORM_VIEWPORTS[0]);
      await chooseLanguage(lang);
      for (const viewport of FORM_VIEWPORTS) {
        await page.setViewportSize(viewport);
        await goTo(`/finance/entries/${entry.id}`);
        await page.getByRole("button", { name: formCase.opener }).click();
        await page.getByRole("dialog").last().waitFor({ timeout: 10_000 });
        await page.waitForTimeout(400);
        const problems = await measureForm(page);
        const where = `${formCase.form} ${entry.entryNumber} as ${account.username} ${lang} ${viewport.width}×${viewport.height}`;
        measured += 1;
        if (problems.length > 0) {
          failures.push(`${where}: ${problems.join("; ")}`);
          log(`OFF-SCREEN ${where}: ${problems.join("; ")}`);
        } else {
          log(`ok ${where}`);
        }
        await shot(`${formCase.form}-${lang}-${viewport.width}x${viewport.height}`);
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").last().waitFor({ state: "hidden", timeout: 5_000 }).catch(() => undefined);
      }
    }
  }
  if (measured === 0) throw new Error("no form was measured");
  if (failures.length > 0) throw new Error(`${failures.length} forms past the window; first: ${failures[0]}`);
};

export default flow;
