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
  DEFAULT_INTAKE_PROMPT,
  DEFAULT_YEAR_VALIDATION_PROMPT,
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

  // Load prompts from localStorage (new multi-prompt structure)
  const [prompts, setPrompts] = useState<Box3Prompts>(() => {
    const defaults: Box3Prompts = {
      intake: DEFAULT_INTAKE_PROMPT,
      yearValidation: DEFAULT_YEAR_VALIDATION_PROMPT,
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

  // For backward compatibility: expose intake prompt as systemPrompt
  const systemPrompt = prompts.intake;

  // Session management hook
  const {
    sessions,
    refetchSessions,
    loadSession,
    deleteSession,
    addDocuments,
    updateOverrides,
    convertToMultiYear,
    addYear,
    revalidateYear,
    generateEmail,
  } = useBox3Sessions();

  // State for adding documents and revalidating years
  const [isAddingDocs, setIsAddingDocs] = useState(false);
  const [isRevalidatingYear, setIsRevalidatingYear] = useState(false);
  const [isGeneratingEmail, setIsGeneratingEmail] = useState(false);

  // Validation hook
  const {
    isValidating,
    validationResult,
    currentSessionId,
    debugInfo,
    validate,
    revalidate,
    setValidationResult,
    setCurrentSessionId,
  } = useBox3Validation({
    systemPrompt,
    refetchSessions,
  });

  // Handler to update prompts and save to localStorage
  const handlePromptsChange = useCallback((newPrompts: Box3Prompts) => {
    setPrompts(newPrompts);
    localStorage.setItem(STORAGE_KEY_PROMPTS, JSON.stringify(newPrompts));
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

  // Revalidate handler for detail view (supports both legacy and multi-year)
  const handleRevalidate = useCallback(async (jaar?: string) => {
    if (!selectedSession) return;

    if (jaar && selectedSession.isMultiYear) {
      // Multi-year: revalidate specific year with yearValidation prompt
      setIsRevalidatingYear(true);
      try {
        const updatedSession = await revalidateYear(selectedSession.id, jaar, prompts.yearValidation);
        if (updatedSession) {
          setSelectedSession(updatedSession);
        }
      } finally {
        setIsRevalidatingYear(false);
      }
    } else {
      // Legacy: revalidate entire session with intake prompt
      await revalidate();
      const updatedSession = await loadSession(selectedSession.id);
      if (updatedSession) {
        setSelectedSession(updatedSession);
      }
    }
  }, [selectedSession, revalidate, revalidateYear, loadSession, prompts.yearValidation]);

  // Add documents handler (supports both legacy and multi-year)
  const handleAddDocuments = useCallback(
    async (files: PendingFile[], additionalText?: string, jaar?: string) => {
      if (!selectedSession) return;
      setIsAddingDocs(true);
      try {
        const updatedSession = await addDocuments(selectedSession.id, files, additionalText, jaar);
        if (updatedSession) {
          setSelectedSession(updatedSession);
          // For legacy mode, also update validation result
          if (!jaar && updatedSession.validationResult) {
            setValidationResult(updatedSession.validationResult as Box3ValidationResult);
          }
        }
      } finally {
        setIsAddingDocs(false);
      }
    },
    [selectedSession, addDocuments, setValidationResult]
  );

  // Update overrides handler (supports both legacy and multi-year)
  const handleUpdateOverrides = useCallback(
    async (overrides: Partial<Box3ManualOverrides>, jaar?: string) => {
      if (!selectedSession) return;
      const updatedSession = await updateOverrides(selectedSession.id, overrides, jaar);
      if (updatedSession) {
        setSelectedSession(updatedSession);
      }
    },
    [selectedSession, updateOverrides]
  );

  // Convert to multi-year handler
  const handleConvertToMultiYear = useCallback(async () => {
    if (!selectedSession) return;
    const updatedSession = await convertToMultiYear(selectedSession.id);
    if (updatedSession) {
      setSelectedSession(updatedSession);
    }
  }, [selectedSession, convertToMultiYear]);

  // Add year handler
  const handleAddYear = useCallback(async (jaar: string) => {
    if (!selectedSession) return;
    const updatedSession = await addYear(selectedSession.id, jaar);
    if (updatedSession) {
      setSelectedSession(updatedSession);
    }
  }, [selectedSession, addYear]);

  // Generate email handler
  const handleGenerateEmail = useCallback(async () => {
    if (!selectedSession) return null;
    setIsGeneratingEmail(true);
    try {
      const email = await generateEmail(selectedSession.id, prompts.email);
      return email;
    } finally {
      setIsGeneratingEmail(false);
    }
  }, [selectedSession, generateEmail, prompts.email]);

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

        {viewMode === "detail" && selectedSession && (
          <Box3CaseDetail
            session={selectedSession}
            systemPrompt={systemPrompt}
            isRevalidating={isValidating || isRevalidatingYear}
            isAddingDocs={isAddingDocs}
            isGeneratingEmail={isGeneratingEmail}
            debugInfo={debugInfo}
            onBack={handleBackToList}
            onRevalidate={handleRevalidate}
            onOpenSettings={() => setSettingsOpen(true)}
            onAddDocuments={handleAddDocuments}
            onUpdateOverrides={handleUpdateOverrides}
            onConvertToMultiYear={handleConvertToMultiYear}
            onAddYear={handleAddYear}
            onGenerateEmail={handleGenerateEmail}
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
