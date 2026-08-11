CREATE TABLE "company_factory_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"factory_request_id" uuid NOT NULL,
	"project_id" uuid,
	"template_id" text,
	"title" text NOT NULL,
	"outcome_markdown" text NOT NULL,
	"retrospective_markdown" text NOT NULL,
	"evidence_work_product_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'awaiting_review' NOT NULL,
	"review_issue_id" uuid,
	"approval_interaction_id" uuid,
	"created_by_user_id" text,
	"approved_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_factory_outcomes" ADD CONSTRAINT "company_factory_outcomes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_factory_outcomes" ADD CONSTRAINT "company_factory_outcomes_factory_request_id_company_factory_requests_id_fk" FOREIGN KEY ("factory_request_id") REFERENCES "public"."company_factory_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_factory_outcomes" ADD CONSTRAINT "company_factory_outcomes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_factory_outcomes" ADD CONSTRAINT "company_factory_outcomes_review_issue_id_issues_id_fk" FOREIGN KEY ("review_issue_id") REFERENCES "public"."issues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_factory_outcomes" ADD CONSTRAINT "company_factory_outcomes_approval_interaction_id_issue_thread_interactions_id_fk" FOREIGN KEY ("approval_interaction_id") REFERENCES "public"."issue_thread_interactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_factory_outcomes_company_status_updated_idx" ON "company_factory_outcomes" USING btree ("company_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "company_factory_outcomes_company_request_idx" ON "company_factory_outcomes" USING btree ("company_id","factory_request_id");--> statement-breakpoint
CREATE INDEX "company_factory_outcomes_company_template_approved_idx" ON "company_factory_outcomes" USING btree ("company_id","template_id","approved_at");