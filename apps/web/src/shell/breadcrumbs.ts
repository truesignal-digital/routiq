import { activeSection, isSectionActive, type ShellSection } from "./sections.js";

export interface Crumb {
  /** Translation key; this module stays free of i18n so it can be unit-tested. */
  labelKey: string;
  /** The record's own name (a trip's number), shown instead of `labelKey` once the screen has it. */
  label?: string;
  /** Where the crumb navigates. The trail's last crumb is the current page and has none. */
  to?: string;
  /** The crumb naming the record a detail route shows. */
  record?: true;
}

interface PageTrail {
  /** Router path, `$param` segments matching any single segment. */
  pattern: string;
  /** Crumbs below the shell section, outermost first. */
  trail: readonly Crumb[];
  /**
   * The section key to file the page under when the viewer does not have the
   * section that owns the route: a driver has no Money, so their entry sits
   * under their truck (#584).
   */
  elsewhere?: string;
}

/**
 * What sits under a section, per route. Deliberately its own table rather than
 * a reuse of the finance tab list: the tabs are permission-filtered and no
 * longer include Saisie, but a breadcrumb has to name whatever page you are
 * actually looking at.
 */
export const PAGE_TRAILS: readonly PageTrail[] = [
  { pattern: "/assets/new", trail: [{ labelKey: "commands.register-asset.label" }] },
  // The vehicle workspace: its sections are tabs on one record, so every
  // section shares the record's crumb and the tabs say where you are.
  ...["", "/maintenance", "/money", "/trips", "/documents", "/history", "/details"].map((section) => ({
    pattern: `/assets/$assetId${section}`,
    trail: [{ labelKey: "assets.detail.breadcrumb", record: true as const }],
  })),
  // Before the $activityId pattern, or "record" reads as a trip.
  { pattern: "/activities/record", trail: [{ labelKey: "commands.record-journey-sheet.label" }] },
  {
    pattern: "/activities/$activityId",
    trail: [{ labelKey: "activities.detail.breadcrumb", record: true }],
  },
  { pattern: "/finance/record", trail: [{ labelKey: "finance.navigation.record" }] },
  // The page title keys, so the Money and Accounting months rows name these pages once.
  { pattern: "/finance/entries", trail: [{ labelKey: "finance.entries.title" }] },
  {
    pattern: "/finance/entries/$entryId",
    trail: [
      { labelKey: "finance.entries.title", to: "/finance/entries" },
      { labelKey: "finance.entries.detail.breadcrumb", record: true },
    ],
    elsewhere: "assets",
  },
  // Redirects to the waiting view; named the same in case a frame renders first.
  { pattern: "/finance/approvals", trail: [{ labelKey: "finance.money.lens.waiting" }] },
  { pattern: "/finance/periods", trail: [{ labelKey: "finance.periods.title" }] },
  { pattern: "/my-settings", trail: [{ labelKey: "mySettings.title" }] },
  { pattern: "/more/persons", trail: [{ labelKey: "persons.title" }] },
  { pattern: "/more/users", trail: [{ labelKey: "users.title" }] },
  { pattern: "/more/branches", trail: [{ labelKey: "branches.title" }] },
  { pattern: "/more/company", trail: [{ labelKey: "settings.title" }] },
];

function segments(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "");
}

function matchesPattern(pattern: string, pathname: string): boolean {
  const expected = segments(pattern);
  const actual = segments(pathname);
  if (expected.length !== actual.length) return false;
  return expected.every(
    (segment, index) => segment.startsWith("$") || segment === actual[index],
  );
}

function reachable(sections: readonly ShellSection[], to: string | undefined): boolean {
  return to === undefined || sections.some((section) => isSectionActive(section, to));
}

/**
 * `Accueil / <section> / <page>` for the current location. The last crumb is
 * always the page you are on and carries no `to`; everything before it links.
 * `recordLabel` names the record on a detail route; until the screen has
 * loaded it the crumb says what kind of record it is.
 */
export function breadcrumbTrail(
  sections: readonly ShellSection[],
  pathname: string,
  recordLabel?: string,
): Crumb[] {
  const crumbs: Crumb[] = [{ labelKey: "home.title", to: "/" }];

  const page = PAGE_TRAILS.find(({ pattern }) => matchesPattern(pattern, pathname));
  const section =
    activeSection(sections, pathname) ?? sections.find(({ key }) => key === page?.elsewhere);
  // The home section is the crumb we just seeded; anything else nests under it.
  if (section !== undefined && section.key !== "home") {
    crumbs.push({ labelKey: section.labelKey, to: section.to });
  }

  if (page !== undefined) {
    crumbs.push(
      ...page.trail.filter(
        (crumb) =>
          // A page that is itself a sidebar row (Users, Branches) is already named by its section crumb.
          crumb.labelKey !== section?.labelKey &&
          // A link into a place the viewer does not have would open a page they cannot use.
          reachable(sections, crumb.to),
      ),
    );
  }

  const last = crumbs[crumbs.length - 1];
  if (last !== undefined) {
    // You are already here; a link back to the current page is noise.
    const label = last.record === true ? recordLabel : undefined;
    crumbs[crumbs.length - 1] = {
      labelKey: last.labelKey,
      ...(last.record === true && { record: true }),
      ...(label !== undefined && { label }),
    };
  }

  return crumbs;
}
