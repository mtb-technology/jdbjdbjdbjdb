/**
 * Box 3 Validator Page - V2
 *
 * Uses the new Blueprint data model:
 * - List view: Overview of all dossiers
 * - Detail view: View existing dossier with Blueprint data
 * - New case view: Create new validation (creates dossier + blueprint)
 */

import { useState, useCallback, memo, useEffect, useMemo, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AppHeader } from "@/components/app-header";

// Hooks
import { useBox3Sessions, type Box3DossierFull } from "@/hooks/useBox3Sessions";
import { useBox3Validation, type PipelineVersion } from "@/hooks/useBox3Validation";

// Components
import {
  Box3CaseList,
  Box3CaseDetail,
  Box3NewCase,
} from "@/components/box3-validator";

// Query keys
import { QUERY_KEYS } from "@/lib/queryKeys";

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
  const [isLoadingDossier, setIsLoadingDossier] = useState(false);
  const [isAddingDocs, setIsAddingDocs] = useState(false);

  // Load Box3 config from prompt config (server-side settings)
  const { data: promptConfig } = useQuery<{ config: { box3Config?: { emailPrompt?: string } } }>({
    queryKey: QUERY_KEYS.prompts.active(),
  });

  // Email prompt from server config (used for email generation in detail view)
  const emailPrompt = useMemo(() => {
    return promptConfig?.config?.box3Config?.emailPrompt || "";
  }, [promptConfig]);

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
    pipelineProgress,
    activeJobId,
    activeJob,
    pipelineVersion,
    startValidationJob,
    startRevalidationJob,
    cancelRevalidationJob,
    loadFromDossier,
    handleReset,
    checkForActiveJob,
    setPipelineVersion,
  } = useBox3Validation({
    refetchSessions,
  });

  // Load dossier when URL changes to detail view
  useEffect(() => {
    if (urlDossierId && urlDossierId !== selectedDossier?.dossier.id) {
      setIsLoadingDossier(true);
      loadSession(urlDossierId).then((dossierFull) => {
        if (dossierFull) {
          setSelectedDossier(dossierFull);
          loadFromDossier(dossierFull);
        } else {
          // Dossier not found, go back to list
          setLocation("/box3-validator");
        }
      }).finally(() => {
        setIsLoadingDossier(false);
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

  // Validation handler for new case - uses job-based flow for immediate navigation
  const handleValidate = useCallback(
    async (clientName: string, inputText: string, files: PendingFile[]) => {
      const result = await startValidationJob(clientName, inputText, files);
      if (result) {
        // Navigate immediately to the new dossier - progress will be shown there
        setLocation(`/box3-validator/${result.dossierId}`);
      }
    },
    [startValidationJob, setLocation]
  );

  // Check for active jobs when loading a dossier
  useEffect(() => {
    if (selectedDossier?.dossier.id) {
      checkForActiveJob(selectedDossier.dossier.id);
    }
  }, [selectedDossier?.dossier.id, checkForActiveJob]);

  // Track previous activeJobId to detect job completion
  const prevActiveJobIdRef = useRef<string | null>(null);

  // Reload dossier when job completes (transitions from having a job to no job)
  useEffect(() => {
    const hadJob = prevActiveJobIdRef.current !== null;
    const hasNoJobNow = activeJobId === null;

    // Update ref for next render
    prevActiveJobIdRef.current = activeJobId;

    // Only reload if we HAD a job and now we don't (job just completed)
    if (hadJob && hasNoJobNow && selectedDossier?.dossier.id && !isValidating) {
      const reloadDossier = async () => {
        const updatedDossier = await loadSession(selectedDossier.dossier.id);
        if (updatedDossier) {
          setSelectedDossier(updatedDossier);
          loadFromDossier(updatedDossier);
        }
      };
      reloadDossier();
    }
  }, [activeJobId, selectedDossier?.dossier.id, isValidating, loadSession, loadFromDossier]);

  // Revalidate handler for detail view (now uses job-based flow)
  const handleRevalidate = useCallback(async () => {
    if (!selectedDossier) return;
    await startRevalidationJob(selectedDossier.dossier.id);
  }, [selectedDossier, startRevalidationJob]);

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

        {viewMode === "detail" && isLoadingDossier && (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mb-4" />
            <p className="text-muted-foreground">Dossier laden...</p>
          </div>
        )}

        {viewMode === "detail" && !isLoadingDossier && selectedDossier && (
          <Box3CaseDetail
            dossierFull={selectedDossier}
            isRevalidating={isValidating}
            isAddingDocs={isAddingDocs}
            debugInfo={debugInfo}
            pipelineProgress={pipelineProgress}
            activeJobId={activeJobId}
            pipelineVersion={pipelineVersion}
            onPipelineVersionChange={setPipelineVersion}
            onBack={handleBackToList}
            onRevalidate={handleRevalidate}
            onCancelRevalidation={cancelRevalidationJob}
            onAddDocuments={handleAddDocuments}
          />
        )}

        {viewMode === "detail" && !isLoadingDossier && !selectedDossier && (
          <div className="flex flex-col items-center justify-center py-16">
            <p className="text-muted-foreground mb-4">Dossier niet gevonden</p>
            <button
              onClick={handleBackToList}
              className="text-primary hover:underline"
            >
              Terug naar overzicht
            </button>
          </div>
        )}

        {viewMode === "new" && (
          <Box3NewCase
            isValidating={isValidating}
            pipelineVersion={pipelineVersion}
            onPipelineVersionChange={setPipelineVersion}
            onBack={handleBackToList}
            onValidate={handleValidate}
          />
        )}
      </div>
    </div>
  );
});

export default Box3Validator;
