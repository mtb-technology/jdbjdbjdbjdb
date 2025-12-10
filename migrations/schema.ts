import { pgTable, index, unique, varchar, text, json, boolean, timestamp, foreignKey, jsonb, integer, pgSequence } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"


export const dossierNumberSeq = pgSequence("dossier_number_seq", {  startWith: "1", increment: "1", minValue: "1", maxValue: "9223372036854775807", cache: "1", cycle: false })

export const promptConfigs = pgTable("prompt_configs", {
	id: varchar().default(gen_random_uuid()).primaryKey().notNull(),
	name: text().notNull(),
	config: json().notNull(),
	isActive: boolean("is_active").default(false).notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("prompt_configs_is_active_idx").using("btree", table.isActive.asc().nullsLast().op("bool_ops")),
	unique("prompt_configs_name_unique").on(table.name),
]);

export const sources = pgTable("sources", {
	id: varchar().default(gen_random_uuid()).primaryKey().notNull(),
	title: text().notNull(),
	url: text().notNull(),
	domain: text().notNull(),
	isVerified: boolean("is_verified").default(false).notNull(),
	lastChecked: timestamp("last_checked", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("sources_domain_idx").using("btree", table.domain.asc().nullsLast().op("text_ops")),
	index("sources_is_verified_idx").using("btree", table.isVerified.asc().nullsLast().op("bool_ops")),
]);

export const users = pgTable("users", {
	id: varchar().default(gen_random_uuid()).primaryKey().notNull(),
	username: text().notNull(),
	password: text().notNull(),
}, (table) => [
	unique("users_username_unique").on(table.username),
]);

export const jobs = pgTable("jobs", {
	id: varchar().default(gen_random_uuid()).primaryKey().notNull(),
	type: text().notNull(),
	status: text().default('queued').notNull(),
	reportId: varchar("report_id"),
	progress: text(),
	result: json(),
	error: text(),
	startedAt: timestamp("started_at", { mode: 'string' }),
	completedAt: timestamp("completed_at", { mode: 'string' }),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.reportId],
			foreignColumns: [reports.id],
			name: "jobs_report_id_reports_id_fk"
		}),
]);

export const reports = pgTable("reports", {
	id: varchar().default(gen_random_uuid()).primaryKey().notNull(),
	title: text().notNull(),
	clientName: text("client_name").notNull(),
	dossierData: json("dossier_data").notNull(),
	bouwplanData: json("bouwplan_data").notNull(),
	generatedContent: text("generated_content"),
	stageResults: json("stage_results"),
	conceptReportVersions: json("concept_report_versions"),
	substepResults: json("substep_results"),
	stagePrompts: json("stage_prompts"),
	currentStage: text("current_stage").default('1a_informatiecheck'),
	status: text().default('draft').notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	documentState: jsonb("document_state"),
	pendingChanges: jsonb("pending_changes"),
	documentSnapshots: jsonb("document_snapshots"),
	dossierContextSummary: text("dossier_context_summary"),
	dossierNumber: integer("dossier_number").notNull(),
	rolledBackChanges: jsonb("rolled_back_changes"),
}, (table) => [
	index("reports_client_name_idx").using("btree", table.clientName.asc().nullsLast().op("text_ops")),
	index("reports_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("reports_current_stage_idx").using("btree", table.currentStage.asc().nullsLast().op("text_ops")),
	index("reports_dossier_number_idx").using("btree", table.dossierNumber.asc().nullsLast().op("int4_ops")),
	index("reports_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	unique("reports_dossier_number_unique").on(table.dossierNumber),
]);

export const followUpSessions = pgTable("follow_up_sessions", {
	id: varchar().default(gen_random_uuid()).primaryKey().notNull(),
	caseId: varchar("case_id"),
	clientName: text("client_name").notNull(),
	dossierData: jsonb("dossier_data").notNull(),
	rapportContent: text("rapport_content").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.caseId],
			foreignColumns: [reports.id],
			name: "follow_up_sessions_case_id_reports_id_fk"
		}),
]);

export const followUpThreads = pgTable("follow_up_threads", {
	id: varchar().default(gen_random_uuid()).primaryKey().notNull(),
	sessionId: varchar("session_id").notNull(),
	emailThread: text("email_thread").notNull(),
	aiAnalysis: jsonb("ai_analysis").notNull(),
	conceptEmail: jsonb("concept_email").notNull(),
	threadNumber: text("thread_number"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [followUpSessions.id],
			name: "follow_up_threads_session_id_follow_up_sessions_id_fk"
		}).onDelete("cascade"),
]);

export const attachments = pgTable("attachments", {
	id: varchar().default(gen_random_uuid()).primaryKey().notNull(),
	reportId: varchar("report_id").notNull(),
	filename: text().notNull(),
	mimeType: text("mime_type").notNull(),
	fileSize: text("file_size").notNull(),
	pageCount: text("page_count"),
	fileData: text("file_data").notNull(),
	extractedText: text("extracted_text"),
	usedInStages: json("used_in_stages").default([]),
	uploadedAt: timestamp("uploaded_at", { mode: 'string' }).defaultNow(),
	needsVisionOcr: boolean("needs_vision_ocr").default(false),
}, (table) => [
	index("attachments_report_id_idx").using("btree", table.reportId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.reportId],
			foreignColumns: [reports.id],
			name: "attachments_report_id_reports_id_fk"
		}).onDelete("cascade"),
]);

