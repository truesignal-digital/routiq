import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright-core";
import type { DriveScript } from "../browser.js";

/**
 * The header with a branch in force stays opaque and keeps its tint under the
 * controls (#57). On Home, in light and dark, with Douala picked:
 * the header's background colour is opaque, its ::before layer is the 5% primary
 * tint covering the header at z-index -10, the controls win the hit test at
 * their centre, and the header's pixels don't change while the page scrolls
 * under it. Then with every branch shown the header is plain again.
 * Checks the run's language and viewport; run it per combination:
 * Run: pnpm verify drive flow:scoped-header --role director --lang en [--viewport 390x844]
 */

/** Home: the longest page a branch-scoped director sees at 1440 × 900 (Douala has one page of entries). */
const ROUTE = "/";
const BRANCH = "Douala";

interface HeaderState {
  scoped: boolean;
  background: string;
  backgroundAlpha: number;
  borderBottom: string;
  before: { content: string; position: string; inset: string; zIndex: string; pointerEvents: string; background: string; width: number; height: number };
  box: { x: number; y: number; width: number; height: number; clientWidth: number; clientHeight: number };
  /** Each visible control in the header: whether a click at its centre lands on it. */
  controls: Array<{ name: string; hit: boolean; landed: string }>;
  /** What the tint should look like: the background colour with the ::before colour drawn over it, as RGBA. */
  expectedTinted: number[];
  expectedPlain: number[];
}

// tsx names inner functions with a `__name` helper the page doesn't have, so
// the browser-side code below declares no named functions.
function readHeader(page: Page): Promise<HeaderState> {
  return page.evaluate(() => {
    const header = document.querySelector<HTMLElement>("header");
    if (header === null) throw new Error("no header");
    const style = getComputedStyle(header);
    const before = getComputedStyle(header, "::before");
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const g = canvas.getContext("2d", { willReadFrequently: true });
    if (g === null) throw new Error("no canvas");
    const [opaque, tinted, plain] = [[style.backgroundColor], [style.backgroundColor, before.backgroundColor], [style.backgroundColor]].map((colours) => {
      g.clearRect(0, 0, 1, 1);
      for (const colour of colours) {
        g.fillStyle = colour;
        g.fillRect(0, 0, 1, 1);
      }
      return Array.from(g.getImageData(0, 0, 1, 1).data);
    });
    const rect = header.getBoundingClientRect();
    const controls = [...header.querySelectorAll<HTMLElement>("button, a[href], [role='combobox']")]
      .filter((control) => control.getBoundingClientRect().width > 0)
      .map((control) => {
        const box = control.getBoundingClientRect();
        const hitAt = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return {
          name: (control.getAttribute("aria-label") ?? control.textContent ?? "").trim().slice(0, 30),
          hit: hitAt !== null && control.contains(hitAt),
          landed: hitAt === null ? "nothing" : `${hitAt.tagName.toLowerCase()}${hitAt === header ? " (the header itself)" : ""}`,
        };
      });
    return {
      scoped: header.dataset.branchScoped === "true",
      background: style.backgroundColor,
      backgroundAlpha: (opaque?.[3] ?? 0) / 255,
      borderBottom: `${style.borderBottomWidth} ${style.borderBottomColor}`,
      before: {
        content: before.content,
        position: before.position,
        inset: [before.top, before.right, before.bottom, before.left].join(" "),
        zIndex: before.zIndex,
        pointerEvents: before.pointerEvents,
        background: before.backgroundColor,
        width: Number.parseFloat(before.width),
        height: Number.parseFloat(before.height),
      },
      box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, clientWidth: header.clientWidth, clientHeight: header.clientHeight },
      controls,
      expectedTinted: tinted ?? [],
      expectedPlain: plain ?? [],
    };
  });
}

/** The header's pixels: a few RGBA samples in its empty top padding, and a fingerprint of the whole strip. */
async function headerPixels(page: Page, box: HeaderState["box"]): Promise<{ samples: number[][]; data: string }> {
  const png = await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
  return page.evaluate(
    async ({ b64, width }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const scale = img.width / width;
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const g = canvas.getContext("2d", { willReadFrequently: true });
      if (g === null) throw new Error("no canvas");
      g.drawImage(img, 0, 0);
      // y = 3 px sits in the padding above every control (they are 44 px tall, centred in 56).
      const samples = [0.35, 0.5, 0.65].map((fraction) =>
        Array.from(g.getImageData(Math.round(width * fraction * scale), Math.round(3 * scale), 1, 1).data),
      );
      return { samples, data: b64 };
    },
    { b64: png.toString("base64"), width: box.width },
  );
}

