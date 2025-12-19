/**
 * Automail API Service
 *
 * Handles communication with the Automail API for:
 * - Creating draft replies in conversations
 * - Checking configuration status
 *
 * Uses centralized config from /server/config/index.ts
 */

import { AUTOMAIL_CONFIG } from "../config";
import { logger } from "./logger";

// ============================================================
// TYPES
// ============================================================

export interface CreateDraftParams {
  conversationId: number;
  body: string;
  userId?: number;
}

export interface CreateDraftResponse {
  threadId: number;
  conversationId: number;
}

interface AutomailThreadResponse {
  id: number;
  type: string;
  status: string;
  state: string;
  body: string;
  createdAt: string;
}

// ============================================================
// CONFIGURATION HELPERS
// ============================================================

/**
 * Check if Automail API is configured and available
 */
export function isAutomailConfigured(): boolean {
  return AUTOMAIL_CONFIG.isConfigured;
}

/**
 * Create Basic Auth header for Automail API
 * Uses API key as the password with empty username
 */
function createAuthHeader(): string {
  if (!AUTOMAIL_CONFIG.apiKey) {
    throw new Error('AUTOMAIL_API_KEY is not configured');
  }
  const credentials = Buffer.from(`:${AUTOMAIL_CONFIG.apiKey}`).toString('base64');
  return `Basic ${credentials}`;
}

// ============================================================
// API METHODS
// ============================================================

/**
 * Create a draft reply in an Automail conversation
 *
 * @param params - Draft creation parameters
 * @returns Thread ID of the created draft
 * @throws Error if API call fails or Automail is not configured
 */
export async function createDraft(params: CreateDraftParams): Promise<CreateDraftResponse> {
  if (!isAutomailConfigured()) {
    throw new Error('Automail API is not configured');
  }

  const userId = params.userId ?? AUTOMAIL_CONFIG.userId;
  const url = `${AUTOMAIL_CONFIG.baseUrl}/api/conversations/${params.conversationId}/threads`;

  logger.info('automail-api', 'Creating draft', { conversationId: params.conversationId });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': createAuthHeader(),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      type: 'message',
      text: params.body,
      user: userId,
      state: 'draft',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    logger.error('automail-api', 'Failed to create draft', {
      status: response.status,
      error: errorText,
      conversationId: params.conversationId,
    });
    throw new Error(`Automail API error: ${response.status} - ${errorText}`);
  }

  const data: AutomailThreadResponse = await response.json();

  logger.info('automail-api', 'Draft created successfully', {
    threadId: data.id,
    conversationId: params.conversationId,
  });

  return {
    threadId: data.id,
    conversationId: params.conversationId,
  };
}

/**
 * Create draft from email stage output
 * Parses the JSON output from Stage 1b and creates a draft in Automail
 *
 * @param conversationId - Automail conversation ID
 * @param emailOutput - Raw output from Stage 1b (JSON string with email_subject and email_body)
 * @returns Draft creation result or null if failed/not configured
 */
export async function createDraftFromEmailOutput(
  conversationId: number,
  emailOutput: string
): Promise<CreateDraftResponse | null> {
  if (!isAutomailConfigured()) {
    logger.debug('automail-api', 'Skipping draft creation - API not configured');
    return null;
  }

  try {
    // Parse the email output JSON
    let emailBody = emailOutput;

    // Try to parse as JSON first (Stage 1b outputs {"email_subject": "...", "email_body": "..."})
    try {
      const parsed = JSON.parse(emailOutput);
      if (parsed.email_body) {
        emailBody = parsed.email_body;
      }
    } catch {
      // Not JSON, use as-is (might be plain text or already HTML)
      logger.debug('automail-api', 'Email output is not JSON, using as-is');
    }

    return await createDraft({
      conversationId,
      body: emailBody,
    });
  } catch (error) {
    logger.error('automail-api', 'Failed to create draft from email output', {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
