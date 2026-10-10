import type {
  ModuleCode,
  NavCountKey,
  ToggleableModuleCode,
  VehicleHistoryKind,
} from "@routiq/contracts";
import type { HomeCardKey } from "../dashboard/cards.js";
import { isRouteActive } from "../lib/route-match.js";
import type { ShellSection } from "../shell/sections.js";
import type { VehicleTab } from "../vehicle/VehicleTabsNav.js";
import type { PanelRef, VehicleActionKey } from "../vehicle/model.js";

/**
 * The module contract on the web side (AGENTS.md, "Core vs modules"). Core
 * owns the slots: the sidebar, the phone bar, Home, the vehicle's tabs,
 * actions, record panel and timeline, and the fields listed in FIELD_SLOTS.
 * A module fills them through its manifest under `src/modules/<module>/`;
 * the composition entry (`src/modules/index.ts`) installs the manifests, and
 * core reads them here without importing any module. A slot entry no
 * manifest claims belongs to core and is always there.
 *
 * Turning a module off removes every contribution its manifest names, for
 * every role, and a direct link to one of its pages shows that the module is
 * not included without loading its data. The server's module, role and
 * branch gates stay the authority; this only keeps the UI from offering
 * what the server will refuse.
 */

/** A field one module adds to a record another part of the app shows. */
export const FIELD_SLOTS = [
  /** A money entry's link to the work order it pays for (finance entry page, vehicle Money). */
  "entry.workOrderLink",
  /** A money entry's link to the trip it belongs to (finance entry page, vehicle Money). */
  "entry.tripLink",
  /** The fleet list's "Needs attention" tile counting grounded vehicles in its hint. */
  "assets.attentionGrounding",
  /** A trip's money: its entries and net on the trip's page. */
  "trip.money",
  /** The vehicle's status sentence naming its last trip, or that it has none. */
  "vehicle.lastTrip",
] as const;
export type FieldSlot = (typeof FIELD_SLOTS)[number];

/** Where a module's sidebar row goes: right after, or right before, the row it names. */
export type NavRowPlace = { after: string } | { before: string };

/** A sidebar row a module adds, placed beside the row `place` names, in its group. */
export interface ModuleNavRow extends Omit<ShellSection, "module"> {
  place: NavRowPlace;
}

const anchorOf = (place: NavRowPlace): string => ("after" in place ? place.after : place.before);

/** A count on a module's row; `listKey` is the query key its list refreshes under. */
export interface ModuleNavCount {
  key: NavCountKey;
  listKey: (workspaceSlug: string | undefined) => unknown[];
}

export type PanelKind = PanelRef["kind"];

export interface WebModuleManifest {
  code: ToggleableModuleCode;
  /**
   * Other modules whose code this module's screens import: a form that picks
   * a vehicle, a trip that shows its money. Only these may be imported
   * (`B1 module-boundaries`); anything shared more widely belongs in core.
   * Unlike the contract's `requires`, the vendor may still turn one of them
   * off: whatever it adds here goes with it.
   */
  uses: readonly ToggleableModuleCode[];
  navRows: readonly ModuleNavRow[];
  navCounts: readonly ModuleNavCount[];
  /** Home's tiles and panels. */
  homeCards: readonly HomeCardKey[];
  vehicleTabs: readonly VehicleTab[];
  vehicleActions: readonly VehicleActionKey[];
  /** Record kinds the vehicle's panel opens from `?panel=`. */
  recordPanels: readonly PanelKind[];
  /** The vehicle timeline's filters. */
  historyKinds: readonly VehicleHistoryKind[];
  fields: readonly FieldSlot[];
}

/** The slots a manifest fills by key, as opposed to nav rows, which it defines whole. */
export type KeyedSlot =
  | "navCounts"
  | "homeCards"
  | "vehicleTabs"
  | "vehicleActions"
  | "recordPanels"
  | "historyKinds"
  | "fields";

const KEYED_SLOTS: readonly KeyedSlot[] = [
  "navCounts",
  "homeCards",
  "vehicleTabs",
  "vehicleActions",
  "recordPanels",
  "historyKinds",
  "fields",
];

