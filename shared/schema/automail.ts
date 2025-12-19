/**
 * Automail Schema Definitions
 *
 * Zod schemas for validating Automail webhook payloads and API requests.
 * These schemas are shared between server routes for consistent validation.
 */

import { z } from "zod";

// ============================================================
// USER & CUSTOMER SCHEMAS
// ============================================================

export const automailUserSchema = z.object({
  id: z.number(),
  type: z.literal("user").optional(),
  firstName: z.string().default(""),
  lastName: z.string().default(""),
  photoUrl: z.string().optional(),
  email: z.string().optional().default(""),
}).passthrough();

export const automailCustomerSchema = z.object({
  id: z.number(),
  type: z.literal("customer").optional(),
  firstName: z.string().nullable().optional().transform(val => val ?? ""),
  lastName: z.string().nullable().optional().transform(val => val ?? ""),
  photoUrl: z.string().optional(),
  email: z.string().nullable().optional().transform(val => val ?? ""),
  phone: z.string().optional().nullable(),
  company: z.string().optional().nullable(),
}).passthrough();

// ============================================================
// NESTED SCHEMAS
// ============================================================

export const automailCustomFieldSchema = z.object({
  id: z.number(),
  name: z.string(),
  value: z.string().optional().nullable(),
  text: z.string().optional().nullable(),
}).passthrough();

export const automailAttachmentSchema = z.object({
  id: z.number(),
  fileName: z.string(),
  fileUrl: z.string().url(),
  mimeType: z.string(),
  size: z.number(),
  extractedText: z.string().optional().nullable(),
  extractionSuccess: z.boolean().optional(),
  extractionCached: z.boolean().optional(),
}).passthrough();

export const automailActionSchema = z.object({
  type: z.string(),
  text: z.string(),
  associatedEntities: z.array(z.unknown()).optional(),
}).passthrough();

export const automailSourceSchema = z.object({
  type: z.string(),
  via: z.string(),
}).passthrough();

export const automailThreadSchema = z.object({
  id: z.number(),
  type: z.enum(["note", "message", "customer", "lineitem"]),
  status: z.string().optional(),
  state: z.string().optional(),
  action: automailActionSchema.optional(),
  body: z.string().nullable().transform(val => val ?? ''),
  source: automailSourceSchema.optional(),
  customer: automailCustomerSchema.optional().nullable(),
  createdBy: z.union([automailUserSchema, automailCustomerSchema]).optional().nullable(),
  assignedTo: automailUserSchema.optional().nullable(),
  to: z.array(z.string()).optional().default([]),
  cc: z.array(z.string()).optional().default([]),
  bcc: z.array(z.string()).optional().default([]),
  createdAt: z.string(),
  openedAt: z.string().optional().nullable(),
  _embedded: z.object({
    attachments: z.array(automailAttachmentSchema).optional().default([]),
  }).optional(),
}).passthrough();

export const automailCustomerWaitingSinceSchema = z.object({
  time: z.string(),
  friendly: z.string(),
  latestReplyFrom: z.string(),
}).passthrough();

// ============================================================
// MAIN WEBHOOK PAYLOAD SCHEMA
// ============================================================

export const automailWebhookPayloadSchema = z.object({
  // Core identifiers
  id: z.number(),
  number: z.number().optional().default(0),
  externalId: z.string().optional().nullable(),

  // Conversation metadata
  threadsCount: z.number().optional(),
  type: z.string().optional(),
  folderId: z.number().optional(),
  status: z.string().optional(),
  state: z.string().optional(),
  subject: z.string().optional().default(""),
  preview: z.string().optional(),
  mailboxId: z.number().optional(),
  language: z.string().optional(),

  // People - customer can be missing in some event types
  customer: automailCustomerSchema.optional(),
  assignee: automailUserSchema.optional().nullable(),
  createdBy: automailUserSchema.optional().nullable(),
  closedBy: z.unknown().optional().nullable(),
  closedByUser: z.unknown().optional().nullable(),

  // Timestamps
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  closedAt: z.string().optional().nullable(),
  userUpdatedAt: z.string().optional(),
  customerWaitingSince: automailCustomerWaitingSinceSchema.optional(),

  // Source info
  source: automailSourceSchema.optional(),

  // Recipients
  cc: z.array(z.string()).optional().default([]),
  bcc: z.array(z.string()).optional().default([]),

  // Custom fields
  customFields: z.array(automailCustomFieldSchema).optional().default([]),

  // Embedded data (threads with attachments)
  _embedded: z.object({
    threads: z.array(automailThreadSchema).optional().default([]),
  }).optional(),

  // Pre-formatted threads text
  formattedThreads: z.string().optional().default(""),
}).passthrough();

// ============================================================
// API REQUEST SCHEMAS
// ============================================================

export const automailCreateDraftRequestSchema = z.object({
  text: z.string().min(1, "Draft text is required"),
  subject: z.string().optional(),
});

// ============================================================
// TYPE EXPORTS
// ============================================================

export type AutomailWebhookPayload = z.infer<typeof automailWebhookPayloadSchema>;
export type AutomailCreateDraftRequest = z.infer<typeof automailCreateDraftRequestSchema>;
export type AutomailUser = z.infer<typeof automailUserSchema>;
export type AutomailCustomer = z.infer<typeof automailCustomerSchema>;
export type AutomailThread = z.infer<typeof automailThreadSchema>;
export type AutomailAttachment = z.infer<typeof automailAttachmentSchema>;
