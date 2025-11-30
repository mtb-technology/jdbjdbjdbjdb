CREATE TABLE "attachments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" varchar NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size" text NOT NULL,
	"page_count" text,
	"file_data" text NOT NULL,
	"extracted_text" text,
	"used_in_stages" json DEFAULT '[]'::json,
	"uploaded_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "dossier_context_summary" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_report_id_idx" ON "attachments" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "prompt_configs_is_active_idx" ON "prompt_configs" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reports_created_at_idx" ON "reports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "reports_client_name_idx" ON "reports" USING btree ("client_name");--> statement-breakpoint
CREATE INDEX "reports_current_stage_idx" ON "reports" USING btree ("current_stage");--> statement-breakpoint
CREATE INDEX "sources_domain_idx" ON "sources" USING btree ("domain");--> statement-breakpoint
CREATE INDEX "sources_is_verified_idx" ON "sources" USING btree ("is_verified");