import { HISTORY_CODE_SETS, HISTORY_ENTITY_TYPES, HISTORY_FIELD_SHAPES, type HistoryCodeSet } from "@routiq/contracts";
import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json" with { type: "json" };
import fr from "../i18n/locales/fr.json" with { type: "json" };
import { HISTORY_CODE_LABEL_KEY } from "./code-labels.js";

function lookup(messages: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>(
    (node, part) => (node !== null && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined),
    messages,
  );
}

describe("history code labels", () => {
  it.each(Object.keys(HISTORY_CODE_SETS) as HistoryCodeSet[])("words every %s code in French and English", (codeSet) => {
    for (const code of HISTORY_CODE_SETS[codeSet]) {
      const key = HISTORY_CODE_LABEL_KEY[codeSet](code);
      expect(typeof lookup(fr, key), `fr ${key}`).toBe("string");
      expect(typeof lookup(en, key), `en ${key}`).toBe("string");
    }
  });

  it("names every field the history sheet can show, in both languages", () => {
    for (const entityType of HISTORY_ENTITY_TYPES) {
      for (const [field, shape] of Object.entries(HISTORY_FIELD_SHAPES[entityType])) {
        if (shape === "HIDDEN") continue;
        expect(typeof lookup(fr, `history.field.${field}`), `fr ${entityType}.${field}`).toBe("string");
        expect(typeof lookup(en, `history.field.${field}`), `en ${entityType}.${field}`).toBe("string");
      }
    }
  });
});
