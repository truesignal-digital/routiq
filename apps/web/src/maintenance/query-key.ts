/** Every maintenance read hangs off one key prefix, so one write invalidates all of them. */
export function maintenanceQueryKey(workspaceSlug: string | undefined): unknown[] {
  return ["ws", workspaceSlug, "maintenance"];
}
