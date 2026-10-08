import { useTranslation } from "react-i18next";
import { LayoutGrid, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { actionDef, headerActions } from "../actions.js";
import { useVehicle } from "../context.js";
import { Sep, useStepLabel } from "../parts.js";

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

/** Code, name, plate and home branch on one line; the role's own buttons beside them. */
export function IdentityStrip() {
  const { t } = useTranslation();
  const { asset } = useVehicle();
  const name = makeAndModel(asset);
  const home = t("vehicle.header.home", { branch: asset.branch.name });

  return (
    <div className="flex items-center gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground/80">
        <Truck className="size-[18px]" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-x-2.5">
          <h1 className="text-base leading-snug font-semibold tracking-tight md:truncate md:text-lg">
            <span className="tabular-nums">{asset.assetCode}</span>
            {name !== "" && (
              <>
                <span aria-hidden className="mx-1.5 font-normal text-muted-foreground/60">
                  ·
                </span>
                {name}
              </>
            )}
          </h1>
          <span className="hidden shrink-0 items-center gap-2.5 text-sm text-muted-foreground md:inline-flex">
            <Sep />
            <Plate plate={asset.registrationNumber} />
            <Sep />
            <span>{home}</span>
          </span>
        </div>
        <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground md:hidden">
          <Plate plate={asset.registrationNumber} />
          <Sep />
          <span>{home}</span>
        </p>
      </div>
      <HeaderActions />
    </div>
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
