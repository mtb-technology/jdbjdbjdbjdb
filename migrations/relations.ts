import { relations } from "drizzle-orm/relations";
import { reports, jobs, followUpSessions, followUpThreads, attachments, externalReportSessions, externalReportAdjustments, box3Dossiers, box3Documents, box3Blueprints } from "./schema";

export const jobsRelations = relations(jobs, ({one}) => ({
	report: one(reports, {
		fields: [jobs.reportId],
		references: [reports.id]
	}),
}));

export const reportsRelations = relations(reports, ({many}) => ({
	jobs: many(jobs),
	followUpSessions: many(followUpSessions),
	attachments: many(attachments),
}));

export const followUpSessionsRelations = relations(followUpSessions, ({one, many}) => ({
	report: one(reports, {
		fields: [followUpSessions.caseId],
		references: [reports.id]
	}),
	followUpThreads: many(followUpThreads),
}));

export const followUpThreadsRelations = relations(followUpThreads, ({one}) => ({
	followUpSession: one(followUpSessions, {
		fields: [followUpThreads.sessionId],
		references: [followUpSessions.id]
	}),
}));

export const attachmentsRelations = relations(attachments, ({one}) => ({
	report: one(reports, {
		fields: [attachments.reportId],
		references: [reports.id]
	}),
}));

export const externalReportAdjustmentsRelations = relations(externalReportAdjustments, ({one}) => ({
	externalReportSession: one(externalReportSessions, {
		fields: [externalReportAdjustments.sessionId],
		references: [externalReportSessions.id]
	}),
}));

export const externalReportSessionsRelations = relations(externalReportSessions, ({many}) => ({
	externalReportAdjustments: many(externalReportAdjustments),
}));

export const box3DocumentsRelations = relations(box3Documents, ({one}) => ({
	box3Dossier: one(box3Dossiers, {
		fields: [box3Documents.dossierId],
		references: [box3Dossiers.id]
	}),
}));

export const box3DossiersRelations = relations(box3Dossiers, ({many}) => ({
	box3Documents: many(box3Documents),
	box3Blueprints: many(box3Blueprints),
}));

export const box3BlueprintsRelations = relations(box3Blueprints, ({one}) => ({
	box3Dossier: one(box3Dossiers, {
		fields: [box3Blueprints.dossierId],
		references: [box3Dossiers.id]
	}),
}));