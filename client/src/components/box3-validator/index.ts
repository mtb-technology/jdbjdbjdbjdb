/**
 * Box 3 Validator Components - Barrel Export
 */

// Page-level components
export { Box3CaseList } from "./Box3CaseList";
export { Box3CaseDetail } from "./Box3CaseDetail";
export { Box3NewCase } from "./Box3NewCase";

// Multi-year components
export { Box3TotalOverview } from "./Box3TotalOverview";
export { Box3YearEntry } from "./Box3YearEntry";

// Shared components
export { StatusIcon, StatusBadge, GlobalStatusBadge, DataRow } from "./StatusComponents";
export { DocumentChecklist } from "./DocumentChecklist";
export { KansrijkheidAnalyse } from "./KansrijkheidAnalyse";
export { ConceptMailEditor } from "./ConceptMailEditor";
export { SessionSidebar } from "./SessionSidebar";
export { GevondenDataCards } from "./GevondenDataCards";
export { RawOutputPanel } from "./RawOutputPanel";
export {
  Box3SettingsModal,
  DEFAULT_BOX3_SYSTEM_PROMPT,
  DEFAULT_INTAKE_PROMPT,
  DEFAULT_YEAR_VALIDATION_PROMPT,
  DEFAULT_EMAIL_PROMPT,
} from "./Box3SettingsModal";
export type { Box3Prompts } from "./Box3SettingsModal";
export { Box3AttachmentsPanel } from "./Box3AttachmentsPanel";
