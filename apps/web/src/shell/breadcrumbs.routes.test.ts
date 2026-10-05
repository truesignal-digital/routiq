// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { MODULE_CODES } from "@routiq/contracts";
import { router } from "../router.js";
import { breadcrumbTrail } from "./breadcrumbs.js";
import { visibleSections } from "./sections.js";

const SECTIONS = visibleSections([...MODULE_CODES]);
const SECTION_ROOTS = new Set(SECTIONS.map((section) => section.to));

/** Every page the shell frames, read from the route tree so a new route is covered by default. */
function shellPaths(): string[] {
  const paths = new Set<string>();
  for (const route of Object.values(router.routesById)) {
    if (!route.id.startsWith("/app/")) continue;
    const path = route.fullPath.replace(/\/$/, "") || "/";
    paths.add(path);
  }
  return [...paths].sort();
}

function concrete(path: string): string {
  return path.replace(/\$[^/]+/g, "00000000-0000-4000-8000-000000000001");
}

describe("every route has a breadcrumb trail", () => {
  const paths = shellPaths();

  it("reads the route tree", () => {
    expect(paths).toContain("/activities/$activityId");
    expect(paths).toContain("/assets/$assetId/details");
    expect(paths).not.toContain("/login");
  });

  it.each(paths)("%s", (path) => {
    const trail = breadcrumbTrail(SECTIONS, concrete(path));

    if (path === "/") {
      expect(trail.map((crumb) => crumb.labelKey)).toEqual(["nav.home"]);
      return;
    }

    if (SECTION_ROOTS.has(path)) {
      expect(trail.length).toBeGreaterThanOrEqual(2);
      return;
    }

    // Below a section the trail names the page, so the phone gets a step back up.
    expect(trail.length, "Home › section › page").toBeGreaterThanOrEqual(3);
    expect(trail[trail.length - 2]?.to, "the crumb above the page links").toBeDefined();

    if (path.includes("$")) {
      expect(trail.at(-1)?.record, "a record route ends on the record").toBe(true);
    }
  });
});
