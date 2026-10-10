import { z } from "zod";
import { PROFITABILITY_LAYERS } from "../commands/categories.js";
import { moneyMinor } from "../envelope.js";
import { monthCode } from "./finance.js";

/**
 * The Overview range picker (dashboards.html, RangePicker). THIS_MONTH runs
 * from the 1st to today and is compared with the same days of last month
 * (Oct 1–9 with Sep 1–9; on the 31st, with all of a shorter month).
 * THREE_MONTHS and TWELVE_MONTHS are whole closed months ending last month,
 * each compared with the same number of months just before, so a partial month
 * is never set against full ones.
 */
export const OVERVIEW_RANGES = ["THIS_MONTH", "THREE_MONTHS", "TWELVE_MONTHS"] as const;
export type OverviewRange = (typeof OVERVIEW_RANGES)[number];

/** Points in the revenue and expenses chart: the closed months before the current one. */
export const OVERVIEW_SERIES_MONTHS = 12;

/**
 * Who sees profit. PROFIT for the ledger readers (Direction, administrators
 * for their branches, finance); REVENUE_AND_EXPENSES for the cashier, whose
 * response carries no profit figure anywhere: every profit field is null.
 */
export const OVERVIEW_VIEWS = ["PROFIT", "REVENUE_AND_EXPENSES"] as const;

// Both schemas are built inside a pure call: the web reads this shape by its
// types only, and a bundler keeps every argument of a top-level zod call, so
// written flat they would ship in the first load unused.

/**
 * `GET /v1/finance/overview`. `branchId` narrows inside the caller's branch
 * scope and never widens it: a branch outside the scope matches nothing.
 */
export const financeOverviewQuery = /* @__PURE__ */ (() =>
  z.object({
    range: z.enum(OVERVIEW_RANGES).default("THIS_MONTH"),
    branchId: z.uuid().optional(),
  }))();
export type FinanceOverviewQuery = z.infer<typeof financeOverviewQuery>;

/**
 * `GET /v1/finance/overview`: money for every Overview (dashboards.html#data).
 * Only posted entries count (POSTED plus the REVERSED originals their posted
 * cancellations net out), in the workspace currency, by economic date, over the
 * entries the caller may read in their branches. Gaps are reported, never
 * filled in.
 */
