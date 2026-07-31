// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { i18n } from "../i18n/index.js";
import { ProvenanceStamp } from "./provenance-stamp.js";

const COMMAND_ID = "3f1a9c40-1f2b-4d5e-9a77-2c0b1d8e4f60";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

afterEach(cleanup);

describe("provenance stamp", () => {
  it("names the template, the date and the command that wrote the row", () => {
    render(
      <ProvenanceStamp
        templateCode="TRUCKING"
        templateVersion={2}
        createdAt="2026-07-18T06:00:00.000Z"
        commandId={COMMAND_ID}
      />,
    );

    const stamp = screen.getByText(/TRUCKING v2/);
    expect(stamp.textContent).toContain("created");
    expect(stamp.textContent).toContain("command 3f1a9c40");
    // The short id is for reading; the full one has to stay recoverable.
    expect(stamp.getAttribute("title")).toBe(COMMAND_ID);
  });

  it("omits the parts it was not given rather than printing blanks", () => {
    render(<ProvenanceStamp templateCode="PASSENGER_TRANSPORT" templateVersion={1} />);

    const stamp = screen.getByText("PASSENGER_TRANSPORT v1");
    expect(stamp.textContent).not.toContain("·");
  });

  it("renders nothing when it knows nothing", () => {
    const { container } = render(<ProvenanceStamp />);

    expect(container.innerHTML).toBe("");
  });

  it("survives a row whose command was never recorded", () => {
    render(
      <ProvenanceStamp
        templateCode="TRUCKING"
        templateVersion={1}
        createdAt="2026-07-18T06:00:00.000Z"
        commandId={null}
      />,
    );

    const stamp = screen.getByText(/TRUCKING v1/);
    expect(stamp.textContent).not.toContain("command");
    expect(stamp.getAttribute("title")).toBeNull();
  });
});
