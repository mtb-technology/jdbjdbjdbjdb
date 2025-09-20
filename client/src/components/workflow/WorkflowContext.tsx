import { createContext, useContext, useReducer, ReactNode } from "react";
import type { Report } from "@shared/schema";

interface WorkflowState {
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
  expandedSteps: Set<string>;
  manualMode: "ai" | "manual";
  manualContent: string;
  showManualDialog: boolean;
  copiedPrompt: boolean;
  stageStartTime: Date | null;
  stagePrompts: Record<string, string>;
}

type WorkflowAction =
  | { type: "SET_REPORT"; payload: Report | null }
  | { type: "SET_STAGE_INDEX"; payload: number }
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
  | { type: "SET_MANUAL_MODE"; mode: "ai" | "manual" }
  | { type: "SET_MANUAL_CONTENT"; content: string }
  | { type: "SET_SHOW_MANUAL_DIALOG"; show: boolean }
  | { type: "SET_COPIED_PROMPT"; copied: boolean }
  | { type: "SET_STAGE_START_TIME"; time: Date | null }
  | { type: "SET_STAGE_PROMPT"; stage: string; prompt: string }
  | { type: "RESET_WORKFLOW" }
  | { type: "LOAD_EXISTING_REPORT"; report: Report };

// Memory-optimized configuration
const MAX_STAGE_RESULTS = 30; // Maximum stage results to keep in memory
const MAX_CONCEPT_VERSIONS = 15; // Maximum concept versions to store

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
  expandedSteps: new Set(["1_informatiecheck", "2_complexiteitscheck", "3_generatie"]),
  manualMode: "ai",
  manualContent: "",
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
    
    case "SET_STAGE_RESULT":
      // Memory-optimized stage result storage
      const newStageResults = { ...state.stageResults, [action.stage]: action.result };
      
      // Prune oldest results if exceeding limit
      const stageKeys = Object.keys(newStageResults);
      if (stageKeys.length > MAX_STAGE_RESULTS) {
        const keysToDelete = stageKeys.slice(0, stageKeys.length - MAX_STAGE_RESULTS);
        keysToDelete.forEach(key => delete newStageResults[key]);
        console.log(`Pruned ${keysToDelete.length} old stage results for memory optimization`);
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
      // Memory-optimized concept version storage
      const newConceptVersions = {
        ...state.conceptReportVersions,
        [action.stage]: action.content
      };
      
      // Prune oldest versions if exceeding limit
      const versionKeys = Object.keys(newConceptVersions);
      if (versionKeys.length > MAX_CONCEPT_VERSIONS) {
        const keysToDelete = versionKeys.slice(0, versionKeys.length - MAX_CONCEPT_VERSIONS);
        keysToDelete.forEach(key => delete newConceptVersions[key]);
        console.log(`Pruned ${keysToDelete.length} old concept versions for memory optimization`);
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
      const newExpanded = new Set(state.expandedSteps);
      if (newExpanded.has(action.stage)) {
        newExpanded.delete(action.stage);
      } else {
        newExpanded.add(action.stage);
      }
      return { ...state, expandedSteps: newExpanded };
    
    case "SET_MANUAL_MODE":
      return { ...state, manualMode: action.mode };
    
    case "SET_MANUAL_CONTENT":
      return { ...state, manualContent: action.content };
    
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
        { key: "4g_ChefEindredactie" },
        { key: "5_feedback_verwerker" },
        { key: "6_change_summary" },
        { key: "final_check" }
      ];
      
      let newStageIndex = 0;
      if (completedStages.length > 0) {
        // Find the highest completed stage index (not just the last key)
        const completedIndices = completedStages
          .map(stageKey => WORKFLOW_STAGES.findIndex(s => s.key === stageKey))
          .filter(index => index >= 0);
        
        if (completedIndices.length > 0) {
          const highestCompletedIndex = Math.max(...completedIndices);
          newStageIndex = Math.min(highestCompletedIndex + 1, WORKFLOW_STAGES.length - 1);
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
      const mergedStagePrompts = {
        ...state.stagePrompts,
        ...((action.report.stagePrompts as Record<string, string>) || {})
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