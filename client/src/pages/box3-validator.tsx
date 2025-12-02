/**
 * Box 3 Validator Page
 *
 * Case-based structure similar to dossiers:
 * - List view: Overview of all cases
 * - Detail view: View existing case results
 * - New case view: Create new validation
 */

import { useState, useCallback, memo } from "react";
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
import type { Box3ValidatorSession, Box3ValidationResult } from "@shared/schema";

type ViewMode = "list" | "detail" | "new";

const Box3Validator = memo(function Box3Validator() {
  // View state
  const [viewMode, setViewMode] = useState<ViewMode>("list");
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
  const { sessions, refetchSessions, loadSession, deleteSession } =
    useBox3Sessions();

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

  // Navigation handlers
  const handleSelectCase = useCallback(
    async (sessionId: string) => {
      const session = await loadSession(sessionId);
      if (session) {
        setSelectedSession(session);
        setValidationResult(session.validationResult as Box3ValidationResult);
        setCurrentSessionId(session.id);
        setViewMode("detail");
      }
    },
    [loadSession, setValidationResult, setCurrentSessionId]
  );

  const handleNewCase = useCallback(() => {
    setSelectedSession(null);
    setValidationResult(null);
    setCurrentSessionId(null);
    setViewMode("new");
  }, [setValidationResult, setCurrentSessionId]);

  const handleBackToList = useCallback(() => {
    setSelectedSession(null);
    setViewMode("list");
    refetchSessions(); // Refresh list when returning
  }, [refetchSessions]);

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

  // When validation completes, switch to detail view
  const handleValidationComplete = useCallback(async () => {
    if (currentSessionId) {
      const session = await loadSession(currentSessionId);
      if (session) {
        setSelectedSession(session);
        setViewMode("detail");
      }
    }
  }, [currentSessionId, loadSession]);

  // Watch for validation completion
  if (viewMode === "new" && validationResult && currentSessionId && !selectedSession) {
    handleValidationComplete();
  }

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
            onBack={handleBackToList}
            onRevalidate={handleRevalidate}
            onOpenSettings={() => setSettingsOpen(true)}
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