export const box3ValidatorSessions = pgTable("box3_validator_sessions", {
	id: varchar().default(gen_random_uuid()).primaryKey().notNull(),
	clientName: text("client_name").notNull(),
	belastingjaar: text(),
	inputText: text("input_text").notNull(),
	attachmentNames: jsonb("attachment_names"),
	validationResult: jsonb("validation_result"),
	conceptMail: jsonb("concept_mail"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
	attachments: jsonb(),
	manualOverrides: jsonb("manual_overrides"),
	dossierStatus: text("dossier_status").default('in_behandeling'),
	notes: text(),
	multiYearData: jsonb("multi_year_data"),
	isMultiYear: boolean("is_multi_year").default(false),
}, (table) => [
	index("box3_validator_client_name_idx").using("btree", table.clientName.asc().nullsLast().op("text_ops")),
	index("box3_validator_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
]);

export const externalReportSessions = pgTable("external_report_sessions", {
	id: varchar().default(gen_random_uuid()).primaryKey().notNull(),
	title: text().notNull(),
	originalContent: text("original_content").notNull(),
	currentContent: text("current_content"),
	adjustmentCount: integer("adjustment_count").default(0),
	lastInstruction: text("last_instruction"),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("external_report_sessions_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
]);

export const externalReportAdjustments = pgTable("external_report_adjustments", {
	id: varchar().default(gen_random_uuid()).primaryKey().notNull(),
	sessionId: varchar("session_id").notNull(),
	version: integer().notNull(),
	instruction: text().notNull(),
	previousContent: text("previous_content").notNull(),
	newContent: text("new_content").notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("external_report_adjustments_session_id_idx").using("btree", table.sessionId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.sessionId],
			foreignColumns: [externalReportSessions.id],
			name: "external_report_adjustments_session_id_external_report_sessions"
		}).onDelete("cascade"),
]);

export const box3Documents = pgTable("box3_documents", {
	id: varchar().default(gen_random_uuid()).primaryKey().notNull(),
	dossierId: varchar("dossier_id").notNull(),
	filename: text().notNull(),
	mimeType: text("mime_type").notNull(),
	fileSize: integer("file_size").notNull(),
	fileData: text("file_data").notNull(),
	uploadedAt: timestamp("uploaded_at", { mode: 'string' }).defaultNow(),
	uploadedVia: text("uploaded_via"),
	classification: jsonb(),
	extractionSummary: text("extraction_summary"),
	extractedValues: jsonb("extracted_values"),
}, (table) => [
	index("box3_documents_dossier_id_idx").using("btree", table.dossierId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.dossierId],
			foreignColumns: [box3Dossiers.id],
			name: "box3_documents_dossier_id_box3_dossiers_id_fk"
		}).onDelete("cascade"),
]);

export const box3Dossiers = pgTable("box3_dossiers", {
	id: varchar().default(gen_random_uuid()).primaryKey().notNull(),
	dossierNummer: text("dossier_nummer"),
	clientName: text("client_name").notNull(),
	clientEmail: text("client_email"),
	intakeText: text("intake_text"),
	status: text().default('intake'),
	taxYears: text("tax_years").array(),
	hasFiscalPartner: boolean("has_fiscal_partner").default(false),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { mode: 'string' }).defaultNow(),
}, (table) => [
	index("box3_dossiers_client_name_idx").using("btree", table.clientName.asc().nullsLast().op("text_ops")),
	index("box3_dossiers_created_at_idx").using("btree", table.createdAt.asc().nullsLast().op("timestamp_ops")),
	index("box3_dossiers_status_idx").using("btree", table.status.asc().nullsLast().op("text_ops")),
	unique("box3_dossiers_dossier_nummer_unique").on(table.dossierNummer),
]);

export const box3Blueprints = pgTable("box3_blueprints", {
	id: varchar().default(gen_random_uuid()).primaryKey().notNull(),
	dossierId: varchar("dossier_id").notNull(),
	version: integer().notNull(),
	blueprint: jsonb().notNull(),
	createdAt: timestamp("created_at", { mode: 'string' }).defaultNow(),
	createdBy: text("created_by"),
}, (table) => [
	index("box3_blueprints_dossier_id_idx").using("btree", table.dossierId.asc().nullsLast().op("text_ops")),
	index("box3_blueprints_version_idx").using("btree", table.dossierId.asc().nullsLast().op("int4_ops"), table.version.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.dossierId],
			foreignColumns: [box3Dossiers.id],
			name: "box3_blueprints_dossier_id_box3_dossiers_id_fk"
		}).onDelete("cascade"),
]);
