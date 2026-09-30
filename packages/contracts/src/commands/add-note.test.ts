import { describe, expect, it } from "vitest";
import { addNotePayload, NOTE_BODY_MAX } from "./add-note.js";

const valid = {
  noteId: "3f6b2a7c-9d41-4a52-8b0e-2c1d5e6f7a8b",
  entityType: "asset",
  entityId: "0b8a4c1e-6f2d-4e3a-9c5b-7d1e2f3a4b5c",
  body: "Pneu avant gauche à surveiller",
};

describe("addNotePayload", () => {
  it("accepts a note on a vehicle and trims its body", () => {
    expect(addNotePayload.parse({ ...valid, body: "  Pneu à surveiller \n" })).toEqual({
      ...valid,
      body: "Pneu à surveiller",
    });
  });

  it("refuses an empty or whitespace-only body", () => {
    expect(addNotePayload.safeParse({ ...valid, body: "" }).success).toBe(false);
    expect(addNotePayload.safeParse({ ...valid, body: "   " }).success).toBe(false);
  });

  it("caps the body at 2000 characters", () => {
    expect(addNotePayload.safeParse({ ...valid, body: "x".repeat(NOTE_BODY_MAX) }).success).toBe(true);
    expect(addNotePayload.safeParse({ ...valid, body: "x".repeat(NOTE_BODY_MAX + 1) }).success).toBe(
      false,
    );
  });

  it("annotates vehicles only, and nothing it does not name", () => {
    expect(addNotePayload.safeParse({ ...valid, entityType: "work_order" }).success).toBe(false);
    expect(addNotePayload.safeParse({ ...valid, authorId: valid.noteId }).success).toBe(false);
  });
});
