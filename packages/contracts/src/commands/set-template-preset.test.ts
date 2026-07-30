import { describe, expect, it } from "vitest";
import { setTemplatePresetCommand } from "./set-template-preset.js";

const valid = {
  name: "set-template-preset",
  version: 1,
  envelope: {
    commandId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    idempotencyKey: "template-preset",
    origin: "API",
    sourceArtifactIds: [],
  },
  payload: {
    presetCode: "TRUCKING",
    enabled: true,
  },
};

describe("setTemplatePresetCommand", () => {
  it("accepts a valid preset command", () => {
    expect(setTemplatePresetCommand.parse(valid).payload.enabled).toBe(true);
  });

  it("rejects an unknown preset", () => {
    expect(
      setTemplatePresetCommand.safeParse({
        ...valid,
        payload: { ...valid.payload, presetCode: "HOVERCRAFT" },
      }).success,
    ).toBe(false);
  });

  it("rejects a non-boolean enabled value", () => {
    expect(
      setTemplatePresetCommand.safeParse({
        ...valid,
        payload: { ...valid.payload, enabled: "true" },
      }).success,
    ).toBe(false);
  });
});
