// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { afterAll, afterEach, describe, expect, it } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { i18n } from "@/i18n/index.js"
import { Calendar } from "@/components/ui/calendar"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"

const UI_DIR = import.meta.dirname

const NAME_ATTRIBUTE = /(?<![\w-])(aria-label|aria-description|title|alt|placeholder)=/g
const CLASS_NAME = /(?<![\w-])className=/g
const LETTER = /\p{L}/u

/** Index just past the string or template literal that opens at `start`. */
function skipLiteral(source: string, start: number): number {
  const quote = source[start]
  let index = start + 1
  while (index < source.length) {
    const char = source[index]
    if (char === "\\") index += 2
    else if (char === quote) return index + 1
    else if (quote === "`" && char === "$" && source[index + 1] === "{") index = skipBalanced(source, index + 1)
    else index += 1
  }
  return index
}

/** Index just past the bracket group that opens at `start`, skipping literals inside it. */
function skipBalanced(source: string, start: number): number {
  let depth = 0
  let index = start
  while (index < source.length) {
    const char = source[index]
    if (char === '"' || char === "'" || char === "`") {
      index = skipLiteral(source, index)
      continue
    }
    if (char === "{" || char === "(" || char === "[") depth += 1
    if (char === "}" || char === ")" || char === "]") depth -= 1
    index += 1
    if (depth === 0) return index
  }
  return index
}

/** A JSX attribute value: a quoted string, or the `{…}` expression including its braces. */
function readValue(source: string, start: number): string {
  const char = source[start]
  if (char === '"' || char === "'") return source.slice(start, skipLiteral(source, start))
  if (char === "{") return source.slice(start, skipBalanced(source, start))
  return ""
}

/**
 * Literal text that would reach the user from a JSX value: quoted strings with letters and any
 * template literal (a name glued from parts). Arguments of t(…) are the catalog and don't count;
 * neither does a string compared with ===/!==, which is a condition, not a name.
 */
function literalsIn(value: string): string[] {
  const found: string[] = []
  let index = 0
  while (index < value.length) {
    const char = value[index]
    if (char === "t" && value[index + 1] === "(" && !/[\w$.]/.test(value[index - 1] ?? "")) {
      index = skipBalanced(value, index + 1)
      continue
    }
    if (char === '"' || char === "'" || char === "`") {
      const end = skipLiteral(value, index)
      const literal = value.slice(index, end)
      const compared =
        /[!=]==?\s*$/.test(value.slice(0, index)) || /^\s*[!=]==?/.test(value.slice(end))
      if (char === "`" || (!compared && LETTER.test(literal))) found.push(literal)
      index = end
      continue
    }
    index += 1
  }
  return found
}

/** Index just past the `>` that closes the opening tag containing `start`, or -1 if self-closing. */
function endOfOpeningTag(source: string, start: number): number {
  let index = start
  while (index < source.length) {
    const char = source[index]
    if (char === '"' || char === "'" || char === "`") index = skipLiteral(source, index)
    else if (char === "{") index = skipBalanced(source, index)
    else if (char === "/" && source[index + 1] === ">") return -1
    else if (char === ">") return index + 1
    else index += 1
  }
  return -1
}

