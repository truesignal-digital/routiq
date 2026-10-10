import { QueryClient, queryOptions } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { QUERY_DEFAULTS } from "../lib/query-defaults.js";
import { ensure } from "./scope.js";

function failingOnce(retry?: false) {
  let calls = 0;
  const options = queryOptions({
    queryKey: ["flaky", retry ?? "default"],
    ...(retry === undefined ? {} : { retry }),
    queryFn: async () => {
      calls += 1;
      if (calls === 1) throw new Error("dropped");
      return "rows";
    },
  });
  return { options, calls: () => calls };
}

const client = () => new QueryClient({ defaultOptions: { queries: { ...QUERY_DEFAULTS, retryDelay: 0 } } });

it("makes a read's retries in a loader, as its hook would, so one dropped request is not an error screen (#496)", async () => {
  const read = failingOnce();
  await expect(ensure(client(), read.options)).resolves.toBe("rows");
  expect(read.calls()).toBe(2);
});

it("keeps a read's own no-retry policy", async () => {
  const read = failingOnce(false);
  await expect(ensure(client(), read.options)).rejects.toThrow("dropped");
  expect(read.calls()).toBe(1);
});
