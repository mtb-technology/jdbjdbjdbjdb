import { createContext, useContext, useReducer, ReactNode } from "react";
import type { Report } from "@shared/schema";

export interface WorkflowState {
  currentReport: Report | null;
  currentStageIndex: number;
  stageResults: Record<string, string>;
  substepResults: Record<string, { review?: string; processing?: string }>;
  conceptReportVersions: Record<string, string>;
  stageTimes: Record<string, number>;
  stageProcessing: Record<string, boolean>;
  currentStageTimer: number;
  customInput: string;
  viewMode: "stage" | "concept";
  editingStage: string | null;
  expandedSteps: string[];
  manualMode: "ai" | "manual"; // For stage 3
  manualContent: string; // For stage 3
  manualModes: Record<string, "ai" | "manual">; // Per-stage manual mode (for 4A, 4B)
  manualContents: Record<string, string>; // Per-stage manual content (for 4A, 4B)
  showManualDialog: boolean;
  copiedPrompt: boolean;
  stageStartTime: Date | null;
  stagePrompts: Record<string, string>;
}

export type WorkflowAction =
  | { type: "SET_REPORT"; payload: Report | null }
  | { type: "SET_STAGE_INDEX"; payload: number }
  | { type: "SET_CURRENT_STAGE_INDEX"; index: number }
  | { type: "SET_STAGE_RESULT"; stage: string; result: string }
  | { type: "SET_SUBSTEP_RESULT"; stage: string; substepType: "review" | "processing"; result: string }
  | { type: "SET_CONCEPT_VERSION"; stage: string; content: string }
  | { type: "SET_STAGE_TIME"; stage: string; time: number }
  | { type: "SET_STAGE_PROCESSING"; stage: string; isProcessing: boolean }
  | { type: "UPDATE_TIMER"; time: number }
  | { type: "SET_CUSTOM_INPUT"; input: string }
  | { type: "SET_VIEW_MODE"; mode: "stage" | "concept" }
  | { type: "SET_EDITING_STAGE"; stage: string | null }
  | { type: "TOGGLE_STEP_EXPANSION"; stage: string }
  | { type: "SET_MANUAL_MODE"; mode: "ai" | "manual" } // For stage 3
  | { type: "SET_MANUAL_CONTENT"; content: string } // For stage 3
  | { type: "SET_STAGE_MANUAL_MODE"; stage: string; mode: "ai" | "manual" } // For 4A, 4B
  | { type: "SET_STAGE_MANUAL_CONTENT"; stage: string; content: string } // For 4A, 4B
  | { type: "SET_SHOW_MANUAL_DIALOG"; show: boolean }
  | { type: "SET_COPIED_PROMPT"; copied: boolean }
  | { type: "SET_STAGE_START_TIME"; time: Date | null }
  | { type: "SET_STAGE_PROMPT"; stage: string; prompt: string }
  | { type: "CLEAR_STAGE_PROMPTS" }
  | { type: "RESET_WORKFLOW" }
  | { type: "LOAD_EXISTING_REPORT"; report: Report };

// Memory-optimized configuration
// ✅ FIX #5: Increased limits to support step-back functionality
// Previous: 30 stage results, 15 concept versions (too aggressive)
// New: 100 stage results (6 stages * 10+ iterations), 50 concept versions (6 specialists * 5+ versions each)
const MAX_STAGE_RESULTS = 100; // Maximum stage results to keep in memory
const MAX_CONCEPT_VERSIONS = 50; // Maximum concept versions to store

const initialState: WorkflowState = {
  currentReport: null,
  currentStageIndex: 0,
  stageResults: {},
  substepResults: {},
  conceptReportVersions: {},
  stageTimes: {},
  stageProcessing: {},
  currentStageTimer: 0,
  customInput: "",
  viewMode: "stage",
  editingStage: null,
  expandedSteps: ["1_informatiecheck", "2_complexiteitscheck", "3_generatie"],
  manualMode: "ai",
  manualContent: "",
  manualModes: {},
  manualContents: {},
  showManualDialog: false,
  copiedPrompt: false,
  stageStartTime: null,
  stagePrompts: {},
};