function srOnlyText(source: string, tagEnd: number): string[] {
  const rest = source.slice(tagEnd)
  const leading = rest.length - rest.trimStart().length
  if (rest[leading] === "{") {
    const expression = rest.slice(leading, skipBalanced(rest, leading))
    return literalsIn(expression)
  }
  const text = rest.slice(0, rest.search(/[<{]/)).trim()
  return LETTER.test(text) ? [text] : []
}

function literalAccessibleNames(source: string): string[] {
  const lineOf = (index: number) => source.slice(0, index).split("\n").length
  const names = [...source.matchAll(NAME_ATTRIBUTE)].flatMap((match) => {
    const valueStart = match.index + match[0].length
    const value = readValue(source, valueStart)
    const literals = value.startsWith("{") ? literalsIn(value) : LETTER.test(value) ? [value] : []
    return literals.map((literal) => `${lineOf(match.index)} ${match[1]}=${literal}`)
  })
  const hidden = [...source.matchAll(CLASS_NAME)].flatMap((match) => {
    const valueStart = match.index + match[0].length
    const value = readValue(source, valueStart)
    const classes = value.startsWith("{") ? value.match(/["'`][^"'`]*["'`]/g) ?? [] : [value]
    if (!classes.some((literal) => /(?<![\w-])sr-only(?![\w-])/.test(literal))) return []
    const tagEnd = endOfOpeningTag(source, valueStart + value.length)
    if (tagEnd === -1) return []
    return srOnlyText(source, tagEnd).map((text) => `${lineOf(match.index)} sr-only=${text}`)
  })
  return [...names, ...hidden]
}

describe("vendored primitives name their controls from the catalog", () => {
  it("no accessible name, placeholder or sr-only text is a literal string", () => {
    const literals = readdirSync(UI_DIR)
      .filter((name) => name.endsWith(".tsx") && !/\.test\.tsx$/.test(name))
      .flatMap((name) =>
        literalAccessibleNames(readFileSync(join(UI_DIR, name), "utf8")).map(
          (found) => `${name}:${found}`,
        ),
      )
    expect(literals).toEqual([])
  })

  it("sees literals hidden in expressions, templates and cn(…)", () => {
    const probe = [
      `<button aria-label={locale === "fr" ? "Mois précédent" : "Previous month"} />`,
      `<button aria-label={"Close"} />`,
      "<button title={`Close`} />",
      `<span className={cn("sr-only")}>Close</span>`,
      `<span className="sr-only">\n  Close\n</span>`,
      "<button aria-label={`${t(\"fileUpload.remove\")} ${name}`} />",
      `<input placeholder="Search" />`,
      `<img alt={'Logo'} />`,
      `<p aria-description={open ? "Open" : t("closed")} />`,
      `<span className={cn("sr-only", className)}>{"Close"}</span>`,
    ].join("\n")
    expect(literalAccessibleNames(probe)).toEqual([
      `1 aria-label="Mois précédent"`,
      `1 aria-label="Previous month"`,
      `2 aria-label="Close"`,
      "3 title=`Close`",
      "8 aria-label=`${t(\"fileUpload.remove\")} ${name}`",
      `9 placeholder="Search"`,
      `10 alt='Logo'`,
      `11 aria-description="Open"`,
      "4 sr-only=Close",
      "5 sr-only=Close",
      `12 sr-only="Close"`,
    ])
  })

  it("lets catalog names, conditions and empty alt text through", () => {
    const allowed = [
      `<button aria-label={t("common.close")} />`,
      `<button aria-label={mode === "single" ? t("a") : t("b", { name })} />`,
      `<img alt="" />`,
      `<button title={label} data-title="Not a name" />`,
      `<span className="sr-only">{t("shell.toggleSidebar")}</span>`,
      `<span className={cn("sr-only", className)}>{children}</span>`,
      `<span className="sr-only" />`,
    ].join("\n")
    expect(literalAccessibleNames(allowed)).toEqual([])
  })
})

describe("named controls follow the app language", () => {
  afterEach(cleanup)
  afterAll(async () => {
    await i18n.changeLanguage("fr-CM")
  })

  it.each([
    ["fr-CM", "Fermer"],
    ["en", "Close"],
  ])("sheet close button is named in %s", async (language, name) => {
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

  it.each([
    ["fr-CM", ["Année précédente", "Mois précédent", "Mois suivant", "Année suivante"], "lundi 6 octobre 2025"],
    ["en", ["Previous year", "Previous month", "Next month", "Next year"], "Monday, October 6, 2025"],
  ])("calendar navigation is named in %s without a locale prop", async (language, names, day) => {
    await i18n.changeLanguage(language)
    render(<Calendar mode="single" defaultMonth={new Date(2025, 9, 1)} />)
    for (const name of names) expect(screen.getByRole("button", { name })).toBeDefined()
    expect(screen.getByRole("button", { name: day })).toBeDefined()
  })
})
