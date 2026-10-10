import { Button } from "@/components/ui/button";
import { actionDef } from "../actions.js";
import { useVehicle } from "../context.js";
import type { VehicleActionKey } from "../model.js";
import { useStepLabel } from "../parts.js";

/** The one primary button a tab carries; it starts the action the way the catalogue says. */
export function TabAction({ actionKey }: { actionKey: VehicleActionKey }) {
  const stepLabel = useStepLabel();
  const { can, availability, runAction } = useVehicle();
  if (!can(actionKey) || availability(actionKey).state !== "enabled") return null;
  const Icon = actionDef(actionKey).icon;
  return (
    <Button className="self-start sm:self-auto desktop:h-9" onClick={() => runAction(actionKey)}>
      <Icon aria-hidden />
      {stepLabel({ key: actionKey })}
    </Button>
  );
}
