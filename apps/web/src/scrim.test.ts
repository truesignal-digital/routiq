import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

/**
 * The page behind a panel or dialog stays readable: one dim at 32 % black, no
 * blur (docs/design/consistency/kit.css `.scrim`). Every overlay draws the same.
 */
const OVERLAYS = [
  "components/ui/sheet.tsx",
  "components/ui/drawer.tsx",
  "components/ui/dialog.tsx",
  "components/ui/alert-dialog.tsx",
];

describe("overlay scrim", () => {
  it.each(OVERLAYS)("%s dims at 32 % and does not blur", (file) => {
    const source = readFileSync(resolve(__dirname, file), "utf-8");
    expect(source).toContain("bg-black/32");
    expect(source).not.toMatch(/backdrop-blur/);
  });
});
