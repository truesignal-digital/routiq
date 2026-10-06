import {
  assetIdentityProblem,
  CHASSIS_NUMBER_MAX_LENGTH,
  REGISTRATION_NUMBER_MAX_LENGTH,
  type AssetIdentityField,
} from "@routiq/contracts";

/**
 * The words for the vehicle identity rules (#122), shared by Register a vehicle
 * and the Details edit so both say the same thing. The rule itself is the
 * contract's (`asset-identity.ts`); a plate another vehicle carries comes back
 * from the server as DUPLICATE_REGISTRATION_NUMBER, worded by `errors.*`.
 */

export const IDENTITY_MAX_LENGTH: Record<AssetIdentityField, number> = {
  registrationNumber: REGISTRATION_NUMBER_MAX_LENGTH,
  chassisNumber: CHASSIS_NUMBER_MAX_LENGTH,
};

const TOO_LONG_KEY: Record<AssetIdentityField, string> = {
  registrationNumber: "assets.identity.plateTooLong",
  chassisNumber: "assets.identity.chassisTooLong",
};

type Translate = (key: string, options: Record<string, unknown>) => string;

/** The message for a typed plate or chassis number, or undefined when it passes. */
export function identityMessage(field: AssetIdentityField, value: string, t: Translate): string | undefined {
  return assetIdentityProblem(field, value) === undefined
    ? undefined
    : t(TOO_LONG_KEY[field], { max: IDENTITY_MAX_LENGTH[field] });
}