function workflowReducer(state: WorkflowState, action: WorkflowAction): WorkflowState {
  switch (action.type) {
    case "SET_REPORT":
      return { ...state, currentReport: action.payload };
    
    case "SET_STAGE_INDEX":
      return { ...state, currentStageIndex: action.payload };

    case "SET_CURRENT_STAGE_INDEX":
      return { ...state, currentStageIndex: action.index };

    case "SET_STAGE_RESULT":
      // ✅ FIX #5: Smarter memory-optimized stage result storage
      const newStageResults = { ...state.stageResults, [action.stage]: action.result };

      // Prune oldest results if exceeding limit (smart pruning)
      const stageKeys = Object.keys(newStageResults);
      if (stageKeys.length > MAX_STAGE_RESULTS) {
        // Group results by stage type (e.g., "4a_BronnenSpecialist", "4b_FiscaalTechnischSpecialist")
        const stageGroups = new Map<string, string[]>();
        stageKeys.forEach(key => {
          // Extract base stage name (remove version/iteration suffix if present)
          const baseStage = key.split('_v')[0].split('_iter')[0];
          if (!stageGroups.has(baseStage)) {
            stageGroups.set(baseStage, []);
          }
          stageGroups.get(baseStage)!.push(key);
        });

        // Keep only the latest version per stage type + last 20 overall
        const keysToKeep = new Set<string>();

        // Keep latest per stage type
        stageGroups.forEach((versions) => {
          // Sort by key (assumes chronological naming) and keep latest
          const sortedVersions = versions.sort();
          const latest = sortedVersions[sortedVersions.length - 1];
          if (latest) keysToKeep.add(latest);
        });

        // Also keep last 20 results overall (chronological order)
        stageKeys.slice(-20).forEach(k => keysToKeep.add(k));

        // Delete everything else
        const keysToDelete = stageKeys.filter(k => !keysToKeep.has(k));
        keysToDelete.forEach(key => delete newStageResults[key]);

        if (keysToDelete.length > 0) {
          console.log(`🧹 Pruned ${keysToDelete.length} old stage results (kept latest per stage + last 20 overall)`);
        }
      }

      return {
        ...state,
        stageResults: newStageResults
      };
    
    case "SET_SUBSTEP_RESULT":
      return {
        ...state,
        substepResults: {
          ...state.substepResults,
          [action.stage]: {
            ...state.substepResults[action.stage],
            [action.substepType]: action.result
          }
        }
      };
    
    case "SET_CONCEPT_VERSION":
      // ✅ FIX #5: Smarter memory-optimized concept version storage
      const newConceptVersions = {
        ...state.conceptReportVersions,
        [action.stage]: action.content
      };

      // Prune oldest versions if exceeding limit (smart pruning)
      const versionKeys = Object.keys(newConceptVersions);
      if (versionKeys.length > MAX_CONCEPT_VERSIONS) {
        // Group versions by stage type
        const versionGroups = new Map<string, string[]>();
        versionKeys.forEach(key => {
          // Skip special keys
          if (['latest', 'history'].includes(key)) {
            return;
          }

          // Extract base stage name
          const baseStage = key.split('_v')[0].split('_iter')[0];
          if (!versionGroups.has(baseStage)) {
            versionGroups.set(baseStage, []);
          }
          versionGroups.get(baseStage)!.push(key);
        });

        // Keep only the latest version per stage type + last 15 overall + special keys
        const keysToKeep = new Set<string>();

        // Always keep special keys
        ['latest', 'history'].forEach(k => {
          if (versionKeys.includes(k)) keysToKeep.add(k);
        });

        // Keep latest per stage type
        versionGroups.forEach((versions) => {
          const sortedVersions = versions.sort();
          const latest = sortedVersions[sortedVersions.length - 1];
          if (latest) keysToKeep.add(latest);
        });

        // Also keep last 15 versions overall
        versionKeys.filter(k => !['latest', 'history'].includes(k))
          .slice(-15)
          .forEach(k => keysToKeep.add(k));

        // Delete everything else
        const keysToDelete = versionKeys.filter(k => !keysToKeep.has(k));
        keysToDelete.forEach(key => delete newConceptVersions[key]);

        if (keysToDelete.length > 0) {
          console.log(`🧹 Pruned ${keysToDelete.length} old concept versions (kept latest per stage + last 15 overall)`);
        }
      }

      return {
        ...state,
        conceptReportVersions: newConceptVersions
      };
    
    case "SET_STAGE_TIME":
      return {
        ...state,
        stageTimes: { ...state.stageTimes, [action.stage]: action.time }
      };
    
    case "SET_STAGE_PROCESSING":
      return {
        ...state,
        stageProcessing: {
          ...state.stageProcessing,
          [action.stage]: action.isProcessing
        }
      };

    case "UPDATE_TIMER":
      return { ...state, currentStageTimer: action.time };
    
    case "SET_CUSTOM_INPUT":
      return { ...state, customInput: action.input };
    
    case "SET_VIEW_MODE":
      return { ...state, viewMode: action.mode };
    
    case "SET_EDITING_STAGE":
      return { ...state, editingStage: action.stage };
    
    case "TOGGLE_STEP_EXPANSION":
      const newExpanded = [...state.expandedSteps];
      const index = newExpanded.indexOf(action.stage);
      if (index > -1) {
        newExpanded.splice(index, 1);
      } else {
        newExpanded.push(action.stage);
      }
      return { ...state, expandedSteps: newExpanded };
    
    case "SET_MANUAL_MODE":
      return { ...state, manualMode: action.mode };

    case "SET_MANUAL_CONTENT":
      return { ...state, manualContent: action.content };

    case "SET_STAGE_MANUAL_MODE":
      return {
        ...state,
        manualModes: { ...state.manualModes, [action.stage]: action.mode }
      };

    case "SET_STAGE_MANUAL_CONTENT":
      return {
        ...state,
        manualContents: { ...state.manualContents, [action.stage]: action.content }
      };

    case "SET_SHOW_MANUAL_DIALOG":
      return { ...state, showManualDialog: action.show };
    
    case "SET_COPIED_PROMPT":
      return { ...state, copiedPrompt: action.copied };
    
    case "SET_STAGE_START_TIME":
      return { ...state, stageStartTime: action.time };
    
    case "SET_STAGE_PROMPT":
      return {
        ...state,
        stagePrompts: { ...state.stagePrompts, [action.stage]: action.prompt }
      };

    case "CLEAR_STAGE_PROMPTS":
      return {
        ...state,
        stagePrompts: {}
      };

    case "RESET_WORKFLOW":
      return initialState;
    
    case "LOAD_EXISTING_REPORT":
      const stageResults = (action.report.stageResults as Record<string, string>) || {};
      const completedStages = Object.keys(stageResults);
      
      console.log(`🔄 WorkflowReducer: LOAD_EXISTING_REPORT`, {
        reportId: action.report.id,
        stageResultKeys: completedStages,
        hasSubstepResults: !!(action.report.substepResults),
        currentStageIndexBefore: state.currentStageIndex,
        existingStagePrompts: Object.keys(state.stagePrompts || {}),
        reportStagePrompts: Object.keys((action.report.stagePrompts as Record<string, string>) || {})
      });
      
      // Calculate proper stage index based on completed stages (same logic as initialization)
      const WORKFLOW_STAGES = [
        { key: "1_informatiecheck" },
        { key: "2_complexiteitscheck" },
        { key: "3_generatie" },
        { key: "4a_BronnenSpecialist" },
        { key: "4b_FiscaalTechnischSpecialist" },
        { key: "4c_ScenarioGatenAnalist" },
        { key: "4d_DeVertaler" },
        { key: "4e_DeAdvocaat" },
        { key: "4f_DeKlantpsycholoog" },
        { key: "6_change_summary" }
      ];
      
      // ✅ KEEP CURRENT STAGE: Don't auto-advance, user controls progression
      // Keep the current stage index unless it's a completely new report
      let newStageIndex = state.currentStageIndex;

      // Only initialize to first incomplete stage if this is the first load (index is 0)
      if (state.currentStageIndex === 0 && completedStages.length > 0) {
        // Find the highest completed stage index (not just the last key)
        const completedIndices = completedStages
          .map(stageKey => WORKFLOW_STAGES.findIndex(s => s.key === stageKey))
          .filter(index => index >= 0);

        if (completedIndices.length > 0) {
          const highestCompletedIndex = Math.max(...completedIndices);
          // Stay on the last completed stage, NOT the next one
          newStageIndex = highestCompletedIndex;
        }
      }
      
      console.log(`🔄 Stage index recalculation:`, {
        completedStages,
        completedIndices: completedStages.map(stageKey => ({ stageKey, index: WORKFLOW_STAGES.findIndex(s => s.key === stageKey) })),
        highestCompletedIndex: completedStages.length > 0 ? Math.max(...completedStages.map(stageKey => WORKFLOW_STAGES.findIndex(s => s.key === stageKey)).filter(i => i >= 0)) : -1,
        newStageIndex,
        previousStageIndex: state.currentStageIndex,
        newStageName: WORKFLOW_STAGES[newStageIndex]?.key
      });
      
      // Merge existing stage prompts with report stage prompts, preserving existing ones
      // Normalize prompt objects to strings (handle { systemPrompt, userInput } format)
      const reportStagePrompts = (action.report.stagePrompts as Record<string, any>) || {};
      const normalizedPrompts: Record<string, string> = {};

      Object.entries(reportStagePrompts).forEach(([key, value]) => {
        if (typeof value === 'string') {
          normalizedPrompts[key] = value;
        } else if (value && typeof value === 'object' && 'systemPrompt' in value && 'userInput' in value) {
          // Convert { systemPrompt, userInput } to single string
          normalizedPrompts[key] = `${value.systemPrompt}\n\n### USER INPUT:\n${value.userInput}`;
        } else if (value && typeof value === 'object') {
          // Fallback: stringify other objects
          normalizedPrompts[key] = JSON.stringify(value, null, 2);
        }
      });

      const mergedStagePrompts = {
        ...state.stagePrompts,
        ...normalizedPrompts
      };
      
      return {
        ...state,
        currentReport: action.report,
        currentStageIndex: newStageIndex,
        stageResults: { ...state.stageResults, ...stageResults },
        substepResults: { ...state.substepResults, ...((action.report.substepResults as Record<string, { review?: string; processing?: string }>) || {}) },
        conceptReportVersions: (action.report.conceptReportVersions as Record<string, string>) || {},
        stagePrompts: mergedStagePrompts,
      };
    
    default:
      return state;
  }
}

const WorkflowContext = createContext<{
  state: WorkflowState;
  dispatch: React.Dispatch<WorkflowAction>;
} | undefined>(undefined);

export function WorkflowProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(workflowReducer, initialState);

  return (
    <WorkflowContext.Provider value={{ state, dispatch }}>
      {children}
    </WorkflowContext.Provider>
  );
}

export function useWorkflow() {
  const context = useContext(WorkflowContext);
  if (!context) {
    throw new Error("useWorkflow must be used within WorkflowProvider");
  }
  return context;
}