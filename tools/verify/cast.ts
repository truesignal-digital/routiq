import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "playwright-core";
import type { Viewport } from "./args.js";

/** One painted frame of the page; `t` is seconds since the cast started. */
export interface CastFrame {
  file: string;
  t: number;
}

/** cast/index.json: what `pnpm verify reel` plays back. */
export interface CastIndex {
  viewport: Viewport;
  frames: CastFrame[];
  /** Windows (seconds) when evidence screenshots resized or outlined the page; their frames are not shown. */
  pauses: Array<[number, number]>;
}

export interface Cast {
  /** Seconds since the cast started. */
  now: () => number;
  /** Hides the frames painted until the returned function is called. */
  pause: () => () => void;
  stop: () => Promise<CastIndex>;
}

/**
 * Records every frame Chromium paints (CDP screencast), as JPEGs with their
 * paint time. Unlike Playwright's recordVideo it keeps full quality and real
 * timing, so the reel can replay the flow smoothly and show honest seconds.
 */
export async function startCast(page: Page, dir: string, viewport: Viewport): Promise<Cast> {
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const started = Date.now() / 1000;
  const now = () => Date.now() / 1000 - started;
  const frames: CastFrame[] = [];
  const pauses: Array<[number, number]> = [];
  let count = 0;

  cdp.on("Page.screencastFrame", (event: { data: string; sessionId: number; metadata: { deviceWidth?: number; deviceHeight?: number; timestamp?: number } }) => {
    void cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => undefined);
    const { deviceWidth, deviceHeight, timestamp } = event.metadata;
    // A full-page screenshot briefly resizes the page; those frames are not what a user sees.
    if (deviceWidth !== undefined && deviceHeight !== undefined && (Math.round(deviceWidth) !== viewport.width || Math.round(deviceHeight) !== viewport.height)) return;
    count += 1;
    const file = `${String(count).padStart(5, "0")}.jpg`;
    writeFileSync(path.join(dir, file), Buffer.from(event.data, "base64"));
    frames.push({ file, t: timestamp === undefined ? now() : timestamp - started });
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: viewport.width, maxHeight: viewport.height, everyNthFrame: 1 });

  return {
    now,
    pause: () => {
      const from = now();
      // Frames arrive a little after they are painted; keep the window open briefly.
      return () => pauses.push([from, now() + 0.15]);
    },
    stop: async () => {
      await cdp.send("Page.stopScreencast").catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 200));
      await cdp.detach().catch(() => undefined);
      return { viewport, frames: [...frames].sort((a, b) => a.t - b.t), pauses };
    },
  };
}
