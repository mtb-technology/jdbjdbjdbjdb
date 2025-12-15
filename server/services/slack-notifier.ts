/**
 * Slack Notifier Service
 *
 * Sends Slack notifications for Express Mode job events:
 * - Per-stage completion
 * - Job completion
 * - Job failures
 *
 * Only active when SLACK_WEBHOOK_URL environment variable is configured.
 */

import { config } from "../config";

interface ReportInfo {
  id: string;
  dossierNumber: number;
  clientName: string;
}

interface StageInfo {
  stageId: string;
  stageName: string;
  changesCount?: number;
  durationMs: number;
}

const STAGE_NAMES: Record<string, string> = {
  "3_generatie": "Rapport Generatie",
  "4a_BronnenSpecialist": "Bronnen Specialist",
  "4b_FiscaalTechnischSpecialist": "Fiscaal Technisch Specialist",
  "4c_ScenarioGatenAnalist": "Scenario Gaten Analist",
  "4e_DeAdvocaat": "De Advocaat",
  "4f_HoofdCommunicatie": "Hoofd Communicatie",
};

function getSlackWebhookUrl(): string | undefined {
  return process.env.SLACK_WEBHOOK_URL;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

function getPortalUrl(): string {
  return process.env.PORTAL_BASE_URL || "https://portal-jdb-production.up.railway.app";
}

function getEnvPrefix(): string {
  return config.IS_PRODUCTION ? "" : "[DEV] ";
}

async function sendSlackMessage(payload: object): Promise<void> {
  const webhookUrl = getSlackWebhookUrl();
  if (!webhookUrl) {
    return; // Silently skip if not configured
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`[SlackNotifier] Failed to send message: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.error("[SlackNotifier] Error sending message:", error);
  }
}

/**
 * Notify when a single stage completes within Express Mode
 */
export async function notifyStageComplete(
  report: ReportInfo,
  stage: StageInfo
): Promise<void> {
  const stageName = STAGE_NAMES[stage.stageId] || stage.stageId;
  const portalUrl = getPortalUrl();

  const prefix = getEnvPrefix();
  const lines = [
    `${prefix}✅ *Stage voltooid*`,
    `*Dossier:* #${report.dossierNumber} - ${report.clientName}`,
    `*Stage:* ${stageName}`,
  ];

  if (stage.changesCount !== undefined) {
    lines.push(`*Wijzigingen:* ${stage.changesCount}`);
  }

  lines.push(`*Doorlooptijd:* ${formatDuration(stage.durationMs)}`);
  lines.push(`<${portalUrl}/pipeline/${report.id}|Open Rapport →>`);

  await sendSlackMessage({ text: lines.join("\n") });
}

/**
 * Notify when Express Mode job completes successfully
 */
export async function notifyExpressModeComplete(
  report: ReportInfo,
  stages: StageInfo[],
  totalChanges: number,
  durationMs: number
): Promise<void> {
  const portalUrl = getPortalUrl();

  const prefix = getEnvPrefix();
  const lines = [
    `${prefix}🎉 *Express Mode voltooid*`,
    `*Dossier:* #${report.dossierNumber} - ${report.clientName}`,
    `*Stages:* ${stages.length}/${stages.length} voltooid`,
    `*Totaal wijzigingen:* ${totalChanges}`,
    `*Doorlooptijd:* ${formatDuration(durationMs)}`,
    `<${portalUrl}/pipeline/${report.id}|Open Rapport →>`,
  ];

  await sendSlackMessage({ text: lines.join("\n") });
}

/**
 * Notify when a job fails
 */
export async function notifyJobFailed(
  report: ReportInfo,
  stageId: string,
  error: string
): Promise<void> {
  const stageName = STAGE_NAMES[stageId] || stageId;
  const portalUrl = getPortalUrl();

  const truncatedError = error.length > 200 ? error.substring(0, 200) + "..." : error;
  const prefix = getEnvPrefix();

  const lines = [
    `${prefix}❌ *Stage mislukt*`,
    `*Dossier:* #${report.dossierNumber} - ${report.clientName}`,
    `*Stage:* ${stageName}`,
    `*Fout:* ${truncatedError}`,
    `<${portalUrl}/pipeline/${report.id}|Open Rapport →>`,
  ];

  await sendSlackMessage({ text: lines.join("\n") });
}

/**
 * Check if Slack notifications are enabled
 */
export function isSlackEnabled(): boolean {
  return !!getSlackWebhookUrl();
}
