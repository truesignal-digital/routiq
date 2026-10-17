import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import type { Page } from "playwright-core";

/** A run of text the eye reads as one piece: all words under one block-level element. */
export interface TextBlock {
  words: number;
  text: string;
}

/** What one screen asks of its reader, measured in the browser. */
export interface ScreenMetrics {
  label: string;
  url: string;
  viewport: { width: number; height: number };
  /** "dialog" when a dialog is open (what the user is reading), else "main" or "body". */
  root: "dialog" | "main" | "body";
  /** Visible words in the root, labels and data together, scrolled or not. */
  words: number;
  /** Words in blocks on screen when measured: what one look takes in. */
  foldWords: number;
  /** Words sitting in blocks of PROSE_MIN_WORDS or more: sentences the user has to read. */
  proseWords: number;
  /** The longest block, in words. */
  longestBlock: number;
  /** The five longest prose blocks, so a reviewer sees the worst offenders; proseWords counts them all. */
  proseBlocks: TextBlock[];
  /** Filled buttons (dark fill, light text): the screen's competing main actions. */
  primaryActions: number;
  primaryLabels: string[];
  /** Controls smaller than the touch minimum (44 px on a phone, 24 px wider than 768 px). */
  smallTargets: number;
  smallTargetLabels: string[];
  /** axe-core WCAG 2.2 A/AA violations by impact; ids of the serious and critical ones. */
  axe: { critical: number; serious: number; moderate: number; minor: number; ids: string[] };
}

export const PROSE_MIN_WORDS = 8;
const DIALOG_SELECTOR = "[role=dialog]:not([aria-modal=false]), [role=alertdialog]:not([aria-modal=false]), dialog[open]";

type InPage = Omit<ScreenMetrics, "label" | "axe"> & {
  /** Elements carrying data-measure-ignore; only prototypes may use it (for their switcher). */
  ignoreMarkers: number;
};

export interface MeasureOptions {
  /** Prototypes may hide their own switcher with data-measure-ignore; on the app the attribute fails the measure. */
  surface: "app" | "prototype";
}

/**
 * Runs inside the page. Self-contained: page.evaluate serializes it, so it
 * may not reference anything outside its own body.
 */
