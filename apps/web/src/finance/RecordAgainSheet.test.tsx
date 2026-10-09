// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/auth/store.js", () => ({
  useActiveSession: () => ({ workspaceSlug: "transports-ngwa" }),
}));

vi.mock("@/finance/useEntry.js", () => ({
  useEntry: () => ({ data: { id: "entry-1", entryNumber: "DLA-2026-00008" } }),
}));

// The form itself has its own tests; here it only stands for "the new entry was recorded".
vi.mock("@/finance/RecordEntryForm.js", () => ({
  RecordEntryForm: ({ onRecorded }: { onRecorded: () => void }) => (
    <button type="button" onClick={onRecorded}>
      record
    </button>
  ),
}));

import { RecordAgainSheet } from "./RecordAgainSheet.js";

afterEach(cleanup);

it("refreshes the finance reads once the entry is recorded again, then closes (#525)", async () => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <RecordAgainSheet entryId="entry-1" onClose={onClose} />
    </QueryClientProvider>,
  );

  await userEvent.setup().click(screen.getByRole("button", { name: "record" }));

  expect(invalidate).toHaveBeenCalledWith({ queryKey: ["ws", "transports-ngwa", "finance"] });
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
});
