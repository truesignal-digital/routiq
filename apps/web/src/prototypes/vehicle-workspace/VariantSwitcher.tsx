// PROTOTYPE — throwaway, issue #44. Four structurally different vehicle
// workspaces on the real /assets/$assetId route, switchable via ?variant=.
// No ?variant= renders the current production screen. Dev builds only.

import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProtoRole } from "./actions.js";
import { ROLE_LABELS, type ProtoRole } from "./mockData.js";

export const VARIANT_KEYS = ["A", "B", "C", "D", "E"] as const;
export type VariantKey = (typeof VARIANT_KEYS)[number];

export const VARIANT_NAMES: Record<VariantKey, string> = {
  A: "Tabbed workspace",
  B: "Vehicle story",
  C: "Workshop board",
  D: "Action hub",
  E: "A, refined",
};

export const VARIANT_SUBTITLES: Record<VariantKey, string> = {
  A: "Identity header, what needs attention, then one tab per domain. Every action lives in the section it belongs to.",
  B: "One chronological story of the vehicle. A composer on top to add to it; a sticky vehicle card on the side.",
  C: "Readiness first. Issues and work orders move across lanes; money, documents and history sit behind the board.",
  D: "Phone-first. Big actions up front, current state below, history last. Built for the person standing next to the truck.",
  E: "Variant A rebuilt to explain itself: one status sentence, one next step, one place per action.",
};

function step(current: VariantKey, by: 1 | -1): VariantKey {
  const i = VARIANT_KEYS.indexOf(current);
  return VARIANT_KEYS[(i + by + VARIANT_KEYS.length) % VARIANT_KEYS.length] ?? "A";
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function VariantSwitcher({ variant }: { variant: VariantKey }) {
  const navigate = useNavigate();
  const role = useProtoRole();
  const go = (next: VariantKey) =>
    void navigate({ to: ".", search: (prev: Record<string, unknown>) => ({ ...prev, variant: next }), replace: true });

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (isTextEntry(event.target)) return;
      go(step(variant, event.key === "ArrowRight" ? 1 : -1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!import.meta.env.DEV) return null;
  return (
    <div data-proto-switcher className="fixed bottom-3 left-1/2 z-50 flex max-w-[calc(100vw-16px)] -translate-x-1/2 flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-xl border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-zinc-50 shadow-2xl">
      <Button size="icon-sm" variant="ghost" className="text-zinc-50 hover:bg-zinc-800 hover:text-zinc-50" aria-label="Previous design" onClick={() => go(step(variant, -1))}>
        <ChevronLeft />
      </Button>
      <div className="min-w-0 px-1 text-center sm:min-w-64">
        <div className="text-sm font-semibold">
          {variant} · {VARIANT_NAMES[variant]}
        </div>
        <div className="hidden text-[11px] text-zinc-400 sm:block">Prototype · sample data · ← → to switch</div>
      </div>
      <label className="flex items-center gap-1.5 text-[11px] text-zinc-400 sm:border-l sm:border-zinc-700 sm:pl-2">
        View as
        <select
          value={role}
          onChange={(e) =>
            void navigate({ to: ".", search: (prev: Record<string, unknown>) => ({ ...prev, as: e.target.value as ProtoRole }), replace: true })
          }
          className="rounded-md border border-zinc-700 bg-zinc-800 px-1.5 py-1 text-xs text-zinc-50"
        >
          {(Object.keys(ROLE_LABELS) as ProtoRole[]).map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
      </label>
      <Button size="icon-sm" variant="ghost" className="text-zinc-50 hover:bg-zinc-800 hover:text-zinc-50" aria-label="Next design" onClick={() => go(step(variant, 1))}>
        <ChevronRight />
      </Button>
    </div>
  );
}
