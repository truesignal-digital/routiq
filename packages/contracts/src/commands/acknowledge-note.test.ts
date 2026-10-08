import { describe, expect, it } from "vitest";
import { acknowledgeNoteCommand } from "./acknowledge-note.js";

const envelope = {
  commandId: "c3d4e5f6-a7b8-49c0-91e2-f3a4b5c6d7e8",
  idempotencyKey: "seen-001",
  origin: "HUMAN_UI" as const,
  sourceArtifactIds: [],
};
const noteId = "550e8400-e29b-41d4-a716-446655440000";

function rejectedPaths(input: unknown): string[] {
  const result = acknowledgeNoteCommand.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("acknowledge-note contract", () => {
  const command = (payload: unknown) => ({ name: "acknowledge-note", version: 1, envelope, payload });

  it("names only the note", () => {
    expect(acknowledgeNoteCommand.parse(command({ noteId })).payload).toEqual({ noteId });
  });

  it("requires a note id", () => {
    expect(rejectedPaths(command({}))).toEqual(["payload.noteId"]);
    expect(rejectedPaths(command({ noteId: "nope" }))).toEqual(["payload.noteId"]);
  });

  it("refuses a member named by the client: who saw it comes from the session", () => {
    expect(rejectedPaths(command({ noteId, membershipId: noteId }))).toEqual(["payload"]);
  });
});
