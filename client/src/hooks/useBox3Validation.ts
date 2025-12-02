/**
 * useBox3Validation Hook
 *
 * Validation logic for Box 3 Validator.
 * Handles validate and revalidate operations.
 */

import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import type { Box3ValidationResult } from "@shared/schema";
import type { PendingFile, EditedConceptMail } from "@/types/box3Validator.types";
import { stripHtmlToPlainText, getMailData } from "@/utils/box3Utils";
import { CATEGORY_LABELS } from "@/constants/box3.constants";

interface ValidationState {
  isValidating: boolean;
  validationResult: Box3ValidationResult | null;
  currentSessionId: string | null;
  editedConceptMail: EditedConceptMail | null;
  expandedCategories: Set<string>;
  lastUsedPrompt: string | null;
}

interface UseBox3ValidationProps {
  systemPrompt: string;
  refetchSessions: () => void;
}

interface UseBox3ValidationReturn extends ValidationState {
  validate: (
    clientName: string,
    inputText: string,
    pendingFiles: PendingFile[]
  ) => Promise<void>;
  revalidate: () => Promise<void>;
  setValidationResult: (result: Box3ValidationResult | null) => void;
  setCurrentSessionId: (id: string | null) => void;
  setEditedConceptMail: (mail: EditedConceptMail | null) => void;
  setExpandedCategories: React.Dispatch<React.SetStateAction<Set<string>>>;
  handleReset: () => void;
}

export function useBox3Validation({
  systemPrompt,
  refetchSessions,
}: UseBox3ValidationProps): UseBox3ValidationReturn {
  const { toast } = useToast();

  const [isValidating, setIsValidating] = useState(false);
  const [validationResult, setValidationResult] =
    useState<Box3ValidationResult | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [editedConceptMail, setEditedConceptMail] =
    useState<EditedConceptMail | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set()
  );
  const [lastUsedPrompt, setLastUsedPrompt] = useState<string | null>(null);

  // Process validation result and extract concept mail
  const processValidationResult = (result: Box3ValidationResult) => {
    setValidationResult(result);

    const mailData = getMailData(result);
    if (mailData) {
      setEditedConceptMail({
        onderwerp: stripHtmlToPlainText(mailData.onderwerp || ""),
        body: stripHtmlToPlainText(mailData.body || ""),
      });
    }

    // Expand all categories by default
    setExpandedCategories(new Set(Object.keys(CATEGORY_LABELS)));
    setLastUsedPrompt(systemPrompt);
  };

  // Validate new documents
  const validate = async (
    clientName: string,
    inputText: string,
    pendingFiles: PendingFile[]
  ) => {
    if (!clientName.trim()) {
      toast({
        title: "Klantnaam vereist",
        description: "Vul een klantnaam in.",
        variant: "destructive",
      });
      return;
    }

    if (!inputText.trim() && pendingFiles.length === 0) {
      toast({
        title: "Geen input",
        description: "Voer mail tekst in of upload documenten.",
        variant: "destructive",
      });
      return;
    }

    setIsValidating(true);

    try {
      const formData = new FormData();
      formData.append("clientName", clientName.trim());
      formData.append("inputText", inputText.trim() || "(geen mail tekst)");
      formData.append("systemPrompt", systemPrompt);

      for (const pf of pendingFiles) {
        formData.append("files", pf.file);
      }

      const response = await fetch("/api/box3-validator/validate", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const result = data.success ? data.data : data;

      processValidationResult(result.validationResult);
      setCurrentSessionId(result.session?.id || null);

      toast({
        title: "Validatie voltooid",
        description: "De documenten zijn geanalyseerd.",
      });

      refetchSessions();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Validation failed:", error);
      toast({
        title: "Validatie mislukt",
        description: message || "Kon documenten niet valideren.",
        variant: "destructive",
      });
    } finally {
      setIsValidating(false);
    }
  };

  // Revalidate existing session
  const revalidate = async () => {
    if (!currentSessionId) {
      toast({
        title: "Geen sessie",
        description: "Laad eerst een sessie om opnieuw te valideren.",
        variant: "destructive",
      });
      return;
    }

    setIsValidating(true);

    try {
      const response = await fetch(
        `/api/box3-validator/sessions/${currentSessionId}/revalidate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ systemPrompt }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const result = data.success ? data.data : data;

      processValidationResult(result.validationResult);

      toast({
        title: "Opnieuw gevalideerd",
        description:
          "De documenten zijn opnieuw geanalyseerd met de aangepaste prompt.",
      });

      refetchSessions();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Re-validation failed:", error);
      toast({
        title: "Hervalidatie mislukt",
        description: message || "Kon documenten niet opnieuw valideren.",
        variant: "destructive",
      });
    } finally {
      setIsValidating(false);
    }
  };

  // Reset all validation state
  const handleReset = () => {
    setValidationResult(null);
    setCurrentSessionId(null);
    setEditedConceptMail(null);
    setExpandedCategories(new Set());
  };

  return {
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
    handleReset,
  };
}
