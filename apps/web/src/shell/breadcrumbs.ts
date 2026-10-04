import { activeSection, type ShellSection } from "./sections.js";

export interface Crumb {
  /** Translation key; this module stays free of i18n so it can be unit-tested. */
  labelKey: string;
  /** Where the crumb navigates. The trail's last crumb is the current page and has none. */
  to?: string;
}

interface PageTrail {
  /** Router path, `$param` segments matching any single segment. */
  pattern: string;
  /** Crumbs below the shell section, outermost first. */
  trail: readonly Crumb[];
}

/**
 * What sits under a section, per route. Deliberately its own table rather than
 * a reuse of the finance tab list: the tabs are permission-filtered and no
 * longer include Saisie, but a breadcrumb has to name whatever page you are
 * actually looking at.
 */
const PAGE_TRAILS: readonly PageTrail[] = [
  { pattern: "/assets/new", trail: [{ labelKey: "assets.register" }] },
  // The vehicle workspace: its sections are tabs on one record, so every
  // section shares the record's crumb and the tabs say where you are.
  ...["", "/maintenance", "/money", "/trips", "/documents", "/history", "/details"].map((section) => ({
    pattern: `/assets/$assetId${section}`,
    trail: [{ labelKey: "assets.detail.breadcrumb" }],
  })),
  { pattern: "/finance/record", trail: [{ labelKey: "finance.navigation.record" }] },
  { pattern: "/finance/entries", trail: [{ labelKey: "finance.navigation.entries" }] },
  {
    pattern: "/finance/entries/$entryId",
    trail: [
      { labelKey: "finance.navigation.entries", to: "/finance/entries" },
      { labelKey: "finance.entries.detail.breadcrumb" },
    ],
  },
  {
    pattern: "/finance/approvals",
    trail: [{ labelKey: "finance.navigation.approvals" }],
  },
  { pattern: "/finance/periods", trail: [{ labelKey: "finance.navigation.periods" }] },
  { pattern: "/more/persons", trail: [{ labelKey: "persons.title" }] },
  { pattern: "/more/users", trail: [{ labelKey: "users.title" }] },
  { pattern: "/more/branches", trail: [{ labelKey: "branches.title" }] },
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

/**
 * `Accueil / <section> / <page>` for the current location. The last crumb is
 * always the page you are on and carries no `to`; everything before it links.
 */
export function breadcrumbTrail(
  sections: readonly ShellSection[],
  pathname: string,
): Crumb[] {
  const crumbs: Crumb[] = [{ labelKey: "nav.home", to: "/" }];

  const section = activeSection(sections, pathname);
  // The home section is the crumb we just seeded; anything else nests under it.
  if (section !== undefined && section.key !== "home") {
    crumbs.push({ labelKey: `nav.${section.key}`, to: section.to });
  }

  const page = PAGE_TRAILS.find(({ pattern }) => matchesPattern(pattern, pathname));
  if (page !== undefined) {
    crumbs.push(...page.trail);
  }

  const last = crumbs[crumbs.length - 1];
  if (last !== undefined) {
    // You are already here; a link back to the current page is noise.
    crumbs[crumbs.length - 1] = { labelKey: last.labelKey };
  }

  return crumbs;
}
