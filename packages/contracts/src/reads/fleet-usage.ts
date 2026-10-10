import { z } from "zod";
import { moneyMinor } from "../envelope.js";
import { monthCode } from "./finance.js";
import { OVERVIEW_RANGES } from "./finance-overview.js";

/**
 * Km and daily status (#668, dashboards.html#trucks, #money, #data): what each
 * vehicle drove and did, and what a km cost. Counted by the server inside the
 * caller's branch scope, never invented: a vehicle whose km is not known is
 * said to be, and is left out of every per-km figure.
 *
 * Km of a trip (`TRIP_KM_RULE`): the km its legs record. A trip whose legs
 * record none uses its odometer instead, the end reading of the vehicle's
 * segment less its start reading. The two are never added. A trip with
 * neither has no km, and the vehicle's km for the period is then not known.
 * A vehicle's km for a period are the km of the trips closed in it that it
 * carried; a vehicle that closed no trip drove 0 known km.
 */
export const TRIP_KM_RULE = "LEGS_THEN_ODOMETER" as const;

/**
 * A vehicle's day, judged in the workspace's time zone, the most serious fact
 * first:
 * - GROUNDED: under an availability interval (a safety problem grounded it).
 * - WORKSHOP: under a work order that was approved (APPROVED,
 *   COMPLETION_SUBMITTED or COMPLETED), from its creation until its
 *   completion was recorded. Orders still waiting approval, rejected or
 *   cancelled hold no day.
 * - ON_TRIP: it carried a started trip (PRIMARY or SUBSTITUTE segment).
 * - AVAILABLE: none of these, on a day ROUTIQ could have recorded a trip.
 * - NOT_RECORDED: nothing can tell. Before the vehicle was commissioned (or,
 *   with no commissioning date on file, added), every day of one never
 *   commissioned, and every day without a fact while Trips is off.
 * The Maintenance facts count only while Maintenance is on.
 */
export const DAILY_STATUSES = ["GROUNDED", "WORKSHOP", "ON_TRIP", "AVAILABLE", "NOT_RECORDED"] as const;
export type DailyStatus = (typeof DAILY_STATUSES)[number];

/** Days the fleet board draws, today last; "on the road %" compares them with the same number before. */
export const FLEET_BOARD_DAYS = 30;

/** Months of days off the road, the current (partial) month last. */
export const OFF_ROAD_MONTHS = 12;

/** A vehicle whose fuel per km is more than this share above the fleet median is a To do row. */
export const FUEL_OUTLIER_PERCENT = 20;

/** At most this many routes, by km driven. */
export const FLEET_USAGE_ROUTE_LIMIT = 12;

// Every schema is built inside a pure call: the web reads these shapes by
// their types only, and a bundler keeps every argument of a top-level zod
// call, so written flat they would ship in the first load unused.

/**
 * `GET /v1/assets/usage`. The range picks the km and money window, as on the
 * money Overview; the board always shows the last FLEET_BOARD_DAYS days.
 * `branchId` narrows inside the caller's branch scope, never widens it.
 */
export const fleetUsageQuery = /* @__PURE__ */ (() =>
  z.object({
    range: z.enum(OVERVIEW_RANGES).default("THIS_MONTH"),
    branchId: z.uuid().optional(),
  }))();
export type FleetUsageQuery = z.infer<typeof fleetUsageQuery>;

