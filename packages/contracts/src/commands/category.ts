import { z } from "zod";
import { commandEnvelope } from "../envelope.js";
import {
  CATEGORY_KINDS,
  EVIDENCE_POLICIES,
  PROFITABILITY_LAYERS,
} from "./categories.js";

export const createCategoryPayload = z.strictObject({
  id: z.uuid(),
  kind: z.enum(CATEGORY_KINDS),
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/).max(40),
  labelFr: z.string().min(1),
  labelEn: z.string().min(1),
  profitabilityLayer: z.enum(PROFITABILITY_LAYERS).optional(),
  evidencePolicy: z.enum(EVIDENCE_POLICIES).optional(),
});

export const relabelCategoryPayload = z.strictObject({
  categoryId: z.uuid(),
  labelFr: z.string().min(1),
  labelEn: z.string().min(1),
});

export const deactivateCategoryPayload = z.strictObject({
  categoryId: z.uuid(),
});

export const reactivateCategoryPayload = z.strictObject({
  categoryId: z.uuid(),
});

export const createCategoryCommand = z.object({
  name: z.literal("create-category"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: createCategoryPayload,
});

export const relabelCategoryCommand = z.object({
  name: z.literal("relabel-category"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: relabelCategoryPayload,
});

export const deactivateCategoryCommand = z.object({
  name: z.literal("deactivate-category"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: deactivateCategoryPayload,
});

export const reactivateCategoryCommand = z.object({
  name: z.literal("reactivate-category"),
  version: z.literal(1),
  envelope: commandEnvelope,
  payload: reactivateCategoryPayload,
});

export type CreateCategoryPayload = z.infer<typeof createCategoryPayload>;
export type RelabelCategoryPayload = z.infer<typeof relabelCategoryPayload>;
export type DeactivateCategoryPayload = z.infer<typeof deactivateCategoryPayload>;
export type ReactivateCategoryPayload = z.infer<typeof reactivateCategoryPayload>;
export type CreateCategoryCommand = z.infer<typeof createCategoryCommand>;
export type RelabelCategoryCommand = z.infer<typeof relabelCategoryCommand>;
export type DeactivateCategoryCommand = z.infer<typeof deactivateCategoryCommand>;
export type ReactivateCategoryCommand = z.infer<typeof reactivateCategoryCommand>;
