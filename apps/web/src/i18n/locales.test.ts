import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { COMMAND_QUEUEABILITY } from "@routiq/contracts";
import { describe, expect, it } from "vitest";
import { commandLabelKeys, COMMAND_INTENTS, type CommandLabelRef } from "../commands/labels.js";
import en from "./locales/en.json";
import fr from "./locales/fr.json";

function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null) {
      return flattenKeys(value as Record<string, unknown>, path);
    }
    return [path];
  });
}

function lookup(catalog: unknown, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (acc, part) =>
        typeof acc === "object" && acc !== null ? (acc as Record<string, unknown>)[part] : undefined,
      catalog,
    );
}

/** What i18next does with a list of keys: the first one the catalog holds. */
function resolve(catalog: unknown, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = lookup(catalog, key);
    if (typeof value === "string") return value;
  }
  return undefined;
}

const CATALOGS = [
  ["fr", fr],
  ["en", en],
] as const;

describe("locale catalogs", () => {
  it("fr and en expose exactly the same keys", () => {
    expect(flattenKeys(en).sort()).toEqual(flattenKeys(fr).sort());
  });

  it("no message is an empty string", () => {
    for (const [, catalog] of CATALOGS) {
      for (const key of flattenKeys(catalog)) {
        expect(lookup(catalog, key), key).toBeTruthy();
      }
    }
  });

  it("does not contain i18next-style interpolation", () => {
    for (const [locale, catalog] of CATALOGS) {
      expect(JSON.stringify(catalog), locale).not.toContain("{{");
    }
  });
});

const COMMANDS = Object.keys(COMMAND_QUEUEABILITY);

const REFS: CommandLabelRef[] = [
  ...(COMMANDS as CommandLabelRef[]),
  ...Object.entries(COMMAND_INTENTS).flatMap(([command, intents]) =>
    intents.map((intent) => ({ command, intent }) as CommandLabelRef),
  ),
];

const refName = (ref: CommandLabelRef) =>
  typeof ref === "string" ? ref : `${ref.command}.${ref.intent}`;

describe("command labels", () => {
  it("every registered command has one commands.<name> block, and nothing else does", () => {
    for (const [locale, catalog] of CATALOGS) {
      expect(Object.keys(catalog.commands).sort(), locale).toEqual([...COMMANDS].sort());
    }
  });

  it("every command and intent resolves a label, a submit and a submitting label", () => {
    for (const [locale, catalog] of CATALOGS) {
      for (const ref of REFS) {
        for (const part of ["label", "short", "submit", "submitting", "dismiss"] as const) {
          expect(resolve(catalog, commandLabelKeys(ref, part)), `${locale} ${refName(ref)}.${part}`)
            .toBeTruthy();
        }
      }
    }
  });

  it("no footer holds two buttons that start with the same word", () => {
    for (const [locale, catalog] of CATALOGS) {
      for (const ref of REFS) {
        const submit = resolve(catalog, commandLabelKeys(ref, "submit")) ?? "";
        const dismiss = resolve(catalog, commandLabelKeys(ref, "dismiss")) ?? "";
        const firstWord = (text: string) => text.split(/[\s']/)[0]?.toLowerCase();
        expect(firstWord(dismiss), `${locale} ${refName(ref)}: "${dismiss}" / "${submit}"`).not.toBe(
          firstWord(submit),
        );
      }
    }
  });
});

describe("pending words", () => {
  // A button's sending state is its command's word, so one command never
  // reads "Envoi…" on one screen and "Enregistrement…" on another.
  it("a submitting or working key lives only under commands.* or commandForm", () => {
    for (const [locale, catalog] of CATALOGS) {
      const stray = flattenKeys(catalog).filter(
        (key) =>
          /(submitting|working)$/i.test(key.split(".").at(-1) ?? "") &&
          !key.startsWith("commands.") &&
          !key.startsWith("commandForm."),
      );
      expect(stray, locale).toEqual([]);
    }
  });
});

/**
 * The dismiss and close buttons' words. "Annuler" is also the verb for
 * cancelling a work order and "Close" for closing a trip, so each word may only
 * mean the chrome: it sits at a key named for that job, and such a key holds
 * the chrome word in both languages.
 */
const CHROME_WORDS: Record<"fr" | "en", readonly string[]> = {
  fr: ["Annuler", "Fermer"],
  en: ["Cancel", "Close"],
};
const CHROME_KEYS = new Set(["cancel", "close", "done"]);

describe("dismiss words mean one thing", () => {
  it("a chrome word sits only at a cancel, close or done key, outside commands", () => {
    for (const [locale, catalog] of CATALOGS) {
      for (const key of flattenKeys(catalog)) {
        if (!CHROME_WORDS[locale].includes(lookup(catalog, key) as string)) continue;
        const last = key.split(".").at(-1) ?? "";
        expect(CHROME_KEYS.has(last) && !key.startsWith("commands."), `${locale} ${key}`).toBe(true);
      }
    }
  });

  it("a cancel or close key holds the chrome word in both languages", () => {
    for (const key of flattenKeys(fr)) {
      const last = key.split(".").at(-1) ?? "";
      if (last !== "cancel" && last !== "close") continue;
      for (const [locale, catalog] of CATALOGS) {
        expect(CHROME_WORDS[locale], `${locale} ${key} = "${String(lookup(catalog, key))}"`).toContain(
          lookup(catalog, key),
        );
      }
    }
  });
});

const SRC = join(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("catalog keys the code asks for", () => {
  // A key moved into `commands.*` must not be left behind in a screen, where
  // i18next would render the key itself.
  it("every literal t() key exists in the catalog", () => {
    const missing: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(/\bt\(\s*"([a-zA-Z][\w-]*(?:\.[\w-]+)+)"/g)) {
        const key = match[1] ?? "";
        if (lookup(fr, key) === undefined) missing.push(`${file.slice(SRC.length + 1)}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
