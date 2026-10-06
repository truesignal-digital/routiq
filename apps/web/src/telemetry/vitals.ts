import type { VITAL_NAMES } from "@routiq/contracts";
import { navigationEntry, toMs } from "./collect.js";

export type VitalName = (typeof VITAL_NAMES)[number];

export interface Vitals {
  /** After the load event: TTFB comes from the navigation entry. */
  afterLoad(): void;
  /** The page is being hidden: LCP, CLS and INP are final. */
  onHidden(): void;
  stop(): void;
}

/** Event Timing's option, missing from the DOM lib. */
type ObserverInit = PerformanceObserverInit & { durationThreshold?: number };

interface LayoutShift extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

/**
 * Core Web Vitals from PerformanceObserver alone, each reported at most once.
 * Older Android WebViews lack some entry types, so each observer may fail on
 * its own without taking the others down.
 */
export function observeVitals(report: (name: VitalName, value: number) => void): Vitals {
  const reported = new Set<VitalName>();
  const observers: PerformanceObserver[] = [];
  const once = (name: VitalName, value: number) => {
    if (reported.has(name)) return;
    reported.add(name);
    report(name, name === "CLS" ? Math.round(value * 10_000) / 10_000 : toMs(value));
  };

  function observe(init: ObserverInit, onEntries: (entries: PerformanceEntryList) => void): boolean {
    try {
      if (typeof PerformanceObserver === "undefined") return false;
      if (init.type !== undefined && !PerformanceObserver.supportedEntryTypes?.includes(init.type)) return false;
      const observer = new PerformanceObserver((list) => {
        try {
          onEntries(list.getEntries());
        } catch {
          // A malformed entry is not worth an error in the app.
        }
      });
      observer.observe(init);
      observers.push(observer);
      return true;
    } catch {
      return false;
    }
  }

  observe({ type: "paint", buffered: true }, (entries) => {
    const fcp = entries.find((entry) => entry.name === "first-contentful-paint");
    if (fcp !== undefined) once("FCP", fcp.startTime);
  });

  let lcp: number | undefined;
  observe({ type: "largest-contentful-paint", buffered: true }, (entries) => {
    const last = entries.at(-1);
    if (last !== undefined) lcp = last.startTime;
  });
  const finalizeLcp = () => {
    if (lcp !== undefined) once("LCP", lcp);
    removeInputListeners();
  };
  const inputEvents = ["keydown", "pointerdown"] as const;
  const removeInputListeners = () => {
    for (const type of inputEvents) window.removeEventListener(type, finalizeLcp, true);
  };
  for (const type of inputEvents) window.addEventListener(type, finalizeLcp, { capture: true, passive: true });

  let cls = 0;
  const clsObserved = observe({ type: "layout-shift", buffered: true }, (entries) => {
    for (const entry of entries as LayoutShift[]) {
      if (!entry.hadRecentInput) cls += entry.value;
    }
  });

  let longestInteraction = 0;
  observe({ type: "event", buffered: true, durationThreshold: 40 }, (entries) => {
    for (const entry of entries) longestInteraction = Math.max(longestInteraction, entry.duration);
  });

  return {
    afterLoad() {
      const entry = navigationEntry();
      if (entry !== undefined && entry.responseStart > 0) once("TTFB", entry.responseStart);
    },
    onHidden() {
      finalizeLcp();
      if (clsObserved) once("CLS", cls);
      if (longestInteraction > 0) once("INP", longestInteraction);
    },
    stop() {
      removeInputListeners();
      for (const observer of observers) observer.disconnect();
    },
  };
}
