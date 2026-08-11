import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { FactoryAppliedResources, FactoryCatalogTemplateSelection, FactoryProposal } from "@paperclipai/shared";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { issueThreadInteractions } from "./issue_thread_interactions.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";

/**
 * A company-scoped, reviewable intake record for the governed Company Factory.
 * The proposal and applied resource IDs deliberately live together so retries
 * can recover a partially provisioned request without creating a second team.
 */
export const companyFactoryRequests = pgTable(
  "company_factory_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    requestMarkdown: text("request_markdown").notNull(),
    projectName: text("project_name").notNull(),
    projectDescription: text("project_description"),
    workspaceCwd: text("workspace_cwd"),
    templateSelection: jsonb("template_selection").$type<FactoryCatalogTemplateSelection>(),
    reviewProjectId: uuid("review_project_id").references(() => projects.id, { onDelete: "set null" }),
    status: text("status").notNull().default("draft"),
    proposal: jsonb("proposal").$type<FactoryProposal>(),
    proposalRevision: integer("proposal_revision").notNull().default(0),
    reviewIssueId: uuid("review_issue_id").references(() => issues.id, { onDelete: "set null" }),
    approvalInteractionId: uuid("approval_interaction_id")
      .references(() => issueThreadInteractions.id, { onDelete: "set null" }),
    appliedProjectId: uuid("applied_project_id").references(() => projects.id, { onDelete: "set null" }),
    appliedResources: jsonb("applied_resources").$type<FactoryAppliedResources>(),
    idempotencyKey: text("idempotency_key"),
    failureReason: text("failure_reason"),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdByUserId: text("created_by_user_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusUpdatedIdx: index("company_factory_requests_company_status_updated_idx")
      .on(table.companyId, table.status, table.updatedAt),
    companyReviewIssueIdx: index("company_factory_requests_company_review_issue_idx")
      .on(table.companyId, table.reviewIssueId),
    companyAppliedProjectIdx: index("company_factory_requests_company_applied_project_idx")
      .on(table.companyId, table.appliedProjectId),
    companyIdempotencyUq: uniqueIndex("company_factory_requests_company_idempotency_uq")
      .on(table.companyId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} IS NOT NULL`),
  }),
);
