function withoutTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/**
 * Whole-segment exact-or-child match. A bare `startsWith` would light up
 * `/assets` for `/assets-archive`, and a route whose path is a sibling would
 * steal its neighbour's highlight. Shared by the shell sidebar and the finance
 * tabs so the two cannot drift apart on what "active" means.
 */
export function isRouteActive(root: string, pathname: string): boolean {
  const base = withoutTrailingSlash(root);
  const path = withoutTrailingSlash(pathname);
  return path === base || path.startsWith(`${base}/`);
}
