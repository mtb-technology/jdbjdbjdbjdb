CREATE TABLE "box3_validator_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_name" text NOT NULL,
	"belastingjaar" text,
	"input_text" text NOT NULL,
	"attachment_names" jsonb,
	"validation_result" jsonb,
	"concept_mail" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "box3_validator_client_name_idx" ON "box3_validator_sessions" USING btree ("client_name");--> statement-breakpoint
CREATE INDEX "box3_validator_created_at_idx" ON "box3_validator_sessions" USING btree ("created_at");