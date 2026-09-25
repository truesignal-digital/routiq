// PROTOTYPE — throwaway, issue #44. Mounts one of four vehicle-workspace
// designs on the real asset detail route. Real: shell, auth, the asset detail
// read (identity, branch, lifecycle, lifetime money, recent trips).
// Sample: everything the API cannot serve yet (work orders, issues, readings,
// documents, custody, attention items) — see mockData.ts.

import type { AssetDetail } from "@routiq/contracts";
import { VariantA } from "./VariantA.js";
import { VariantB } from "./VariantB.js";
import { VariantC } from "./VariantC.js";
import { VariantD } from "./VariantD.js";
import { VariantE } from "./VariantE.js";
import { VariantSwitcher, type VariantKey } from "./VariantSwitcher.js";
import { buildWorkspace } from "./mockData.js";

export function VehicleWorkspacePrototype({ asset, variant }: { asset: AssetDetail; variant: VariantKey }) {
  const ws = buildWorkspace(asset);
  return (
    <>
      {variant === "A" && <VariantA ws={ws} />}
      {variant === "B" && <VariantB ws={ws} />}
      {variant === "C" && <VariantC ws={ws} />}
      {variant === "D" && <VariantD ws={ws} />}
      {variant === "E" && <VariantE ws={ws} />}
      <VariantSwitcher variant={variant} />
    </>
  );
}
