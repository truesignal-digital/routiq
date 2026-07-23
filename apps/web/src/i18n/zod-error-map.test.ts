import { describe, expect, it } from "vitest";
import { z } from "zod";
import { makeZodErrorMap } from "./zod-error-map.js";

const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}:${JSON.stringify(options)}` : key;

function firstMessage(schema: z.ZodType, value: unknown): string | undefined {
  const result = schema.safeParse(value, { error: makeZodErrorMap(t) });
  return result.success ? undefined : result.error.issues[0]?.message;
}

describe("makeZodErrorMap", () => {
  it("empty required string → required", () => {
    expect(firstMessage(z.string().min(1), "")).toBe("form.errors.required");
  });

  it("missing value → required", () => {
    expect(firstMessage(z.string(), undefined)).toBe("form.errors.required");
  });

  it("number below range → min with the bound", () => {
    expect(firstMessage(z.number().min(1950), 1800)).toBe('form.errors.min:{"min":1950}');
  });

  it("number above range → max with the bound", () => {
    expect(firstMessage(z.number().max(2100), 2500)).toBe('form.errors.max:{"max":2100}');
  });

  it("non-numeric where number expected → number", () => {
    expect(firstMessage(z.number(), "abc")).toBe("form.errors.number");
  });

  it("unmapped issue falls through to the locale default", () => {
    expect(firstMessage(z.uuid(), "not-a-uuid")).not.toBe("form.errors.required");
  });
});
