import { z } from "zod";

/**
 * What tells one vehicle from another: its plate and its chassis number. One
 * rule each, composed by register-asset and update-asset-details and checked
 * by both web forms, so a value one surface accepts is a value every other
 * surface accepts (#122). The plate must also be free in the workspace: the API
 * checks that with `plateKey` (`apps/api/src/commands/asset-identity.ts`).
 *
 * Text is trimmed before its length is checked, so `'   '` is no plate at all.
 */

/** A plate is short; 40 leaves room for foreign and temporary formats. */
export const REGISTRATION_NUMBER_MAX_LENGTH = 40;

/** A VIN is 17 characters; nothing longer is a chassis number. */
export const CHASSIS_NUMBER_MAX_LENGTH = 17;

export const assetIdentityFields = {
  registrationNumber: z.string().trim().min(1).max(REGISTRATION_NUMBER_MAX_LENGTH),
  chassisNumber: z.string().trim().min(1).max(CHASSIS_NUMBER_MAX_LENGTH),
} as const;

/**
 * `LT 482 AB`, `lt482ab` and `LT-482-AB` are one plate. The API compares
 * stored plates the same way in SQL; change both together.
 */
export function plateKey(plate: string): string {
  return plate.replace(/[\s-]/g, "").toUpperCase();
}
