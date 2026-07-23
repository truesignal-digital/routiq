/** Extract the stable error code + metadata from an API error body. */
export function extractApiError(
  body: unknown,
  fallbackCode: string,
): { code: string; metadata?: Record<string, unknown> } {
  if (typeof body === "object" && body !== null && "error" in body) {
    const error = (body as { error: unknown }).error;
    if (typeof error === "object" && error !== null && "code" in error) {
      const { code, metadata } = error as { code: unknown; metadata?: unknown };
      if (typeof code === "string") {
        return {
          code,
          ...(typeof metadata === "object" && metadata !== null
            ? { metadata: metadata as Record<string, unknown> }
            : {}),
        };
      }
    }
  }
  return { code: fallbackCode };
}