function keysOf(manifest: WebModuleManifest, slot: KeyedSlot): readonly string[] {
  return slot === "navCounts" ? manifest.navCounts.map((count) => count.key) : manifest[slot];
}

let installed: readonly WebModuleManifest[] = [];

/** Called once by the composition entry before the app renders (and by the test setup). */
export function installModules(manifests: readonly WebModuleManifest[]): void {
  installed = manifests;
}

export function installedModules(): readonly WebModuleManifest[] {
  return installed;
}

/** The module whose manifest claims this slot entry; undefined means core owns it. */
export function contributionOwner(slot: KeyedSlot, key: string): ToggleableModuleCode | undefined {
  return installed.find((manifest) => keysOf(manifest, slot).includes(key))?.code;
}

/**
 * Whether a slot entry shows for these modules: a core entry always, a
 * module's only while it is on. Unknown modules (membership still loading)
 * show no module's entries.
 */
export function contributes(
  slot: KeyedSlot,
  key: string,
  enabledModules: readonly ModuleCode[] | undefined,
): boolean {
  const owner = contributionOwner(slot, key);
  return owner === undefined || (enabledModules?.includes(owner) ?? false);
}

/** Every module's sidebar rows, each with its owner as `module`. */
export function moduleNavRows(): Array<ShellSection & { place: NavRowPlace }> {
  return installed.flatMap((manifest) =>
    manifest.navRows.map((row) => ({ ...row, module: manifest.code })),
  );
}

/** The module owning a page, by the subtree of one of its sidebar rows. */
export function pageOwner(pathname: string): { code: ToggleableModuleCode; row: ModuleNavRow } | undefined {
  for (const manifest of installed) {
    for (const row of manifest.navRows) {
      if (isRouteActive(row.match ?? row.to, pathname)) return { code: manifest.code, row };
    }
  }
  return undefined;
}

/** What each core slot holds, for checking the references a manifest makes. */
export interface SlotCatalogue {
  keys: Record<KeyedSlot, readonly string[]>;
  /** Sidebar rows core defines itself, by key. */
  coreNavRows: readonly string[];
  /** Codes with a contract manifest (`MODULE_MANIFESTS`). */
  modules: readonly ToggleableModuleCode[];
}

/**
 * Everything wrong with a set of web manifests, in words; empty when they
 * hold: a module without a contract manifest or with two web ones, a key no
 * slot has, an entry two owners claim, and a row placed after a row that
 * does not exist.
 */
export function webManifestProblems(
  manifests: readonly WebModuleManifest[],
  catalogue: SlotCatalogue,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const manifest of manifests) {
    if (seen.has(manifest.code)) problems.push(`${manifest.code} has two web manifests`);
    seen.add(manifest.code);
    if (!catalogue.modules.includes(manifest.code)) problems.push(`${manifest.code} has no contract manifest`);
    for (const used of manifest.uses) {
      if (used === manifest.code) problems.push(`${manifest.code} uses itself`);
      else if (!catalogue.modules.includes(used)) problems.push(`${manifest.code} uses ${used}, which has no contract manifest`);
    }
  }

  for (const slot of KEYED_SLOTS) {
    const owners = new Map<string, string>();
    for (const manifest of manifests) {
      for (const key of keysOf(manifest, slot)) {
        if (!catalogue.keys[slot].includes(key)) problems.push(`${manifest.code} names ${slot} "${key}", which does not exist`);
        const owner = owners.get(key);
        if (owner !== undefined) problems.push(`${slot} "${key}" is claimed by ${owner} and ${manifest.code}`);
        owners.set(key, manifest.code);
      }
    }
  }

  const rowKeys = new Set(catalogue.coreNavRows);
  const rows = manifests.flatMap((manifest) => manifest.navRows.map((row) => ({ code: manifest.code, row })));
  for (const { code, row } of rows) {
    if (rowKeys.has(row.key)) problems.push(`sidebar row "${row.key}" of ${code} already exists`);
    rowKeys.add(row.key);
  }
  for (const { code, row } of rows) {
    const anchor = anchorOf(row.place);
    if (!rowKeys.has(anchor)) problems.push(`sidebar row "${row.key}" of ${code} is placed by "${anchor}", which does not exist`);
  }
  return problems;
}
