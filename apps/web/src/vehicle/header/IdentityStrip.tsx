import { useTranslation } from "react-i18next";
import { LayoutGrid, Truck } from "lucide-react";
import { RecordHeader } from "@/components/record-page.js";
import { Button } from "@/components/ui/button";
import { OtherBranchNotice } from "@/shell/BranchScopeNotices.js";
import { actionDef, headerActions } from "../actions.js";
import { useVehicle } from "../context.js";
import { useStepLabel } from "../parts.js";
import { VehicleStatusBadge } from "../VehicleStatusBadge.js";
import { useFactsLine } from "./FactsLine.js";

/** "Mercedes-Benz Actros" — make and model, or nothing to repeat after the code. */
export function makeAndModel(asset: { manufacturer: string | null; model: string | null }): string {
  return [asset.manufacturer, asset.model].filter(Boolean).join(" ");
}

export function Plate({ plate }: { plate: string | null }) {
  const { t } = useTranslation();
  if (!plate) return <span>{t("vehicle.header.noPlate")}</span>;
  return (
    <span className="rounded-[5px] border border-foreground/25 px-1.5 text-xs leading-5 font-semibold tracking-wide text-foreground tabular-nums">
      {plate}
    </span>
  );
}

/**
 * The truck's record header (#662): code and make as the title, its status
 * badge beside it, plate, home and the quiet facts on one line, the role's own
 * buttons top right. The same `RecordHeader` as the money entry and the trip.
 */
export function VehicleHeader() {
  const { t } = useTranslation();
  const { asset } = useVehicle();
  const name = makeAndModel(asset);
  const facts = useFactsLine();

  return (
    <RecordHeader
      name={asset.assetCode}
      icon={<Truck aria-hidden />}
      title={
        <>
          <span className="tabular-nums">{asset.assetCode}</span>
          {name !== "" && (
            <>
              <span aria-hidden className="mx-1.5 font-normal text-muted-foreground/60">
                ·
              </span>
              {name}
            </>
          )}
        </>
      }
      status={<VehicleStatusBadge />}
      facts={[
        <Plate key="plate" plate={asset.registrationNumber} />,
        t("vehicle.header.home", { branch: asset.branch.name }),
        ...facts,
      ]}
      actions={<HeaderActions />}
    >
      <OtherBranchNotice branchCode={asset.branch.code} />
    </RecordHeader>
  );
}

function HeaderActions() {
  const { t } = useTranslation();
  const stepLabel = useStepLabel();
  const { viewer, runAction, openAllActions, availability } = useVehicle();

  const keys = headerActions(viewer).filter((key) => availability(key).state === "enabled");
  return (
    <div className="hidden shrink-0 items-center gap-2 md:flex">
      {keys.map((key) => {
        const Icon = actionDef(key).icon;
        return (
          <Button key={key} variant="outline" className="desktop:h-9" onClick={() => runAction(key)}>
            <Icon aria-hidden />
            {stepLabel({ key })}
          </Button>
        );
      })}
      <Button variant="outline" className="desktop:h-9" onClick={openAllActions}>
        <LayoutGrid aria-hidden />
        {t("vehicle.header.moreActions")}
      </Button>
    </div>
  );
}
