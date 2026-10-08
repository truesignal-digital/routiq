// @vitest-environment jsdom
import type { ApprovalThresholdsResponse } from "@routiq/contracts";
import { screen } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { expect } from "vitest";
import { describeCommandForm } from "../test/form-harness.js";
import { ChangeThresholdsForm } from "./ChangeThresholdsForm.js";

const current: ApprovalThresholdsResponse = {
  currency: "XAF",
  version: 12,
  recordingThresholdMinor: 100_000,
  financeCeilingMinor: 1_000_000,
  roles: [],
  overrides: [],
  affectedRoles: ["ADMIN", "FINANCE"],
  lastChange: null,
};

const recording = () => screen.getByLabelText<HTMLInputElement>("Posts directly up to");
const ceiling = () => screen.getByLabelText<HTMLInputElement>("Finance approves up to");

async function retype(user: UserEvent, field: HTMLInputElement, value: string) {
  await user.clear(field);
  if (value !== "") await user.type(field, value);
}

describeCommandForm("ChangeThresholdsForm", {
  command: "update-approval-threshold",
  version: 2,
  render: ({ client, onDismiss }) => (
    <ChangeThresholdsForm
      current={current}
      recordingThresholdMinor={100_000}
      financeCeilingMinor={1_000_000}
      client={client}
      onDone={onDismiss}
      onReload={async () => {}}
    />
  ),
  opened: () => {
    expect(recording().value).toBe("100,000");
    expect(ceiling().value).toBe("1,000,000");
    expect(screen.getByText("Change an amount to save.")).toBeTruthy();
  },
  // The form opens on the current bands and sends nothing while they are unchanged.
  empty: async (user) => {
    await retype(user, recording(), "");
    await retype(user, ceiling(), "");
  },
  fill: async (user) => {
    await retype(user, recording(), "200000");
    await retype(user, ceiling(), "2000000");
    // Leaving the field lays the amount out (2,000,000), as the submit's blur would.
    await user.tab();
  },
  payload: { recordingThresholdMinor: 200_000, financeCeilingMinor: 2_000_000 },
  refusal: "RECORDING_THRESHOLD_NOT_BELOW_CEILING",
});