/** Scrolls the page under the header with the mouse wheel; returns how far the page moved. */
async function scrollUnder(page: Page, pixels: number): Promise<number> {
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error("no viewport");
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await page.mouse.wheel(0, pixels);
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const main = document.querySelector("main");
    let node: HTMLElement | null = main;
    while (node !== null && node !== document.body) {
      if (node.scrollTop > 0) return node.scrollTop;
      node = node.parentElement;
    }
    return document.scrollingElement?.scrollTop ?? 0;
  });
}

/** What sits under the header's empty padding, below the header in the stack: proof the page really is behind it. */
function underHeader(page: Page, box: HeaderState["box"]): Promise<string[]> {
  return page.evaluate(({ x, y }) => {
    const header = document.querySelector("header");
    return document
      .elementsFromPoint(x, y)
      .filter((element) => header !== null && !header.contains(element) && element !== document.body && element !== document.documentElement)
      .slice(0, 3)
      .map((element) => `${element.tagName.toLowerCase()}${element.getAttribute("data-slot") === null ? "" : `[${element.getAttribute("data-slot")}]`}`);
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
}

const close = (a: number[] | undefined, b: number[], within = 2) =>
  a !== undefined && a.length === b.length && a.every((value, index) => Math.abs(value - (b[index] ?? 0)) <= within);

const flow: DriveScript = async ({ page, nav, shot, quiet, t, log, evidenceDir }) => {
  const failures: string[] = [];
  const header = page.locator("header").first();
  const phone = (page.viewportSize()?.width ?? 1440) < 768;
  const size = phone ? "phone" : "desktop";

  const setTheme = async (theme: "light" | "dark") => {
    await header.getByRole("button", { name: t("Thème", "Theme"), exact: true }).click();
    await page.getByRole("menuitemradio", { name: theme === "dark" ? t("Sombre", "Dark") : t("Clair", "Light") }).click();
    await page.waitForFunction((dark) => document.documentElement.classList.contains("dark") === dark, theme === "dark");
    await page.getByRole("menu").waitFor({ state: "hidden" });
  };

  const pickBranch = async (name: string) => {
    await header.getByRole("combobox", { name: t("Agence courante", "Current branch") }).click();
    await page.getByRole("option", { name, exact: true }).click();
    await quiet();
  };

  const check = async (theme: "light" | "dark", scoped: boolean) => {
    const where = `${size} ${theme} ${scoped ? BRANCH : "all branches"}`;
    await nav(ROUTE);
    await page.locator('[data-slot="metric-tile"]').first().waitFor({ timeout: 15_000 });
    await quiet();
    await page.evaluate(() => window.scrollTo(0, 0));
    // The pointer still rests where the theme menu was, which can be over the
    // branch pill; move it off the header so a hover colour isn't compared.
    const viewport = page.viewportSize();
    await page.mouse.move((viewport?.width ?? 0) / 2, (viewport?.height ?? 0) / 2);
    await page.waitForTimeout(300);
    const state = await readHeader(page);
    const top = await headerPixels(page, state.box);
    const moved = await scrollUnder(page, 600);
    const scrolled = await readHeader(page);
    const below = await headerPixels(page, scrolled.box);
    const behind = await underHeader(page, scrolled.box);
    const fail = (reason: string) => {
      failures.push(`${where}: ${reason}`);
      log(`FAIL ${where}: ${reason}`);
    };

    log(`${where}: background ${state.background} (alpha ${state.backgroundAlpha}), border-bottom ${state.borderBottom}`);
    log(`${where}: ::before content ${state.before.content}, ${state.before.position} inset ${state.before.inset}, z-index ${state.before.zIndex}, pointer-events ${state.before.pointerEvents}, background ${state.before.background}, ${state.before.width}x${state.before.height} over a ${state.box.clientWidth}x${state.box.clientHeight} padding box`);
    log(`${where}: scrolled ${moved}px; under the header: ${behind.join(" > ") || "nothing"}`);
    log(`${where}: pixels at the top ${JSON.stringify(top.samples)}, scrolled ${JSON.stringify(below.samples)}; expected ${JSON.stringify(scoped ? state.expectedTinted : state.expectedPlain)}`);
    log(`${where}: controls ${state.controls.map((control) => `${control.name || "?"}=${control.hit ? "hit" : `MISSED (${control.landed})`}`).join(", ")}`);

    if (state.scoped !== scoped) fail(`data-branch-scoped is ${state.scoped}`);
    if (state.backgroundAlpha !== 1 || scrolled.backgroundAlpha !== 1) fail(`background ${state.background} is not opaque`);
    if (moved < 100) fail(`the page only scrolled ${moved}px, nothing passed under the header`);
    if (behind.length === 0) fail("nothing from the page sits under the header after scrolling");
    if (top.data !== below.data) {
      const stem = `header-${size}-${theme}-${scoped ? "scoped" : "all"}`;
      await writeFile(path.join(evidenceDir, `${stem}-top.png`), Buffer.from(top.data, "base64"));
      await writeFile(path.join(evidenceDir, `${stem}-scrolled.png`), Buffer.from(below.data, "base64"));
      fail(`the header's pixels changed while the page scrolled under it (${stem}-top.png vs ${stem}-scrolled.png)`);
    }
    const expected = scoped ? state.expectedTinted : state.expectedPlain;
    for (const sample of [...top.samples, ...below.samples]) {
      if (!close(sample, expected)) fail(`header pixel ${JSON.stringify(sample)} is not the ${scoped ? "tinted" : "plain"} colour ${JSON.stringify(expected)}`);
    }
    if (scoped) {
      const tint = state.before;
      if (tint.content === "none" || tint.position !== "absolute") fail(`::before is not laid out (content ${tint.content}, position ${tint.position})`);
      if (tint.inset !== "0px 0px 0px 0px") fail(`::before inset is ${tint.inset}`);
      if (tint.zIndex !== "-10" || tint.pointerEvents !== "none") fail(`::before z-index ${tint.zIndex}, pointer-events ${tint.pointerEvents}`);
      if (!/\/ 0\.05\)$/.test(tint.background)) fail(`::before background ${tint.background} is not 5% alpha`);
      if (Math.abs(tint.width - state.box.clientWidth) > 0.5 || Math.abs(tint.height - state.box.clientHeight) > 0.5) fail(`::before is ${tint.width}x${tint.height}, the header ${state.box.clientWidth}x${state.box.clientHeight}`);
      if (close(state.expectedTinted, state.expectedPlain, 0)) fail("the tint does not change the header's colour");
      if (!state.borderBottom.startsWith("2px")) fail(`bottom rule is ${state.borderBottom}`);
    } else {
      if (state.before.content !== "none") fail(`::before is laid out on the plain header (content ${state.before.content})`);
      if (!state.borderBottom.startsWith("1px")) fail(`bottom rule is ${state.borderBottom}`);
    }
    if (state.controls.length < 3) fail(`only ${state.controls.length} controls found in the header`);
    for (const control of [...state.controls, ...scrolled.controls]) {
      if (!control.hit) fail(`a click at the centre of "${control.name}" lands on ${control.landed}`);
    }
  };

  await nav(ROUTE);
  await pickBranch(BRANCH);
  for (const theme of ["light", "dark"] as const) {
    await setTheme(theme);
    await check(theme, true);
    await shot(`scoped-${size}-${theme}`, {
      caption: `${BRANCH} in force, ${theme} theme, ${size}: the page scrolled under an opaque, tinted header`,
      highlight: header,
    });
  }

  // The sidebar toggle answers a real click through the tint layer.
  const toggle = header.getByRole("button", { name: t("Afficher ou masquer le menu", "Show or hide the menu") });
  await toggle.click();
  if (phone) {
    await page.locator("[data-slot='sidebar'][data-mobile='true']").waitFor({ timeout: 5_000 });
    await page.keyboard.press("Escape");
    log(`${size}: sidebar toggle opened the menu sheet`);
  } else {
    const collapsed = await page.locator("[data-slot='sidebar'][data-state='collapsed']").count();
    await toggle.click();
    log(`${size}: sidebar toggle ${collapsed > 0 ? "collapsed and reopened the sidebar" : "did not collapse the sidebar"}`);
    if (collapsed === 0) failures.push(`${size}: the sidebar toggle did not collapse the sidebar`);
  }

  await pickBranch(t("Toutes mes agences", "All my branches"));
  for (const theme of ["dark", "light"] as const) {
    await setTheme(theme);
    await check(theme, false);
  }
  await shot(`all-branches-${size}`, {
    caption: `All branches, ${size}: the header is plain again, no tint and no primary rule`,
    highlight: header,
  });

  if (failures.length > 0) throw new Error(`${failures.length} header failures; first: ${failures[0]}`);
};

export default flow;
