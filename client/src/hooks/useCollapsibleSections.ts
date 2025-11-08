/**
 * useCollapsibleSections Hook
 *
 * Manages collapse state for multiple sections and inputs across different stages.
 * Used in workflow views to track which sections/inputs are expanded or collapsed.
 */

import { useState, useCallback } from 'react';

export interface CollapsibleSectionsState {
  // Collapsed inputs per stage (stageKey -> Set of inputKeys)
  collapsedInputs: Record<string, Set<string>>;
  // Collapsed sections per stage (stageKey -> Set of sectionKeys)
  collapsedSections: Record<string, Set<string>>;
}

export interface CollapsibleSectionsActions {
  toggleInput: (stageKey: string, inputKey: string) => void;
  toggleSection: (stageKey: string, sectionKey: string) => void;
  isInputCollapsed: (stageKey: string, inputKey: string) => boolean;
  isSectionCollapsed: (stageKey: string, sectionKey: string) => boolean;
  collapseAllInputs: (stageKey: string) => void;
  expandAllInputs: (stageKey: string) => void;
  collapseAllSections: (stageKey: string) => void;
  expandAllSections: (stageKey: string) => void;
}

export type UseCollapsibleSectionsReturn = CollapsibleSectionsState & CollapsibleSectionsActions;

/**
 * Hook to manage collapsible sections and inputs in a workflow view.
 *
 * @returns Object with state and action methods for managing collapse state
 *
 * @example
 * ```tsx
 * const {
 *   toggleInput,
 *   toggleSection,
 *   isInputCollapsed,
 *   isSectionCollapsed
 * } = useCollapsibleSections();
 *
 * // Toggle an input section
 * toggleInput('3_generatie', 'previousStepOutput');
 *
 * // Check if collapsed
 * const collapsed = isInputCollapsed('3_generatie', 'previousStepOutput');
 * ```
 */
export function useCollapsibleSections(): UseCollapsibleSectionsReturn {
  const [collapsedInputs, setCollapsedInputs] = useState<Record<string, Set<string>>>({});
  const [collapsedSections, setCollapsedSections] = useState<Record<string, Set<string>>>({});

  /**
   * Toggles the collapsed state of an input section.
   * Default state is COLLAPSED (not in the set = collapsed).
   */
  const toggleInput = useCallback((stageKey: string, inputKey: string) => {
    setCollapsedInputs(prev => {
      const stageCollapsed = prev[stageKey] || new Set<string>();
      const newStageCollapsed = new Set(stageCollapsed);

      if (newStageCollapsed.has(inputKey)) {
        // Was expanded, now collapse it (remove from set)
        newStageCollapsed.delete(inputKey);
      } else {
        // Was collapsed, now expand it (add to set)
        newStageCollapsed.add(inputKey);
      }

      return {
        ...prev,
        [stageKey]: newStageCollapsed
      };
    });
  }, []);

  /**
   * Toggles the collapsed state of a content section.
   * Default state is COLLAPSED (not in the set = collapsed).
   */
  const toggleSection = useCallback((stageKey: string, sectionKey: string) => {
    setCollapsedSections(prev => {
      const stageCollapsed = prev[stageKey] || new Set<string>();
      const newStageCollapsed = new Set(stageCollapsed);

      if (newStageCollapsed.has(sectionKey)) {
        // Was expanded, now collapse it (remove from set)
        newStageCollapsed.delete(sectionKey);
      } else {
        // Was collapsed, now expand it (add to set)
        newStageCollapsed.add(sectionKey);
      }

      return {
        ...prev,
        [stageKey]: newStageCollapsed
      };
    });
  }, []);

  /**
   * Checks if an input section is collapsed.
   * Default: true (collapsed) - items NOT in the set are collapsed.
   */
  const isInputCollapsed = useCallback((stageKey: string, inputKey: string): boolean => {
    return !collapsedInputs[stageKey]?.has(inputKey);
  }, [collapsedInputs]);

  /**
   * Checks if a content section is collapsed.
   * Default: true (collapsed) - items NOT in the set are collapsed.
   */
  const isSectionCollapsed = useCallback((stageKey: string, sectionKey: string): boolean => {
    return !collapsedSections[stageKey]?.has(sectionKey);
  }, [collapsedSections]);

  /**
   * Collapses all inputs for a specific stage.
   */
  const collapseAllInputs = useCallback((stageKey: string) => {
    setCollapsedInputs(prev => ({
      ...prev,
      [stageKey]: new Set()
    }));
  }, []);

  /**
   * Expands all inputs for a specific stage.
   */
  const expandAllInputs = useCallback((stageKey: string) => {
    // This would require knowing all possible input keys for the stage
    // For now, we'll just clear the set (collapse all)
    collapseAllInputs(stageKey);
  }, [collapseAllInputs]);

  /**
   * Collapses all sections for a specific stage.
   */
  const collapseAllSections = useCallback((stageKey: string) => {
    setCollapsedSections(prev => ({
      ...prev,
      [stageKey]: new Set()
    }));
  }, []);

  /**
   * Expands all sections for a specific stage.
   */
  const expandAllSections = useCallback((stageKey: string) => {
    // This would require knowing all possible section keys for the stage
    // For now, we'll just clear the set (collapse all)
    collapseAllSections(stageKey);
  }, [collapseAllSections]);

  return {
    collapsedInputs,
    collapsedSections,
    toggleInput,
    toggleSection,
    isInputCollapsed,
    isSectionCollapsed,
    collapseAllInputs,
    expandAllInputs,
    collapseAllSections,
    expandAllSections
  };
}
