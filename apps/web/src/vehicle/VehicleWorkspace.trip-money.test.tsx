// @vitest-environment jsdom
import type { ActivityDetail, Role } from "@routiq/contracts";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ASSET_ID, TRIP_ID, tripRow } from "./test/fixtures.js";
import { closeVehicle, openVehicle } from "./test/harness.js";

vi.mock("../components/ui/file-upload.js", () => ({ FileUpload: () => null }));

afterEach(async () => {
  cleanup();
  await closeVehicle();
});

/** A trip nobody has booked money on yet. */
function emptyTrip(): ActivityDetail {
  return {
    ...tripRow(),
    branchCode: "DLA",
    templateCode: "TRUCKING",
    templateVersion: 1,
    customValues: {},
    description: null,
    plannedStartAt: null,
    plannedEndAt: null,
    closedAt: null,
    createdAt: "2026-07-29T05:30:00.000Z",
    createdByCommandId: null,
    recordedByPrincipalId: null,
    rowVersion: 1,
    segments: [],
    crew: [],
    legs: [],
    readings: [],
    financialEntries: [],
  };
}

/**
 * #408: the empty sentence says whose entries are missing from the reader's
 * entries scope. The counter reads its branches' entries, not only its own.
 */
describe("the trip panel's money, per entries scope (#408)", () => {
  const sentences = {
    en: {
      own: "You have not recorded any entry on this trip.",
      branch: "No entry from your branches on this trip yet.",
    },
    "fr-CM": {
      own: "Vous n'avez saisi aucune écriture sur ce voyage.",
      branch: "Aucune écriture de vos agences sur ce voyage pour l'instant.",
    },
  } as const;

  async function moneySection(role: Role, locale: "en" | "fr-CM") {
    await openVehicle(`/assets/${ASSET_ID}/trips?panel=trip:${TRIP_ID}`, {
      role,
      locale,
      trips: [tripRow()],
      tripDetails: [emptyTrip()],
    });
    return within(await screen.findByRole("dialog"));
  }

  for (const locale of ["en", "fr-CM"] as const) {
    it(`tells the driver and the cashier apart on the same empty trip (${locale})`, async () => {
      const { own, branch } = sentences[locale];

      const driver = await moneySection("DRIVER", locale);
      expect(await driver.findByText(own)).toBeTruthy();
      expect(driver.queryByText(branch)).toBeNull();
      cleanup();
      await closeVehicle();

      const cashier = await moneySection("CASHIER", locale);
      expect(await cashier.findByText(branch)).toBeTruthy();
      expect(cashier.queryByText(own)).toBeNull();
    });
  }
});
