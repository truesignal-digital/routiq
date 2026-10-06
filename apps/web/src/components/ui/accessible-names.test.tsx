// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { i18n } from "@/i18n/index.js"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"

const UI_DIR = import.meta.dirname

const LITERAL_NAMES = [
  /(?:aria-label|title)=["']([^"']*[A-Za-z][^"']*)["']/g,
  /className=["'][^"']*\bsr-only\b[^"']*["'][^>]*>\s*([^<{\s][^<{]*?)\s*</g,
]

describe("vendored primitives name their controls from the catalog", () => {
  it("no aria-label, title or sr-only text is a literal string", () => {
    const literals = readdirSync(UI_DIR)
      .filter((name) => name.endsWith(".tsx") && !/\.test\.tsx$/.test(name))
      .flatMap((name) => {
        const source = readFileSync(join(UI_DIR, name), "utf8")
        return LITERAL_NAMES.flatMap((pattern) =>
          [...source.matchAll(pattern)].map((match) => `${name}: ${match[1]}`),
        )
      })
    expect(literals).toEqual([])
  })
})

describe("sheet close button", () => {
  afterEach(cleanup)
  afterAll(async () => {
    await i18n.changeLanguage("fr-CM")
  })

  it.each([
    ["fr-CM", "Fermer"],
    ["en", "Close"],
  ])("is named in %s", async (language, name) => {
    await i18n.changeLanguage(language)
    render(
      <Sheet open>
        <SheetContent>
          <SheetTitle>Panel</SheetTitle>
        </SheetContent>
      </Sheet>,
    )
    expect(screen.getByRole("button", { name })).toBeDefined()
  })
})