function inPage({ proseMin, dialogSelector: DIALOGS, honourIgnore }: { proseMin: number; dialogSelector: string; honourIgnore: boolean }): InPage {
  const SKIP = `script, style, noscript, svg, [aria-hidden=true], .sr-only${honourIgnore ? ", [data-measure-ignore]" : ""}`;
  const visible = (el: Element): boolean => {
    if (el.closest(".sr-only")) return false;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const INLINE = ["inline", "contents", "inline-block", "inline-flex", "inline-grid"];
  const wordsOf = (text: string) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

  // Base UI toasts are role=dialog with aria-modal=false: the user is still reading the page under them.
  const dialogs = [...document.querySelectorAll(DIALOGS)].filter(visible);
  const dialog = dialogs.at(-1);
  const main = document.querySelector("main");
  const root: Element = dialog ?? (main && visible(main) ? main : document.body);
  const rootKind: InPage["root"] = dialog ? "dialog" : root === main ? "main" : "body";
  // axe reads the same root.
  for (const old of document.querySelectorAll("[data-measure-root]")) old.removeAttribute("data-measure-root");
  root.setAttribute("data-measure-root", "");

  const blockOf = (node: Node): Element | null => {
    let el = node.parentElement;
    while (el && el !== root) {
      // A flex or grid item is blockified, so inline-* here means "sits inside a line of text".
      if (!INLINE.includes(getComputedStyle(el).display)) return el;
      el = el.parentElement;
    }
    return el;
  };
  const blocks = new Map<Element, string[]>();
  const inView = new Map<Element, boolean>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || !node.textContent?.trim()) return NodeFilter.FILTER_REJECT;
      if (parent.closest(SKIP)) return NodeFilter.FILTER_REJECT;
      return visible(parent) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const block = blockOf(node);
    if (!block) continue;
    const list = blocks.get(block) ?? [];
    list.push(node.textContent ?? "");
    blocks.set(block, list);
    if (!inView.has(block)) {
      // Against the window as it is now, so fixed bars and sheets count while they are on screen.
      const r = block.getBoundingClientRect();
      inView.set(block, r.top < window.innerHeight && r.bottom > 0);
    }
  }
  const measured = [...blocks.entries()].map(([block, parts]) => {
    const text = parts.join(" ").replace(/\s+/g, " ").trim();
    return { words: wordsOf(text), text, inView: inView.get(block) ?? false };
  });
  const prose = measured.filter((b) => b.words >= proseMin).sort((a, b) => b.words - a.words);

  // A disabled control or the breadcrumb's current page (aria-disabled) is not a target.
  const interactive = [
    ...document.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=tab], [role=checkbox], [role=radio], [role=switch], [role=menuitem], [role=combobox]"),
  ].filter((el) => root.contains(el) && !el.matches(":disabled, [aria-disabled=true]") && !(honourIgnore && el.closest("[data-measure-ignore]")) && visible(el));
  const nameOf = (el: Element) => (el.getAttribute("aria-label") ?? (el as HTMLElement).innerText ?? el.tagName).replace(/\s+/g, " ").trim().slice(0, 60);

  // Computed colours may be oklch(); a canvas pixel turns any CSS colour into sRGB bytes.
  const paint = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const luminance = (css: string): { l: number; a: number } | null => {
    if (!paint) return null;
    paint.clearRect(0, 0, 1, 1);
    paint.fillStyle = css;
    paint.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 0] = paint.getImageData(0, 0, 1, 1).data;
    const lin = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return { l: 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b), a: a / 255 };
  };
  const primaries = interactive.filter((el) => {
    const style = getComputedStyle(el);
    const bg = luminance(style.backgroundColor);
    const fg = luminance(style.color);
    return bg !== null && fg !== null && bg.a >= 0.9 && bg.l < 0.3 && fg.l > 0.6;
  });

  const minTarget = window.innerWidth < 768 ? 44 : 24;
  // A control whose ::after stretches over a positioned ancestor (a tile's label) is as big as that ancestor.
  const hitBox = (el: Element): DOMRect => {
    const after = getComputedStyle(el, "::after");
    if (after.content !== "none" && after.position === "absolute" && after.inset === "0px") {
      const host = (el as HTMLElement).offsetParent;
      if (host) return host.getBoundingClientRect();
    }
    return el.getBoundingClientRect();
  };
  const small = interactive.filter((el) => {
    const r = hitBox(el);
    if (r.width >= minTarget && r.height >= minTarget) return false;
    // WCAG 2.5.8 exempts a target inside a sentence (a link, or a button styled as one).
    if (INLINE.includes(getComputedStyle(el).display)) {
      const block = blockOf(el);
      if (block && wordsOf((block as HTMLElement).innerText ?? "") >= proseMin) return false;
    }
    return true;
  });

  return {
    url: location.href,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    root: rootKind,
    words: measured.reduce((sum, b) => sum + b.words, 0),
    foldWords: measured.filter((b) => b.inView).reduce((sum, b) => sum + b.words, 0),
    proseWords: prose.reduce((sum, b) => sum + b.words, 0),
    longestBlock: measured.reduce((max, b) => Math.max(max, b.words), 0),
    proseBlocks: prose.slice(0, 5).map(({ words, text }) => ({ words, text })),
    primaryActions: primaries.length,
    primaryLabels: primaries.map(nameOf),
    smallTargets: small.length,
    smallTargetLabels: small.slice(0, 10).map(nameOf),
    ignoreMarkers: document.querySelectorAll("[data-measure-ignore]").length,
  };
}

const require = createRequire(import.meta.url);
let axeSource: string | undefined;

async function runAxe(page: Page): Promise<ScreenMetrics["axe"]> {
  axeSource ??= readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
  if (!(await page.evaluate(() => "axe" in window))) await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => {
    const context = document.querySelector("[data-measure-root]") ?? document.body;
    const axe = (window as unknown as { axe: { run: (ctx: Element, opts: object) => Promise<{ violations: { id: string; impact: string | null }[] }> } }).axe;
    const result = await axe.run(context, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
    const count = (impact: string) => result.violations.filter((v) => v.impact === impact).length;
    return {
      critical: count("critical"),
      serious: count("serious"),
      moderate: count("moderate"),
      minor: count("minor"),
      ids: result.violations.filter((v) => v.impact === "critical" || v.impact === "serious").map((v) => v.id),
    };
  });
}

/** Measures what the user sees right now. Call after the screen has settled. */
export async function measureScreen(page: Page, label: string, options: MeasureOptions): Promise<ScreenMetrics> {
  // A hovered filled button turns translucent and stops reading as primary.
  await page.mouse.move(0, 0);
  // tsx compiles with keepNames, which wraps nested functions in __name(); the page has no such helper.
  await page.evaluate("globalThis.__name ??= (fn) => fn");
  const { ignoreMarkers, ...metrics } = await page.evaluate(inPage, { proseMin: PROSE_MIN_WORDS, dialogSelector: DIALOG_SELECTOR, honourIgnore: options.surface === "prototype" });
  if (options.surface === "app" && ignoreMarkers > 0) {
    throw new Error(`${label}: ${ignoreMarkers} element(s) carry data-measure-ignore in the app; only prototype switchers may use it`);
  }
  return { label, ...metrics, axe: await runAxe(page) };
}
