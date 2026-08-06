import type { BranchListItem } from "@routiq/contracts";

export interface BranchListResponse {
  items: BranchListItem[];
  nextCursor: string | null;
}

export interface BranchListParams {
  /** `field:asc|desc` over the read's declared sortFields; the cursor keys on it. */
  sort?: string;
  cursor?: string;
  limit?: number;
}

function branchQuery(params: BranchListParams): string {
  const query = new URLSearchParams();
  if (params.sort) query.append("sort", params.sort);
  if (params.cursor) query.append("cursor", params.cursor);
  if (params.limit !== undefined) query.append("limit", String(params.limit));
  const search = query.toString();
  return search === "" ? "" : `?${search}`;
}

export async function fetchBranches(
  token: string,
  params: BranchListParams = {},
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<BranchListResponse> {
  const response = await fetchImpl(`/v1/branches${branchQuery(params)}`, {
    headers: { authorization: `Bearer ${token}` },
    ...(signal === undefined ? {} : { signal }),
  });
  if (!response.ok) throw new Error(`BRANCHES_${response.status}`);
  return (await response.json()) as BranchListResponse;
}
