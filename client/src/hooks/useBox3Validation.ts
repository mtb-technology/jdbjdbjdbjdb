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

// Debug info from API response
interface DebugInfo {
  fullPrompt: string;
  rawAiResponse: string;
  modelUsed: string;
  timestamp: string;
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
  systemPrompt: string;
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
  systemPrompt,
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

    if (!systemPrompt.trim()) {
      toast({
        title: "Geen prompt",
        description: "Configureer eerst een intake prompt in de instellingen.",
        variant: "destructive",
      });
      return null;
    }

    setIsValidating(true);

    try {
      const formData = new FormData();
      formData.append("clientName", clientName.trim());
      formData.append("inputText", inputText.trim() || "(geen mail tekst)");
      formData.append("systemPrompt", systemPrompt);

      for (const pf of pendingFiles) {
        formData.append("files", pf.file, pf.name);
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

      // Update state with V2 response
      setBlueprint(result.blueprint);
      setCurrentDossierId(result.dossier?.id || null);
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

      // Return full dossier data for navigation
      return {
        dossier: result.dossier,
        blueprint: result.blueprint,
        blueprintVersion: result.blueprintVersion || 1,
        documents: [], // Documents are in the dossier, fetch separately if needed
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Validation failed:", error);
      toast({
        title: "Validatie mislukt",
        description: message || "Kon documenten niet valideren.",
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

    if (!systemPrompt.trim()) {
      toast({
        title: "Geen prompt",
        description: "Configureer eerst een intake prompt in de instellingen.",
        variant: "destructive",
      });
      return null;
    }

    setIsValidating(true);

    try {
      const response = await fetch(
        `/api/box3-validator/dossiers/${dossierId}/revalidate`,
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
      const message = error instanceof Error ? error.message : "Unknown error";
      console.error("Re-validation failed:", error);
      toast({
        title: "Hervalidatie mislukt",
        description: message || "Kon dossier niet opnieuw valideren.",
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
