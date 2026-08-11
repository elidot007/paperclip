import { z } from "zod";
import {
  FACTORY_OUTCOME_STATUSES,
  FACTORY_REQUEST_STATUSES,
  FACTORY_TEMPLATE_TARGETS,
} from "../types/company-factory.js";

export const factoryRequestStatusSchema = z.enum(FACTORY_REQUEST_STATUSES);
export const factoryOutcomeStatusSchema = z.enum(FACTORY_OUTCOME_STATUSES);

export const factoryTemplateTargetSchema = z.enum(FACTORY_TEMPLATE_TARGETS);

export const factoryCatalogTemplateSelectionSchema = z.object({
  templateId: z.string().trim().min(1).max(240),
  target: factoryTemplateTargetSchema,
  newCompanyName: z.string().trim().min(1).max(240).nullable().optional(),
}).strict();

export const createFactoryRequestSchema = z.object({
  title: z.string().trim().min(1).max(240),
  requestMarkdown: z.string().trim().min(1).max(100_000),
  projectName: z.string().trim().min(1).max(240).optional(),
  projectDescription: z.string().trim().max(20_000).nullable().optional(),
  workspaceCwd: z.string().trim().min(1).max(4_096).nullable().optional(),
  templateSelection: factoryCatalogTemplateSelectionSchema.nullable().optional(),
  reviewProjectId: z.string().uuid().nullable().optional(),
  idempotencyKey: z.string().trim().min(1).max(255).nullable().optional(),
}).strict();

export const factoryRequestListQuerySchema = z.object({
  status: factoryRequestStatusSchema.optional(),
}).strict();

export const factoryTemplateAssessmentSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  requestMarkdown: z.string().trim().min(1).max(100_000),
  projectName: z.string().trim().min(1).max(240).optional(),
}).strict();

export const factoryIntakeSchema = z.object({
  businessRequest: z.string().trim().min(1).max(100_000),
  projectName: z.string().trim().min(1).max(240).optional(),
}).strict();

export const factoryOutcomeListQuerySchema = z.object({
  includeInactive: z.enum(["true", "false"]).optional(),
}).strict();

export const createFactoryOutcomeSchema = z.object({
  title: z.string().trim().min(1).max(240),
  outcomeMarkdown: z.string().trim().min(1).max(100_000),
  retrospectiveMarkdown: z.string().trim().min(1).max(100_000),
  evidenceWorkProductIds: z.array(z.string().uuid()).min(1).max(100),
  expiresAt: z.string().datetime().nullable().optional(),
}).strict();

export type CreateFactoryRequest = z.infer<typeof createFactoryRequestSchema>;
export type FactoryRequestListQuery = z.infer<typeof factoryRequestListQuerySchema>;
export type FactoryTemplateAssessmentInput = z.infer<typeof factoryTemplateAssessmentSchema>;
export type FactoryIntakeInput = z.infer<typeof factoryIntakeSchema>;
export type FactoryCatalogTemplateSelectionInput = z.infer<typeof factoryCatalogTemplateSelectionSchema>;
export type FactoryOutcomeListQuery = z.infer<typeof factoryOutcomeListQuerySchema>;
export type CreateFactoryOutcome = z.infer<typeof createFactoryOutcomeSchema>;
