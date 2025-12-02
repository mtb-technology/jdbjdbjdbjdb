/**
 * Box 3 Validator Page
 *
 * Refactored from 1,486 lines to ~350 lines following Clean Code and SOLID principles.
 *
 * Changes:
 * - Extracted constants to constants/box3.constants.ts
 * - Extracted utility functions to utils/box3Utils.ts
 * - Extracted types to types/box3Validator.types.ts
 * - Extracted hooks: useBox3Sessions, useBox3Validation
 * - Extracted components: DocumentChecklist, KansrijkheidAnalyse, ConceptMailEditor,
 *   SessionSidebar, StatusComponents, GevondenDataCards, RawOutputPanel
 */

import { useState, useRef, memo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  FileCheck,
  Upload,
  RefreshCw,
  RotateCcw,
  XCircle,
  FileText,
  Mail,
  Settings as SettingsIcon,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AppHeader } from "@/components/app-header";

// Extracted hooks
import { useBox3Sessions } from "@/hooks/useBox3Sessions";
import { useBox3Validation } from "@/hooks/useBox3Validation";

// Extracted components
import {
  Box3SettingsModal,
  DEFAULT_BOX3_SYSTEM_PROMPT,
  GlobalStatusBadge,
  DocumentChecklist,
  KansrijkheidAnalyse,
  ConceptMailEditor,
  SessionSidebar,
  GevondenDataCards,
  RawOutputPanel,
} from "@/components/box3-validator";

// Utils
import {
  extractBelastingjaar,
  isNewFormat,
  getMailData,
  stripHtmlToPlainText,
} from "@/utils/box3Utils";

// Constants
import {
  STORAGE_KEY_SYSTEM_PROMPT,
  CATEGORY_LABELS,
} from "@/constants/box3.constants";

// Types
import type { PendingFile } from "@/types/box3Validator.types";
import type { Box3ValidationResult } from "@shared/schema";

