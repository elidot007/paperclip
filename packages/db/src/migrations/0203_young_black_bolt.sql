CREATE TABLE "company_factory_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"title" text NOT NULL,
	"request_markdown" text NOT NULL,
	"project_name" text NOT NULL,
	"project_description" text,
	"workspace_cwd" text,
	"review_project_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"proposal" jsonb,
	"proposal_revision" integer DEFAULT 0 NOT NULL,
	"review_issue_id" uuid,
	"approval_interaction_id" uuid,
	"applied_project_id" uuid,
	"applied_resources" jsonb,
	"idempotency_key" text,
	"failure_reason" text,
	"created_by_agent_id" uuid,
	"created_by_user_id" text,
	"approved_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_factory_requests" ADD CONSTRAINT "company_factory_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_factory_requests" ADD CONSTRAINT "company_factory_requests_review_project_id_projects_id_fk" FOREIGN KEY ("review_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_factory_requests" ADD CONSTRAINT "company_factory_requests_review_issue_id_issues_id_fk" FOREIGN KEY ("review_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_factory_requests" ADD CONSTRAINT "company_factory_requests_approval_interaction_id_issue_thread_interactions_id_fk" FOREIGN KEY ("approval_interaction_id") REFERENCES "public"."issue_thread_interactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_factory_requests" ADD CONSTRAINT "company_factory_requests_applied_project_id_projects_id_fk" FOREIGN KEY ("applied_project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_factory_requests" ADD CONSTRAINT "company_factory_requests_created_by_agent_id_agents_id_fk" FOREIGN KEY ("created_by_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_factory_requests_company_status_updated_idx" ON "company_factory_requests" USING btree ("company_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "company_factory_requests_company_review_issue_idx" ON "company_factory_requests" USING btree ("company_id","review_issue_id");--> statement-breakpoint
CREATE INDEX "company_factory_requests_company_applied_project_idx" ON "company_factory_requests" USING btree ("company_id","applied_project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_factory_requests_company_idempotency_uq" ON "company_factory_requests" USING btree ("company_id","idempotency_key") WHERE "company_factory_requests"."idempotency_key" IS NOT NULL;