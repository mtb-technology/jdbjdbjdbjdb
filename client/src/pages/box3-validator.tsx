/**
 * Box 3 Validator Page
 *
 * Case-based structure similar to dossiers:
 * - List view: Overview of all cases
 * - Detail view: View existing case results
 * - New case view: Create new validation
 */

import { useState, useCallback, memo, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { AppHeader } from "@/components/app-header";

// Extracted hooks
import { useBox3Sessions } from "@/hooks/useBox3Sessions";
import { useBox3Validation } from "@/hooks/useBox3Validation";

// Components
import {
  Box3SettingsModal,
  DEFAULT_BOX3_SYSTEM_PROMPT,
  Box3CaseList,
  Box3CaseDetail,
  Box3NewCase,
} from "@/components/box3-validator";


// Constants
import { STORAGE_KEY_SYSTEM_PROMPT } from "@/constants/box3.constants";

// Types
import type { PendingFile } from "@/types/box3Validator.types";
import type { Box3ValidatorSession, Box3ValidationResult, Box3ManualOverrides } from "@shared/schema";

const Box3Validator = memo(function Box3Validator() {
  // URL-based routing
  const [, setLocation] = useLocation();
  const [matchDetail, paramsDetail] = useRoute("/box3-validator/:id");
  const [matchNew] = useRoute("/box3-validator/new");

  // Derive view mode from URL
  const viewMode = matchNew ? "new" : matchDetail && paramsDetail?.id ? "detail" : "list";
  const urlSessionId = matchDetail && !matchNew ? paramsDetail?.id : null;

  // View state
  const [selectedSession, setSelectedSession] = useState<Box3ValidatorSession | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Load system prompt from localStorage
  const [systemPrompt, setSystemPrompt] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY_SYSTEM_PROMPT);
      return saved || DEFAULT_BOX3_SYSTEM_PROMPT;
    }
    return DEFAULT_BOX3_SYSTEM_PROMPT;
  });

  // Session management hook
  const { sessions, refetchSessions, loadSession, deleteSession, addDocuments, updateOverrides } =
    useBox3Sessions();

  // State for adding documents
  const [isAddingDocs, setIsAddingDocs] = useState(false);

  // Validation hook
  const {
    isValidating,
    validationResult,
    currentSessionId,
    validate,
    revalidate,
    setValidationResult,
    setCurrentSessionId,
  } = useBox3Validation({
    systemPrompt,
    refetchSessions,
  });

  // Handler to update system prompt and save to localStorage
  const handleSystemPromptChange = useCallback((newPrompt: string) => {
    setSystemPrompt(newPrompt);
    localStorage.setItem(STORAGE_KEY_SYSTEM_PROMPT, newPrompt);
  }, []);

  // Load session when URL changes to detail view
  useEffect(() => {
    if (urlSessionId && urlSessionId !== selectedSession?.id) {
      loadSession(urlSessionId).then((session) => {
        if (session) {
          setSelectedSession(session);
          setValidationResult(session.validationResult as Box3ValidationResult);
          setCurrentSessionId(session.id);
        } else {
          // Session not found, go back to list
          setLocation("/box3-validator");
        }
      });
    }
  }, [urlSessionId, selectedSession?.id, loadSession, setValidationResult, setCurrentSessionId, setLocation]);

  // Navigation handlers - now use URL routing
  const handleSelectCase = useCallback(
    (sessionId: string) => {
      setLocation(`/box3-validator/${sessionId}`);
    },
    [setLocation]
  );

  const handleNewCase = useCallback(() => {
    setSelectedSession(null);
    setValidationResult(null);
    setCurrentSessionId(null);
    setLocation("/box3-validator/new");
  }, [setValidationResult, setCurrentSessionId, setLocation]);

  const handleBackToList = useCallback(() => {
    setSelectedSession(null);
    refetchSessions(); // Refresh list when returning
    setLocation("/box3-validator");
  }, [refetchSessions, setLocation]);

  const handleDeleteCase = useCallback(
    async (sessionId: string) => {
      const success = await deleteSession(sessionId);
      if (success) {
        refetchSessions();
      }
    },
    [deleteSession, refetchSessions]
  );

  // Validation handler for new case
  const handleValidate = useCallback(
    async (clientName: string, inputText: string, files: PendingFile[]) => {
      await validate(clientName, inputText, files);
      // After validation, go to detail view with the new session
      refetchSessions();
    },
    [validate, refetchSessions]
  );

  // Watch for validation completion - navigate to detail view
  useEffect(() => {
    if (viewMode === "new" && validationResult && currentSessionId && !selectedSession) {
      setLocation(`/box3-validator/${currentSessionId}`);
    }
  }, [viewMode, validationResult, currentSessionId, selectedSession, setLocation]);

  // Revalidate handler for detail view
  const handleRevalidate = useCallback(async () => {
    if (selectedSession) {
      await revalidate();
      // Refresh the session after revalidation
      const updatedSession = await loadSession(selectedSession.id);
      if (updatedSession) {
        setSelectedSession(updatedSession);
      }
    }
  }, [selectedSession, revalidate, loadSession]);

  // Add documents handler
  const handleAddDocuments = useCallback(
    async (files: PendingFile[], additionalText?: string) => {
      if (!selectedSession) return;
      setIsAddingDocs(true);
      try {
        const updatedSession = await addDocuments(selectedSession.id, files, additionalText);
        if (updatedSession) {
          setSelectedSession(updatedSession);
          setValidationResult(updatedSession.validationResult as Box3ValidationResult);
        }
      } finally {
        setIsAddingDocs(false);
      }
    },
    [selectedSession, addDocuments, setValidationResult]
  );

  // Update overrides handler
  const handleUpdateOverrides = useCallback(
    async (overrides: Parameters<typeof updateOverrides>[1]) => {
      if (!selectedSession) return;
      const updatedSession = await updateOverrides(selectedSession.id, overrides);
      if (updatedSession) {
        setSelectedSession(updatedSession);
      }
    },
    [selectedSession, updateOverrides]
  );

  return (
    <div className="min-h-screen bg-background">
      {/* Settings Modal */}
      <Box3SettingsModal
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        systemPrompt={systemPrompt}
        onSystemPromptChange={handleSystemPromptChange}
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

        {viewMode === "detail" && selectedSession && (
          <Box3CaseDetail
            session={selectedSession}
            systemPrompt={systemPrompt}
            isRevalidating={isValidating}
            isAddingDocs={isAddingDocs}
            onBack={handleBackToList}
            onRevalidate={handleRevalidate}
            onOpenSettings={() => setSettingsOpen(true)}
            onAddDocuments={handleAddDocuments}
            onUpdateOverrides={handleUpdateOverrides}
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