export const fleetUsageResponse = /* @__PURE__ */ (() => {
  const count = z.number().int().nonnegative();
  const window = z.object({ from: z.iso.date(), to: z.iso.date() });

  /** Km for one window: null when Trips is off. */
  const vehicleKm = z.object({
    /** Km of the trips closed in the window that it carried, by TRIP_KM_RULE; known trips only. */
    km: count,
    /** Every trip has km (or it carried none): `km` is the vehicle's whole km. */
    known: z.boolean(),
    tripsClosed: count,
    /** Trips whose km came from the odometer because their legs record none. */
    tripsFromOdometer: count,
    /** Trips with neither: what `km` leaves out. */
    tripsWithoutKm: count,
  });

  /**
   * Money recorded on the vehicle in the period (posted, workspace currency,
   * the money Overview's own lines) and its cost per km. A per-km figure is
   * null when the km are not known, are zero, or nothing was recorded: it is
   * never 0 for "no expense on file".
   */
  const vehicleMoney = z.object({
    expenseMinor: moneyMinor,
    /** Of `expenseMinor`, the lines in the FUEL category. */
    fuelExpenseMinor: moneyMinor,
    costPerKmMinor: moneyMinor.nullable(),
    fuelPerKmMinor: moneyMinor.nullable(),
    /** Whole percent above the fleet median fuel per km; null when not above it or not known. */
    fuelAboveMedianPercent: z.number().int().positive().nullable(),
  });

  const onTheRoad = z.object({
    /** Vehicle-days ON_TRIP. */
    tripDays: count,
    /** Vehicle-days with a status other than NOT_RECORDED: the share's base. */
    recordedDays: count,
    /** Vehicle-days NOT_RECORDED, left out of the share. */
    notRecordedDays: count,
  });

  const fleetKm = z.object({
    /** Vehicles listed (the fleet), and those whose km are known. */
    vehicles: count,
    knownVehicles: count,
    /** Sum of `km` over the vehicles whose km are known. */
    knownKm: count,
  });

  const loadKm = z.object({
    /** Km of legs recorded EMPTY. */
    emptyKm: count,
    /** Km of legs recorded LADEN or PARTIAL. */
    loadedKm: count,
    /** Km of legs that record a distance but no load: left out of the share. */
    unknownLoadKm: count,
  });

  return z
    .object({
      range: z.enum(OVERVIEW_RANGES),
      branchId: z.uuid().nullable(),
      /** Today in the workspace time zone: the board's last day. */
      businessDate: z.iso.date(),
      /** The km and money window, and the one it is compared with (the money Overview's windows). */
      period: window,
      comparison: window,
      kmRule: z.literal(TRIP_KM_RULE),
      /** The board's days, oldest first, today last. */
      boardDays: z.array(z.iso.date()).length(FLEET_BOARD_DAYS),
      /**
       * Every active vehicle of the caller's branches (narrowed by
       * `branchId`), by code.
       */
      vehicles: z.array(
        z.object({
          assetId: z.uuid(),
          assetCode: z.string(),
          registrationNumber: z.string().nullable(),
          branchId: z.uuid(),
          /** One status per board day, oldest first. */
          days: z.array(z.enum(DAILY_STATUSES)).length(FLEET_BOARD_DAYS),
          period: vehicleKm.nullable(),
          comparison: vehicleKm.nullable(),
          /** Null for a role that does not read vehicle money, or with Money off. */
          money: vehicleMoney.nullable(),
        }),
      ),
      /** Null when Trips is off: no km is known without it. */
      km: z.object({ period: fleetKm, comparison: fleetKm }).nullable(),
      /** The board's days and the same number of days before them. */
      onTheRoad: z.object({ last: onTheRoad, previous: onTheRoad }),
      /**
       * Vehicle-days GROUNDED or WORKSHOP per month, oldest first, the current
       * month (partial) last. Null when Maintenance is off.
       */
      offRoadByMonth: z
        .array(
          z.object({
            periodCode: monthCode,
            days: count,
            /** The current month, counted to today. */
            partial: z.boolean(),
          }),
        )
        .length(OFF_ROAD_MONTHS)
        .nullable(),
      /**
       * Fleet cost per km and the medians. Null for a role that does not read
       * vehicle money, or with Money or Trips off.
       */
      money: z
        .object({
          currency: z.string().length(3),
          /**
           * Σ expenses ÷ Σ km over the vehicles whose cost per km is known; the
           * vehicles left out are not in either sum.
           */
          period: z.object({
            costPerKmMinor: moneyMinor.nullable(),
            expenseMinor: moneyMinor,
            km: count,
            vehicles: count,
          }),
          comparison: z.object({
            costPerKmMinor: moneyMinor.nullable(),
            expenseMinor: moneyMinor,
            km: count,
            vehicles: count,
          }),
          /** Medians over the vehicles whose figure is known; null with none. */
          costPerKmMedianMinor: moneyMinor.nullable(),
          fuelPerKmMedianMinor: moneyMinor.nullable(),
        })
        .nullable(),
      /**
       * Trips closed in the period that the caller may read. Null when Trips
       * is off.
       */
      trips: z
        .object({
          period: loadKm,
          comparison: loadKm,
          /**
           * By route, the trip's first leg from its origin to its destination,
           * either way round; km are every leg of the trip (TRIP_KM_RULE), empty
           * returns included. Most km first, at most FLEET_USAGE_ROUTE_LIMIT.
           */
          routes: z
            .array(
              z.object({
                key: z.string(),
                /** The two ends, alphabetically. */
                from: z.string(),
                to: z.string(),
                trips: count,
                /** Trips with km; only these count in `km` and `revenueMinor`. */
                tripsWithKm: count,
                km: count,
                /** Posted revenue on those trips; null without vehicle money. */
                revenueMinor: moneyMinor.nullable(),
                revenuePerKmMinor: moneyMinor.nullable(),
              }),
            )
            .max(FLEET_USAGE_ROUTE_LIMIT),
          /** Routes past the limit, and closed trips with no leg (no route). */
          otherRoutes: count,
          tripsWithoutRoute: count,
        })
        .nullable(),
    })
    .superRefine((body, ctx) => {
      // Money is all or nothing, so no section can leak it to a role that
      // does not read vehicle money.
      const vehicleMoney = body.vehicles.some((vehicle) => vehicle.money !== null);
      const routeMoney = body.trips?.routes.some((route) => route.revenueMinor !== null || route.revenuePerKmMinor !== null) ?? false;
      if (body.money === null && (vehicleMoney || routeMoney)) {
        ctx.addIssue({ code: "custom", message: "money-derived values need the money section" });
      }
      if (body.money !== null && body.vehicles.some((vehicle) => vehicle.money === null)) {
        ctx.addIssue({ code: "custom", message: "every vehicle carries its money when money is shown" });
      }
    });
})();

export type FleetUsageResponse = z.infer<typeof fleetUsageResponse>;
export type FleetUsageVehicle = FleetUsageResponse["vehicles"][number];
export type FleetUsageVehicleKm = NonNullable<FleetUsageVehicle["period"]>;
export type FleetUsageVehicleMoney = NonNullable<FleetUsageVehicle["money"]>;
export type FleetUsageOnTheRoad = FleetUsageResponse["onTheRoad"]["last"];
export type FleetUsageRoute = NonNullable<FleetUsageResponse["trips"]>["routes"][number];
