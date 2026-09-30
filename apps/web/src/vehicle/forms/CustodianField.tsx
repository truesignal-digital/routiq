import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { AssetCustodian } from "@routiq/contracts";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CustodianSlot } from "../../assets/AssetActions.js";
import { useCustodianCandidates } from "../useVehicle.js";

const NOBODY = "__nobody__";

/**
 * The custodian picker for `assign-asset`: members whose branches cover the
 * vehicle, plus "nobody" to clear it. A driver without a login is not a member,
 * so the help text says why they are not offered.
 */
export function useCustodianSlot(assetId: string, current: AssetCustodian | null): CustodianSlot {
  const { t } = useTranslation();
  const candidates = useCustodianCandidates(assetId, true);
  const [choice, setChoice] = useState<string>();
  const items = candidates.data?.items ?? [];

  const field = (
    <div className="flex flex-col gap-2">
      <Label htmlFor="vehicle-custodian">{t("vehicle.forms.custodian.label")}</Label>
      <Select value={choice ?? null} onValueChange={(next) => setChoice((next as string | null) ?? undefined)}>
        <SelectTrigger id="vehicle-custodian" className="w-full" aria-label={t("vehicle.forms.custodian.label")}>
          <SelectValue placeholder={t("vehicle.forms.custodian.choose")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NOBODY}>{t("vehicle.forms.custodian.none")}</SelectItem>
          {items.map((item) => (
            <SelectItem key={item.membershipId} value={item.membershipId}>
              {item.displayName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        {current === null
          ? t("vehicle.forms.custodian.currentNone")
          : t("vehicle.forms.custodian.current", { name: current.displayName })}
      </p>
      <p className="text-xs text-muted-foreground">{t("vehicle.forms.custodian.hint")}</p>
      {candidates.isSuccess && items.length === 0 && (
        <p className="text-xs text-muted-foreground">{t("vehicle.forms.custodian.empty")}</p>
      )}
    </div>
  );

  return {
    field,
    value:
      choice === undefined
        ? undefined
        : { custodianMembershipId: choice === NOBODY ? null : choice },
  };
}
