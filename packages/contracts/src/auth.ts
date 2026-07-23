import { z } from "zod";

/** Username/PIN login for admin-provisioned users — no email flow (§6a guard 1). */
export const loginRequest = z.object({
  workspaceSlug: z.string().min(1).max(80),
  username: z.string().min(1).max(80),
  pin: z.string().min(4).max(64),
});

export type LoginRequest = z.infer<typeof loginRequest>;
