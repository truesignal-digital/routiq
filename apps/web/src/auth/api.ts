import { loginResponse, type LoginRequest } from "@asset/contracts";
import { extractApiError } from "../lib/api-error.js";
import type { StoredSession } from "./session.js";

export type LoginResult =
  | { ok: true; session: StoredSession }
  | { ok: false; code: string };

export async function login(
  request: LoginRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<LoginResult> {
  let response: Response;
  try {
    response = await fetchImpl("/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch {
    return { ok: false, code: "NETWORK_ERROR" };
  }

  const body: unknown = await response.json().catch(() => undefined);

  if (response.ok) {
    const parsed = loginResponse.safeParse(body);
    if (parsed.success) {
      return {
        ok: true,
        session: {
          username: request.username,
          workspaceSlug: request.workspaceSlug,
          token: parsed.data.token,
          expiresAt: parsed.data.expiresAt,
        },
      };
    }
  }

  return { ok: false, code: extractApiError(body, "AUTH_FAILED").code };
}