const Box3Validator = memo(function Box3Validator() {
  // Form state
  const [clientName, setClientName] = useState("");
  const [inputText, setInputText] = useState("");
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Load system prompt from localStorage
  const [systemPrompt, setSystemPrompt] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY_SYSTEM_PROMPT);
      return saved || DEFAULT_BOX3_SYSTEM_PROMPT;
    }
    return DEFAULT_BOX3_SYSTEM_PROMPT;
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // Session management hook
  const { sessions, refetchSessions, loadSession, deleteSession } =
    useBox3Sessions();

  // Validation hook
  const {
    isValidating,
    validationResult,
    currentSessionId,
    editedConceptMail,
    expandedCategories,
    lastUsedPrompt,
    validate,
    revalidate,
    setValidationResult,
    setCurrentSessionId,
    setEditedConceptMail,
    setExpandedCategories,
    handleReset: resetValidation,
  } = useBox3Validation({
    systemPrompt,
    refetchSessions,
  });

  // Handler to update system prompt and save to localStorage
  const handleSystemPromptChange = useCallback((newPrompt: string) => {
    setSystemPrompt(newPrompt);
    localStorage.setItem(STORAGE_KEY_SYSTEM_PROMPT, newPrompt);
  }, []);

  // File handling
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return;

      const newFiles = Array.from(e.target.files).map((file) => ({
        file,
        name: file.name,
      }));

      setPendingFiles((prev) => [...prev, ...newFiles]);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    []
  );

  const handleRemoveFile = useCallback((index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // Validation handlers
  const handleValidate = useCallback(() => {
    validate(clientName, inputText, pendingFiles);
  }, [validate, clientName, inputText, pendingFiles]);

  const handleReset = useCallback(() => {
    setClientName("");
    setInputText("");
    setPendingFiles([]);
    resetValidation();
  }, [resetValidation]);

  // Session handlers
  const handleLoadSession = useCallback(
    async (sessionId: string) => {
      const session = await loadSession(sessionId);
      if (session) {
        setClientName(session.clientName);
        setInputText(session.inputText);
        setPendingFiles([]);
        setValidationResult(session.validationResult as Box3ValidationResult);
        setCurrentSessionId(session.id);

        const conceptMail = session.conceptMail as {
          onderwerp?: string;
          body?: string;
        } | null;
        if (conceptMail) {
          setEditedConceptMail({
            onderwerp: stripHtmlToPlainText(conceptMail.onderwerp || ""),
            body: stripHtmlToPlainText(conceptMail.body || ""),
          });
        } else {
          setEditedConceptMail(null);
        }
        setExpandedCategories(new Set(Object.keys(CATEGORY_LABELS)));
      }
    },
    [
      loadSession,
      setValidationResult,
      setCurrentSessionId,
      setEditedConceptMail,
      setExpandedCategories,
    ]
  );

  const handleDeleteSession = useCallback(
    async (sessionId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!confirm("Weet je zeker dat je deze sessie wilt verwijderen?")) return;

      const success = await deleteSession(sessionId);
      if (success && currentSessionId === sessionId) {
        handleReset();
      }
    },
    [deleteSession, currentSessionId, handleReset]
  );

  // Category toggle
  const toggleCategory = useCallback((key: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, [setExpandedCategories]);

  // Copy mail handler
  const handleCopyMail = useCallback(() => {
    if (!editedConceptMail) return;

    const text = `Onderwerp: ${editedConceptMail.onderwerp}\n\n${editedConceptMail.body}`;
    navigator.clipboard.writeText(text);

    toast({
      title: "Gekopieerd",
      description: "Concept mail is naar het klembord gekopieerd.",
    });
  }, [editedConceptMail, toast]);

  // Derived values
  const belastingjaar = extractBelastingjaar(validationResult);
  const mailData = getMailData(validationResult);
  const showNewFormat = isNewFormat(validationResult);

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
        <div className="flex gap-6">
          {/* Main Content */}
          <div className="flex-1 min-w-0">
            {/* Page Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                <h1 className="text-2xl font-bold tracking-tight">
                  Box 3 Validator
                </h1>
                <p className="text-muted-foreground">
                  Valideer ontvangen documenten en genereer een concept reactie
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSettingsOpen(true)}
              >
                <SettingsIcon className="h-4 w-4 mr-2" />
                Settings
              </Button>
            </div>

            {/* Input Section */}
            <div className="grid gap-6 mb-8">
              {/* Client Name */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Klantnaam</CardTitle>
                </CardHeader>
                <CardContent>
                  <Input
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="Bijv. Jan de Vries"
                  />
                </CardContent>
              </Card>

              {/* Mail Text Input */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Mail className="h-5 w-5 mr-2 text-blue-500" />
                    Mail van klant
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Plak hier de mail tekst van de klant..."
                    className="font-mono text-sm min-h-32"
                  />
                </CardContent>
              </Card>

              {/* File Upload */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Upload className="h-5 w-5 mr-2 text-green-500" />
                    Bijlages ({pendingFiles.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".pdf,.txt"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full"
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Selecteer bestanden (PDF, TXT)
                  </Button>

                  {pendingFiles.length > 0 && (
                    <div className="space-y-2">
                      {pendingFiles.map((pf, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2 bg-muted rounded-md"
                        >
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm truncate">{pf.name}</span>
                            <span className="text-xs text-muted-foreground">
                              ({(pf.file.size / 1024).toFixed(1)} KB)
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRemoveFile(idx)}
                          >
                            <XCircle className="h-4 w-4 text-red-500" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Validate Button */}
              <div className="flex justify-center">
                <Button
                  onClick={handleValidate}
                  disabled={isValidating}
                  size="lg"
                  className="min-w-64"
                >
                  {isValidating ? (
                    <>
                      <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
                      Valideren...
                    </>
                  ) : (
                    <>
                      <FileCheck className="mr-2 h-5 w-5" />
                      Valideer Documenten
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Results Section */}
            {validationResult && (
              <div className="grid gap-6">
                {/* Header Card with Status */}
                <Card
                  className={`border-2 ${
                    validationResult.global_status === "READY_FOR_CALCULATION"
                      ? "border-green-500"
                      : validationResult.global_status?.startsWith("REJECTED")
                        ? "border-red-500"
                        : "border-primary"
                  }`}
                >
                  <CardHeader>
                    <CardTitle className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span>Analyse Resultaat</span>
                        {belastingjaar && (
                          <Badge variant="outline">
                            Belastingjaar {belastingjaar}
                          </Badge>
                        )}
                        {validationResult.global_status && (
                          <GlobalStatusBadge
                            status={validationResult.global_status}
                          />
                        )}
                      </div>
                      <div className="flex gap-2">
                        {currentSessionId && (
                          <Button
                            onClick={revalidate}
                            variant="default"
                            size="sm"
                            disabled={isValidating}
                          >
                            {isValidating ? (
                              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4 mr-2" />
                            )}
                            Opnieuw valideren
                          </Button>
                        )}
                        <Button
                          onClick={handleReset}
                          variant="outline"
                          size="sm"
                        >
                          <RotateCcw className="h-4 w-4 mr-2" />
                          Reset
                        </Button>
                      </div>
                    </CardTitle>
                  </CardHeader>
                </Card>

                {/* Kansrijkheid Analyse */}
                <KansrijkheidAnalyse
                  validationResult={validationResult}
                  belastingjaar={belastingjaar}
                />

                {/* Raw Output Panel */}
                <RawOutputPanel
                  validationResult={validationResult}
                  lastUsedPrompt={lastUsedPrompt}
                  systemPrompt={systemPrompt}
                />

                {/* New Format: Gevonden Data Dashboard */}
                {showNewFormat && validationResult.gevonden_data && (
                  <GevondenDataCards validationResult={validationResult} />
                )}

                {/* Document Checklist */}
                <DocumentChecklist
                  validationResult={validationResult}
                  expandedCategories={expandedCategories}
                  onToggleCategory={toggleCategory}
                />

                {/* Concept Mail Editor */}
                <ConceptMailEditor
                  editedConceptMail={editedConceptMail}
                  mailData={mailData}
                  onEditConceptMail={setEditedConceptMail}
                  onCopyMail={handleCopyMail}
                />
              </div>
            )}
          </div>

          {/* Session Sidebar */}
          <SessionSidebar
            sessions={sessions}
            currentSessionId={currentSessionId}
            onLoadSession={handleLoadSession}
            onDeleteSession={handleDeleteSession}
          />
        </div>
      </div>
    </div>
  );
});

export default Box3Validator;
