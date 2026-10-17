/**
 * Company settings are the Director's and the Administrators' (ADR-0013,
 * #711), the same list the server checks. The page holds the money chain and
 * the Dashboard summary schedule (#669); it still belongs to Finance's
 * manifest and goes with the module (§3.3a), which every preset turns on.
 */
export { canManageCompanySettings } from "@routiq/contracts";
