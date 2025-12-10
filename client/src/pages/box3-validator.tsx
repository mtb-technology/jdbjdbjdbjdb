/**
 * Box 3 Validator Page - V2
 *
 * Uses the new Blueprint data model:
 * - List view: Overview of all dossiers
 * - Detail view: View existing dossier with Blueprint data
 * - New case view: Create new validation (creates dossier + blueprint)
 */

import { useState, useCallback, memo, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { AppHeader } from "@/components/app-header";

// Hooks
import { useBox3Sessions, type Box3DossierFull } from "@/hooks/useBox3Sessions";
import { useBox3Validation } from "@/hooks/useBox3Validation";

// Components
import {
  Box3SettingsModal,
  DEFAULT_INTAKE_PROMPT,
  DEFAULT_EMAIL_PROMPT,
  Box3CaseList,
  Box3CaseDetail,
  Box3NewCase,
} from "@/components/box3-validator";
import type { Box3Prompts } from "@/components/box3-validator";

// Constants
import { STORAGE_KEY_PROMPTS } from "@/constants/box3.constants";

// Types
import type { PendingFile } from "@/types/box3Validator.types";

const Box3Validator = memo(function Box3Validator() {
  // URL-based routing
  const [, setLocation] = useLocation();
  const [matchDetail, paramsDetail] = useRoute("/box3-validator/:id");
  const [matchNew] = useRoute("/box3-validator/new");

  // Derive view mode from URL
  const viewMode = matchNew ? "new" : matchDetail && paramsDetail?.id ? "detail" : "list";
  const urlDossierId = matchDetail && !matchNew ? paramsDetail?.id : null;

  // View state
  const [selectedDossier, setSelectedDossier] = useState<Box3DossierFull | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isAddingDocs, setIsAddingDocs] = useState(false);

  // Load prompts from localStorage
  const [prompts, setPrompts] = useState<Box3Prompts>(() => {
    const defaults: Box3Prompts = {
      intake: DEFAULT_INTAKE_PROMPT,
      email: DEFAULT_EMAIL_PROMPT,
    };
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(STORAGE_KEY_PROMPTS);
        if (saved) {
          const parsed = JSON.parse(saved);
          return { ...defaults, ...parsed };
        }
      } catch {
        // Ignore parse errors
      }
    }
    return defaults;
  });

  // System prompt is the intake prompt
  const systemPrompt = prompts.intake;

  // Session management hook
  const {
    sessions,
    isLoading: isLoadingSessions,
    refetchSessions,
    loadSession,
    deleteSession,
    addDocuments,
  } = useBox3Sessions();

  // Validation hook
  const {
    isValidating,
    blueprint,
    currentDossierId,
    debugInfo,
    validate,
    revalidate,
    loadFromDossier,
    handleReset,
  } = useBox3Validation({
    systemPrompt,
    refetchSessions,
  });

  // Handler to update prompts and save to localStorage
  const handlePromptsChange = useCallback((newPrompts: Box3Prompts) => {
    setPrompts(newPrompts);
    localStorage.setItem(STORAGE_KEY_PROMPTS, JSON.stringify(newPrompts));
  }, []);

  // Load dossier when URL changes to detail view
  useEffect(() => {
    if (urlDossierId && urlDossierId !== selectedDossier?.dossier.id) {
      loadSession(urlDossierId).then((dossierFull) => {
        if (dossierFull) {
          setSelectedDossier(dossierFull);
          loadFromDossier(dossierFull);
        } else {
          // Dossier not found, go back to list
          setLocation("/box3-validator");
        }
      });
    }
  }, [urlDossierId, selectedDossier?.dossier.id, loadSession, loadFromDossier, setLocation]);

  // Navigation handlers
  const handleSelectCase = useCallback(
    (dossierId: string) => {
      setLocation(`/box3-validator/${dossierId}`);
    },
    [setLocation]
  );

  const handleNewCase = useCallback(() => {
    setSelectedDossier(null);
    handleReset();
    setLocation("/box3-validator/new");
  }, [handleReset, setLocation]);

  const handleBackToList = useCallback(() => {
    setSelectedDossier(null);
    handleReset();
    refetchSessions();
    setLocation("/box3-validator");
  }, [handleReset, refetchSessions, setLocation]);

  const handleDeleteCase = useCallback(
    async (dossierId: string) => {
      const success = await deleteSession(dossierId);
      if (success) {
        refetchSessions();
      }
    },
    [deleteSession, refetchSessions]
  );

  // Validation handler for new case
  const handleValidate = useCallback(
    async (clientName: string, inputText: string, files: PendingFile[]) => {
      const result = await validate(clientName, inputText, files);
      if (result) {
        // Navigate to the new dossier
        setLocation(`/box3-validator/${result.dossier.id}`);
      }
    },
    [validate, setLocation]
  );

  // Revalidate handler for detail view
  const handleRevalidate = useCallback(async () => {
    if (!selectedDossier) return;

    const newBlueprint = await revalidate(selectedDossier.dossier.id);
    if (newBlueprint) {
      // Reload the dossier to get updated data
      const updatedDossier = await loadSession(selectedDossier.dossier.id);
      if (updatedDossier) {
        setSelectedDossier(updatedDossier);
        loadFromDossier(updatedDossier);
      }
    }
  }, [selectedDossier, revalidate, loadSession, loadFromDossier]);

  // Add documents handler
  const handleAddDocuments = useCallback(
    async (files: PendingFile[]) => {
      if (!selectedDossier) return;
      setIsAddingDocs(true);
      try {
        const success = await addDocuments(selectedDossier.dossier.id, files);
        if (success) {
          // Reload the dossier to get updated data
          const updatedDossier = await loadSession(selectedDossier.dossier.id);
          if (updatedDossier) {
            setSelectedDossier(updatedDossier);
            loadFromDossier(updatedDossier);
          }
        }
      } finally {
        setIsAddingDocs(false);
      }
    },
    [selectedDossier, addDocuments, loadSession, loadFromDossier]
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Settings Modal */}
      <Box3SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        prompts={prompts}
        onPromptsChange={handlePromptsChange}
      />

      <AppHeader />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {viewMode === "list" && (
          <Box3CaseList
            sessions={sessions}
            onSelectCase={handleSelectCase}
            onNewCase={handleNewCase}
            onDeleteCase={handleDeleteCase}
          />
        )}

        {viewMode === "detail" && selectedDossier && (
          <Box3CaseDetail
            dossierFull={selectedDossier}
            systemPrompt={systemPrompt}
            isRevalidating={isValidating}
            isAddingDocs={isAddingDocs}
            debugInfo={debugInfo}
            onBack={handleBackToList}
            onRevalidate={handleRevalidate}
            onOpenSettings={() => setSettingsOpen(true)}
            onAddDocuments={handleAddDocuments}
          />
        )}

        {viewMode === "new" && (
          <Box3NewCase
            isValidating={isValidating}
            onBack={handleBackToList}
            onValidate={handleValidate}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}
      </div>
    </div>
  );
});

export default Box3Validator;
