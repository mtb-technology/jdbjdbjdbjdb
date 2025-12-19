/**
 * Box 3 Validator Components - Barrel Export (V2)
 *
 * V2 architecture using Blueprint data model.
 * V1 components (KansrijkheidAnalyse, GevondenDataCards, DocumentChecklist,
 * Box3YearEntry, Box3TotalOverview, SessionSidebar, ConceptMailEditor) removed.
 *
 * Note: Box3 settings are now in the main Settings page (/settings?tab=box3)
 */

// Page-level components
export { Box3CaseList } from "./Box3CaseList";
export { Box3CaseDetail } from "./Box3CaseDetail";
export { Box3NewCase } from "./Box3NewCase";

// Shared components
export { RawOutputPanel } from "./RawOutputPanel";
export { Box3AttachmentsPanel } from "./Box3AttachmentsPanel";
export { Box3ActionCards } from "./Box3ActionCards";
