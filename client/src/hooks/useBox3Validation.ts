/**
 * useBox3Validation Hook - V2
 *
 * Validation logic for Box 3 Validator.
 * Uses the new V2 Blueprint data model.
 */

import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import type { Box3Blueprint } from "@shared/schema";
import type { PendingFile } from "@/types/box3Validator.types";
import type { Box3DossierFull } from "./useBox3Sessions";
import { BOX3_CONSTANTS } from "@shared/constants";

// Debug info from API response
interface DebugInfo {
  fullPrompt?: string;
  rawAiResponse?: string;
  model?: string;
  modelUsed?: string; // Legacy alias for model
  timestamp?: string;
  pipelineSteps?: any;
  pipelineErrors?: string[];
}

interface ValidationState {
  isValidating: boolean;
  blueprint: Box3Blueprint | null;
  currentDossierId: string | null;
  blueprintVersion: number;
  taxYears: string[];
  debugInfo: DebugInfo | null;
}

interface UseBox3ValidationProps {
  refetchSessions: () => void;
}

interface UseBox3ValidationReturn extends ValidationState {
  validate: (
    clientName: string,
    inputText: string,
    pendingFiles: PendingFile[]
  ) => Promise<Box3DossierFull | null>;
  revalidate: (dossierId: string) => Promise<Box3Blueprint | null>;
  setBlueprint: (blueprint: Box3Blueprint | null) => void;
  setCurrentDossierId: (id: string | null) => void;
  handleReset: () => void;
  loadFromDossier: (dossierFull: Box3DossierFull) => void;
}

