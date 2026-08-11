import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { FactoryOutcomeStatus } from "@paperclipai/shared";
import { companies } from "./companies.js";
import { companyFactoryRequests } from "./company_factory_requests.js";
import { issueThreadInteractions } from "./issue_thread_interactions.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";

/**
 * Review-gated, company-local delivery evidence used by Company Factory reuse
 * scoring. The table deliberately contains no cross-company sharing fields.
 */
export const companyFactoryOutcomes = pgTable(
  "company_factory_outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    factoryRequestId: uuid("factory_request_id")
      .notNull()
      .references(() => companyFactoryRequests.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    templateId: text("template_id"),
    title: text("title").notNull(),
    outcomeMarkdown: text("outcome_markdown").notNull(),
    retrospectiveMarkdown: text("retrospective_markdown").notNull(),
    evidenceWorkProductIds: jsonb("evidence_work_product_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    status: text("status").$type<FactoryOutcomeStatus>().notNull().default("awaiting_review"),
    reviewIssueId: uuid("review_issue_id").references(() => issues.id, { onDelete: "set null" }),
    approvalInteractionId: uuid("approval_interaction_id")
      .references(() => issueThreadInteractions.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusUpdatedIdx: index("company_factory_outcomes_company_status_updated_idx")
      .on(table.companyId, table.status, table.updatedAt),
    companyRequestIdx: index("company_factory_outcomes_company_request_idx")
      .on(table.companyId, table.factoryRequestId),
    companyTemplateApprovedIdx: index("company_factory_outcomes_company_template_approved_idx")
      .on(table.companyId, table.templateId, table.approvedAt),
  }),
);
