/** The only workspaces `seed-demo` writes to, and so the only ones `--reset` may delete. */
export const DEMO_WORKSPACE_SLUGS = ["transports-ngwa", "littoral-voyages"] as const;

export function assertResettable(slug: string): void {
  if (!(DEMO_WORKSPACE_SLUGS as readonly string[]).includes(slug)) {
    throw new Error(
      `Refusing to reset workspace "${slug}"; only ${DEMO_WORKSPACE_SLUGS.map((demo) => `"${demo}"`).join(" and ")} may be reset.`,
    );
  }
}
