import { useTranslation } from "react-i18next";
import { PinnedField } from "@/components/command-form.js";
import { ALL_BRANCHES } from "../shell/branch-context.js";
import { useAssetOptions } from "./useAssetOptions.js";

/**
 * The vehicle a form is fixed to, where its picker would otherwise be. A host
 * that already holds the vehicle's name passes it; otherwise it is looked up
 * the way the pickers label it.
 */
export function PinnedAssetField({
  assetId,
  label,
}: {
  assetId: string;
  label?: string | undefined;
}) {
  const { t } = useTranslation();
  if (label !== undefined) {
    return <PinnedField label={t("vehicle.forms.pinnedVehicle")}>{label}</PinnedField>;
  }
  return <ResolvedPinnedAsset assetId={assetId} />;
}

function ResolvedPinnedAsset({ assetId }: { assetId: string }) {
  const { t } = useTranslation();
  const options = useAssetOptions(ALL_BRANCHES);
  const label = options.find((option) => option.value === assetId)?.label;

  return (
    <PinnedField label={t("vehicle.forms.pinnedVehicle")}>{label ?? "…"}</PinnedField>
  );
}
