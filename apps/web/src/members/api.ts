import type { MemberListItem } from "@routiq/contracts";

export interface MemberListResponse {
  items: MemberListItem[];
  nextCursor: string | null;
}

export interface MemberListParams {
  /** Off by default server-side; the screen turns it on to reactivate someone. */
  includeDeactivated?: boolean;
  /** `field:asc|desc` over the read's declared sortFields; the cursor keys on it. */
  sort?: string;
  cursor?: string;
  limit?: number;
}

function memberQuery(params: MemberListParams): string {
  const query = new URLSearchParams();
  if (params.includeDeactivated) query.append("includeDeactivated", "true");
  if (params.sort) query.append("sort", params.sort);
  if (params.cursor) query.append("cursor", params.cursor);
  if (params.limit !== undefined) query.append("limit", String(params.limit));
  const search = query.toString();
  return search === "" ? "" : `?${search}`;
}

export async function fetchMembers(
  token: string,
  params: MemberListParams = {},
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<MemberListResponse> {
  const response = await fetchImpl(`/v1/members${memberQuery(params)}`, {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`MEMBERS_${response.status}`);
  return (await response.json()) as MemberListResponse;
}