export const financeOverviewResponse = /* @__PURE__ */ (() => {
  /**
   * One window's posted totals, by economic date, both dates inclusive. Signed
   * minor units of `currency` (XAF exponent 0): a cancellation posted in the
   * window subtracts. `profitMinor` is revenue minus expenses; negative is a loss.
   */
  const windowTotals = z.object({
    from: z.iso.date(),
    to: z.iso.date(),
    revenueMinor: moneyMinor,
    expenseMinor: moneyMinor,
    profitMinor: moneyMinor.nullable(),
  });

  /** A category's expenses in one window, and the part recorded on no vehicle. */
  const categoryWindow = z.object({
    expenseMinor: moneyMinor,
    /** Included in `expenseMinor`: the part that is company costs. */
    companyCostMinor: moneyMinor,
  });

  /**
   * Company profit for one window, from its parts:
   * companyProfitMinor = vehicleProfitMinor + revenueWithoutVehicleMinor − companyCostsMinor,
   * which equals the window's revenue minus expenses. Revenue is nearly always
   * recorded on a vehicle; `revenueWithoutVehicleMinor` keeps the sum exact when
   * one is not, and is zero otherwise.
   */
  const companyProfit = z.object({
    /** The sum of every vehicle's profit. */
    vehicleProfitMinor: moneyMinor,
    revenueWithoutVehicleMinor: moneyMinor,
    /** Posted expenses recorded on no vehicle: office rent, office staff, phones. */
    companyCostsMinor: moneyMinor,
    companyProfitMinor: moneyMinor,
  });

  /** `count` entries and their amounts, as positive minor units. */
  const entryCount = z.object({
    count: z.number().int().nonnegative(),
    amountMinor: moneyMinor.nonnegative(),
  });

  const count = z.number().int().nonnegative();

  return z
    .object({
      currency: z.string().length(3),
      range: z.enum(OVERVIEW_RANGES),
      /** The narrowing the caller asked for; null for all their branches. */
      branchId: z.uuid().nullable(),
      view: z.enum(OVERVIEW_VIEWS),
      period: windowTotals,
      /** The same values for the window the period is compared with. */
      comparison: windowTotals,
      /** The 12 closed months before the current one, oldest first, zero-filled. */
      series: z
        .array(z.object({ periodCode: monthCode, revenueMinor: moneyMinor, expenseMinor: moneyMinor }))
        .length(OVERVIEW_SERIES_MONTHS),
      /**
       * Expenses of each category in both windows, for the profit bridge and
       * the category comparison. Listed when either window is not zero.
       */
      expensesByCategory: z.array(
        z.object({
          code: z.string(),
          labelFr: z.string(),
          labelEn: z.string(),
          layer: z.enum(PROFITABILITY_LAYERS).nullable(),
          period: categoryWindow,
          comparison: categoryWindow,
        }),
      ),
      /**
       * Each vehicle in the period, losses first: the money recorded on it and
       * the trips it carried. Every active vehicle of the caller's branches is
       * listed, plus any other vehicle with money in the period, so a truck
       * that earned nothing shows as zero instead of disappearing. Null in the
       * REVENUE_AND_EXPENSES view, or when the Vehicles module is off.
       */
      vehicles: z
        .array(
          z.object({
            assetId: z.uuid(),
            assetCode: z.string(),
            registrationNumber: z.string().nullable(),
            branchId: z.uuid(),
            /** Trips closed in the period that it carried (a substitution counts for both). Null when Trips is off. */
            tripsClosed: count.nullable(),
            /** Km from the legs of those trips that record it; null when none does, or Trips is off. */
            distanceKm: count.nullable(),
            /** Of `tripsClosed`, those with no km on its legs: what `distanceKm` leaves out. */
            tripsWithoutKm: count.nullable(),
            revenueMinor: moneyMinor,
            expenseMinor: moneyMinor,
            profitMinor: moneyMinor,
          }),
        )
        .nullable(),
      /**
       * Vehicle profit by the vehicle's branch; company costs are not split by
       * branch. Null whenever `vehicles` is.
       */
      branches: z
        .array(
          z.object({
            branchId: z.uuid(),
            code: z.string(),
            name: z.string(),
            vehicleCount: count,
            revenueMinor: moneyMinor,
            expenseMinor: moneyMinor,
            vehicleProfitMinor: moneyMinor,
          }),
        )
        .nullable(),
      /** Null in the REVENUE_AND_EXPENSES view. */
      companyProfit: z.object({ period: companyProfit, comparison: companyProfit }).nullable(),
      /** What the period's figures are made of. */
      counted: z.object({
        postedEntries: count,
        /** Null when the Trips module is off. */
        closedTrips: count.nullable(),
      }),
      /** What the period's figures leave out or can't vouch for. */
      notCounted: z.object({
        /** Entries in the period still waiting for approval: not in any total. */
        waitingApproval: entryCount,
        /** Entries in the period, posted or waiting, with no receipt. */
        missingReceipt: entryCount,
        /** Trips open now: their costs and revenue may still come. Null when the Trips module is off. */
        openTrips: count.nullable(),
        /** Posted entries in the period in another currency, left out of every total. */
        otherCurrencyEntries: count,
      }),
    })
    .superRefine((body, ctx) => {
      // The view decides profit for the whole body, so no section can leak it
      // to the cashier, and no section can drop it for a ledger reader.
      const profitFields = [body.period.profitMinor, body.comparison.profitMinor, body.companyProfit];
      if (body.view === "REVENUE_AND_EXPENSES") {
        if (profitFields.some((field) => field !== null) || body.vehicles !== null || body.branches !== null) {
          ctx.addIssue({ code: "custom", message: "REVENUE_AND_EXPENSES carries no profit" });
        }
      } else if (profitFields.some((field) => field === null)) {
        ctx.addIssue({ code: "custom", message: "PROFIT carries every profit figure" });
      }
    });
})();

export type FinanceOverviewResponse = z.infer<typeof financeOverviewResponse>;
export type OverviewWindowTotals = FinanceOverviewResponse["period"];
export type OverviewSeriesPoint = FinanceOverviewResponse["series"][number];
export type OverviewCategoryRow = FinanceOverviewResponse["expensesByCategory"][number];
export type OverviewVehicleRow = NonNullable<FinanceOverviewResponse["vehicles"]>[number];
export type OverviewBranchRow = NonNullable<FinanceOverviewResponse["branches"]>[number];
export type OverviewCompanyProfit = NonNullable<FinanceOverviewResponse["companyProfit"]>["period"];