export function useBox3Validation({
  refetchSessions,
}: UseBox3ValidationProps): UseBox3ValidationReturn {
  const { toast } = useToast();

  const [isValidating, setIsValidating] = useState(false);
  const [blueprint, setBlueprint] = useState<Box3Blueprint | null>(null);
  const [currentDossierId, setCurrentDossierId] = useState<string | null>(null);
  const [blueprintVersion, setBlueprintVersion] = useState(0);
  const [taxYears, setTaxYears] = useState<string[]>([]);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);

  // Load state from a loaded dossier
  const loadFromDossier = (dossierFull: Box3DossierFull) => {
    setBlueprint(dossierFull.blueprint);
    setCurrentDossierId(dossierFull.dossier.id);
    setBlueprintVersion(dossierFull.blueprintVersion);
    setTaxYears(dossierFull.dossier.taxYears || []);
  };

  // Validate new documents - creates a new dossier
  const validate = async (
    clientName: string,
    inputText: string,
    pendingFiles: PendingFile[]
  ): Promise<Box3DossierFull | null> => {
    if (!clientName.trim()) {
      toast({
        title: "Klantnaam vereist",
        description: "Vul een klantnaam in.",
        variant: "destructive",
      });
      return null;
    }

    if (!inputText.trim() && pendingFiles.length === 0) {
      toast({
        title: "Geen input",
        description: "Voer mail tekst in of upload documenten.",
        variant: "destructive",
      });
      return null;
    }

    // ✅ Client-side file size validation
    const oversizedFiles = pendingFiles.filter(pf => pf.file.size > BOX3_CONSTANTS.MAX_FILE_SIZE_BYTES);
    if (oversizedFiles.length > 0) {
      const names = oversizedFiles
        .map(f => `${f.name} (${(f.file.size / 1024 / 1024).toFixed(1)}MB)`)
        .join(', ');
      toast({
        title: "Bestand(en) te groot",
        description: `Maximum grootte is ${BOX3_CONSTANTS.MAX_FILE_SIZE_MB}MB per bestand. Geweigerd: ${names}`,
        variant: "destructive",
      });
      return null;
    }

    setIsValidating(true);

    try {
      const formData = new FormData();
      formData.append("clientName", clientName.trim());
      formData.append("inputText", inputText.trim() || "(geen mail tekst)");

      for (const pf of pendingFiles) {
        formData.append("files", pf.file, pf.name);
      }

      // Timeout for AI processing with multiple images
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), BOX3_CONSTANTS.AI_TIMEOUT_MS);

      let response;
      try {
        response = await fetch("/api/box3-validator/validate", {
          method: "POST",
          body: formData,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const result = data.success ? data.data : data;

      // Validate response BEFORE updating state
      if (!result.dossier?.id) {
        throw new Error("Server gaf geen dossier terug");
      }

      // Now safe to update state
      setBlueprint(result.blueprint);
      setCurrentDossierId(result.dossier.id);
      setBlueprintVersion(result.blueprintVersion || 1);
      setTaxYears(result.taxYears || []);

      // Store debug info
      if (result._debug) {
        setDebugInfo(result._debug);
        localStorage.setItem('box3_last_debug_info', JSON.stringify(result._debug));
      }

      toast({
        title: "Validatie voltooid",
        description: `Dossier aangemaakt met ${result.taxYears?.length || 0} belastingjaar(en).`,
      });

      refetchSessions();

      // Return full dossier data for navigation (including documents with classification)
      return {
        dossier: result.dossier,
        blueprint: result.blueprint,
        blueprintVersion: result.blueprintVersion || 1,
        documents: result.documents || [],
      };
    } catch (error: unknown) {
      let message = "Kon documenten niet valideren.";
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          message = "Verzoek duurde te lang (timeout na 5 minuten). Probeer met minder bestanden.";
        } else {
          message = error.message;
        }
      }
      toast({
        title: "Validatie mislukt",
        description: message,
        variant: "destructive",
      });
      return null;
    } finally {
      setIsValidating(false);
    }
  };

  // Revalidate existing dossier
  const revalidate = async (dossierId: string): Promise<Box3Blueprint | null> => {
    if (!dossierId) {
      toast({
        title: "Geen dossier",
        description: "Laad eerst een dossier om opnieuw te valideren.",
        variant: "destructive",
      });
      return null;
    }

    setIsValidating(true);

    try {
      // Timeout for AI processing
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), BOX3_CONSTANTS.AI_TIMEOUT_MS);

      let response;
      try {
        response = await fetch(
          `/api/box3-validator/dossiers/${dossierId}/revalidate`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({}),
            signal: controller.signal,
          }
        );
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const result = data.success ? data.data : data;

      // Update state with V2 response
      setBlueprint(result.blueprint);
      setBlueprintVersion(result.blueprintVersion || 1);
      setTaxYears(result.taxYears || []);

      // Store debug info
      if (result._debug) {
        setDebugInfo(result._debug);
        localStorage.setItem('box3_last_debug_info', JSON.stringify(result._debug));
      }

      toast({
        title: "Opnieuw gevalideerd",
        description: `Blueprint v${result.blueprintVersion} aangemaakt.`,
      });

      refetchSessions();
      return result.blueprint;
    } catch (error: unknown) {
      let message = "Kon dossier niet opnieuw valideren.";
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          message = "Verzoek duurde te lang (timeout na 5 minuten). Probeer met minder bestanden.";
        } else {
          message = error.message;
        }
      }
      toast({
        title: "Hervalidatie mislukt",
        description: message,
        variant: "destructive",
      });
      return null;
    } finally {
      setIsValidating(false);
    }
  };

  // Reset all validation state
  const handleReset = () => {
    setBlueprint(null);
    setCurrentDossierId(null);
    setBlueprintVersion(0);
    setTaxYears([]);
    setDebugInfo(null);
  };

  return {
    isValidating,
    blueprint,
    currentDossierId,
    blueprintVersion,
    taxYears,
    debugInfo,
    validate,
    revalidate,
    setBlueprint,
    setCurrentDossierId,
    handleReset,
    loadFromDossier,
  };
}

// Export DebugInfo type for use in components
export type { DebugInfo };
