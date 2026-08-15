import { z } from "zod";

/**
 * The branch field rules, in one place because three commands need them and a
 * branch born at provisioning is the same row as one added later: create-branch,
 * rename-branch and provision-workspace all compose these rather than restating
 * them. Clients validate against them too, so a value the dialog accepts is a
 * value the server accepts.
 */

/** Immutable once numbering has embedded it (`DLA-2026-00004`). */
export const branchCode = z.string().regex(/^[A-Z0-9]{2,8}$/);

/**
 * Trimmed before the length check, so `'   '` is an empty name rather than a
 * three-character one: a blank branch renders as a blank row in the switcher
 * and cannot be told apart from any other blank-named branch.
 */
export const branchName = z.string().trim().min(1).max(120);
