import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";

describe("styles.css semantic tokens", () => {
  const stylesCssPath = resolve(__dirname, "styles.css");
  const stylesCss = readFileSync(stylesCssPath, "utf-8");

  const semanticTokens = ["success", "warning", "info", "signal"];

  semanticTokens.forEach((token) => {
    it(`should define --${token} in :root`, () => {
      const rootMatch = stylesCss.match(/:root\s*{[\s\S]*?}/);
      expect(rootMatch).toBeTruthy();
      const rootBlock = rootMatch?.[0];
      expect(rootBlock).toContain(`--${token}:`);
    });

    it(`should map --color-${token} in @theme inline`, () => {
      const themeMatch = stylesCss.match(/@theme\s+inline\s*{[\s\S]*?}/);
      expect(themeMatch).toBeTruthy();
      const themeBlock = themeMatch?.[0];
      expect(themeBlock).toContain(`--color-${token}:`);
    });
  });

  semanticTokens.forEach((token) => {
    it(`should define --${token}-foreground in :root`, () => {
      const rootMatch = stylesCss.match(/:root\s*{[\s\S]*?}/);
      expect(rootMatch).toBeTruthy();
      const rootBlock = rootMatch?.[0];
      expect(rootBlock).toContain(`--${token}-foreground:`);
    });

    it(`should map --color-${token}-foreground in @theme inline`, () => {
      const themeMatch = stylesCss.match(/@theme\s+inline\s*{[\s\S]*?}/);
      expect(themeMatch).toBeTruthy();
      const themeBlock = themeMatch?.[0];
      expect(themeBlock).toContain(`--color-${token}-foreground:`);
    });
  });

  it("should have --font-heading as a distinct value (not var(--font-sans))", () => {
    const fontHeadingMatch = stylesCss.match(
      /--font-heading:\s*([^;]+);/
    );
    expect(fontHeadingMatch).toBeTruthy();
    const fontHeadingValue = fontHeadingMatch?.[1]?.trim();
    expect(fontHeadingValue).not.toBe("var(--font-sans)");
  });

  it("should have --font-heading defined in @theme inline", () => {
    const themeMatch = stylesCss.match(/@theme\s+inline\s*{[\s\S]*?}/);
    expect(themeMatch).toBeTruthy();
    const themeBlock = themeMatch?.[0];
    expect(themeBlock).toContain("--font-heading:");
  });
});
