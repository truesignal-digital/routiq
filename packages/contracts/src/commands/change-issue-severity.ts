import { z } from "zod";
import { commandEnvelope } from "../envelope.js";

/**
 * Marks an OPEN signalement safety-critical, or takes the mark off (#96). The
 * driver who forgot to tick the box corrects it after the fact; the report
 * itself stays as written, and the trail keeps who changed the mark, when, and
 * from what.
 *
 * `safetyCritical` is the mark wanted. Raising grounds the vehicle exactly as
 * reporting a safety-critical problem does. Lowering never releases it: a
 * release stays its own step with its own rules. Lowering is a judgement
 * against someone's report, so it needs a `reason`, as a dismissal does.
 */
export const changeIssueSeverityPayload = z
  .strictObject({
    issueId: z.uuid(),
    safetyCritical: z.boolean(),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .superRefine((payload, ctx) => {
    if (!payload.safetyCritical && payload.reason === undefined) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "required when lowering" });
    }
  });

export const changeIssueSeverityCommand = z.object({
  name: z.literal("change-issue-severity"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: changeIssueSeverityPayload,
});

export type ChangeIssueSeverityPayload = z.infer<typeof changeIssueSeverityPayload>;
export type ChangeIssueSeverityCommand = z.infer<typeof changeIssueSeverityCommand>;
