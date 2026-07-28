import type { ActivityCompletenessCode } from "@routiq/contracts";

/**
 * Which facts a closed activity is expected to carry. Per-template **data**, not
 * a constant: §3.3 puts required-field lists in the preset, and the module has to
 * generalize past the two pilot presets. A plant-hire activity is an excavator
 * standing on a site for a fortnight — it has no movement legs at all, so a
 * hardcoded `legs: true` would flag every correct record of that business as
 * incomplete, forever.
 */
export interface ActivityRequirements {
  legs: boolean;
  crew: boolean;
  revenue: boolean;
  startReading: boolean;
  endReading: boolean;
}

const REQUIREMENTS: Record<string, ActivityRequirements> = {
  TRUCKING: {
    legs: true,
    crew: true,
    revenue: true,
    startReading: true,
    endReading: true,
  },
  PASSENGER_TRANSPORT: {
    legs: true,
    crew: true,
    revenue: true,
    startReading: true,
    endReading: true,
  },
  // A hire preset would set legs:false and swap ODOMETER for HOURS — one entry
  // here, no change to the evaluator or to any table.
};

export function activityRequirements(templateCode: string): ActivityRequirements {
  const requirements = REQUIREMENTS[templateCode];
  if (!requirements) throw new Error(`no completeness rules for template ${templateCode}`);
  return requirements;
}

export type CloseBlocker = "MISSING_ACTUAL_DATES" | "NO_ASSET_SEGMENT";

export interface CompletenessInput {
  startedAt: Date | null;
  endedAt: Date | null;
  segments: readonly {
    role: string;
    endedAt: Date | null;
    startReadingId: string | null;
    endReadingId: string | null;
  }[];
  legCount: number;
  crewCount: number;
  revenueEntryCount: number;
  requirements: ActivityRequirements;
}

export type CompletenessResult =
  | { closeable: false; blockedBy: CloseBlocker[] }
  | {
      closeable: true;
      completeness: "COMPLETE" | "COMPLETE_WITH_EXCEPTIONS";
      codes: ActivityCompletenessCode[];
    };

/**
 * §3.4 invariant 6: closing warns, it does not block. The only hard blocks are
 * the trivial minimum — actual dates and at least one asset segment — because a
 * system that refuses the close makes the clerk invent a number or leave the job
 * open forever, and both destroy the ledger's credibility. Everything else
 * becomes a stable code stored on the row and returned as a warning.
 *
 * Pure on purpose: no tx, no ctx. This is the one piece of activity logic that
 * both close-activity and the composite sheets must agree on exactly, and it is
 * worth being able to test every branch of it without a database.
 */
export function evaluateCompleteness(input: CompletenessInput): CompletenessResult {
  const blockedBy: CloseBlocker[] = [];
  if (input.startedAt === null || input.endedAt === null) {
    blockedBy.push("MISSING_ACTUAL_DATES");
  }
  if (input.segments.length === 0) {
    blockedBy.push("NO_ASSET_SEGMENT");
  }
  if (blockedBy.length > 0) return { closeable: false, blockedBy };

  const codes: ActivityCompletenessCode[] = [];
  const carriers = input.segments.filter(
    (segment) => segment.role === "PRIMARY" || segment.role === "SUBSTITUTE",
  );

  if (input.requirements.legs && input.legCount === 0) codes.push("ACTIVITY_NO_LEGS");
  if (input.requirements.crew && input.crewCount === 0) codes.push("ACTIVITY_MISSING_CREW");
  if (input.requirements.revenue && input.revenueEntryCount === 0) {
    codes.push("ACTIVITY_NO_REVENUE");
  }
  if (
    input.requirements.startReading &&
    carriers.some((segment) => segment.startReadingId === null)
  ) {
    codes.push("ACTIVITY_MISSING_START_READING");
  }
  if (
    input.requirements.endReading &&
    carriers.some((segment) => segment.endReadingId === null)
  ) {
    codes.push("ACTIVITY_MISSING_END_READING");
  }
  if (input.segments.some((segment) => segment.endedAt === null)) {
    // The close itself will stamp these; the code records that it had to.
    codes.push("ACTIVITY_OPEN_SEGMENT_AUTOCLOSED");
  }

  return {
    closeable: true,
    completeness: codes.length === 0 ? "COMPLETE" : "COMPLETE_WITH_EXCEPTIONS",
    codes,
  };
}
