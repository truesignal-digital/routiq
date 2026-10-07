import { createContext, useContext } from "react";
import type { AssetAttentionItem, AssetDetail } from "@routiq/contracts";
import type { MeContext } from "../auth/me.js";
import type { ActionAvailability, VehicleFacts } from "./actions.js";
import type { PanelRef, Step, StepKey, VehicleActionKey, Viewer } from "./model.js";

/** Which sections this viewer may open; a hidden section's reads are never fetched. */
export interface VehicleGates {
  maintenance: boolean;
  /** The vehicle's books: Money tab, totals, purchase price (ledger readers). */
  money: boolean;
  /** Entries one by one, as the server scopes them (a driver's own, #264). */
  entries: boolean;
  /** A work order's estimate, actual cost and cost lines (everyone but the driver, #390). */
  workOrderCosts: boolean;
  trips: boolean;
  documents: boolean;
}

/** A form open in the panel: on a record (with the record behind it), or on its own. */
export interface PanelForm {
  key: StepKey;
  record: PanelRef | undefined;
}

export interface PanelControls {
  /** The record on top, straight from `?panel=`. */
  current: PanelRef | undefined;
  /** The record the Back link returns to, when one was followed from another. */
  previous: PanelRef | undefined;
  form: PanelForm | undefined;
  openRecord: (ref: PanelRef) => void;
  /** Opens the step's record (if it has one) with the step's form on top. */
  openStep: (step: Step) => void;
  closeForm: () => void;
  back: () => void;
  close: () => void;
}

export interface VehicleContextValue {
  asset: AssetDetail;
  me: MeContext;
  viewer: Viewer;
  /** Empty until the attention read answers; `attentionStatus` says whether it has. */
  attention: readonly AssetAttentionItem[];
  attentionStatus: "pending" | "error" | "success";
  facts: VehicleFacts;
  gates: VehicleGates;
  /** Role and module allow the action at all. */
  can: (key: VehicleActionKey) => boolean;
  availability: (key: VehicleActionKey) => ActionAvailability;
  /** Starts an action the way the catalogue says it opens. */
  runAction: (key: VehicleActionKey) => void;
  openAllActions: () => void;
  panel: PanelControls;
  /** Refreshes every read the vehicle page shows, after a write. */
  refresh: () => Promise<void>;
  /** "VH003 · LT 482 AB · Douala": how a form pins this vehicle. */
  pinnedLabel: string;
}

export const VehicleCtx = createContext<VehicleContextValue | undefined>(undefined);

export function useVehicle(): VehicleContextValue {
  const value = useContext(VehicleCtx);
  if (value === undefined) throw new Error("useVehicle outside the vehicle workspace");
  return value;
}
