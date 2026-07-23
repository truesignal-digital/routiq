import type { z } from "zod";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Friendly messages for the validation cases users actually hit; anything
 * unmapped falls through (return undefined) to zod's locale pack.
 */
export function makeZodErrorMap(t: Translate): (issue: z.core.$ZodRawIssue) => string | undefined {
  return (issue) => {
    switch (issue.code) {
      case "too_small": {
        if (issue.origin === "string") return t("form.errors.required");
        if (issue.origin === "number") {
          return t("form.errors.min", { min: Number(issue.minimum) });
        }
        return undefined;
      }
      case "too_big": {
        if (issue.origin === "number") {
          return t("form.errors.max", { max: Number(issue.maximum) });
        }
        return undefined;
      }
      case "invalid_type": {
        if (issue.input === undefined || issue.input === null || issue.input === "") {
          return t("form.errors.required");
        }
        if (issue.expected === "number") return t("form.errors.number");
        return undefined;
      }
      case "invalid_value":
        if (issue.input === undefined || issue.input === "") return t("form.errors.required");
        return undefined;
      default:
        return undefined;
    }
  };
}
