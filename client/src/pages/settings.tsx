/**
 * Settings Page
 *
 * Refactored from 1,277 lines to ~200 lines following Clean Code and SOLID principles.
 *
 * Changes:
 * - Extracted 6 duplicate handlers into usePromptConfig hook
 * - Extracted AI config handlers into useAiConfigHandlers hook
 * - Extracted mutation logic into usePromptConfigMutation hook
 * - Extracted backup/restore into usePromptBackup hook
 * - Extracted 476-line stage map into StageConfigCard component
 * - Extracted global AI config into GlobalAiConfigCard component
 * - Consolidated constants and types into separate files
 */

import { useState, useEffect, memo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings as SettingsIcon, RefreshCw } from "lucide-react";
import { AppHeader } from "@/components/app-header";

// Types and constants
import type { PromptConfig, AiConfig, StageConfig, PromptConfigRecord } from "@shared/schema";
import type { StageKey } from "@/types/settings.types";
import { PROMPT_STAGES, DEFAULT_AI_CONFIG } from "@/constants/settings.constants";

// Custom hooks
import { usePromptConfig } from "@/hooks/usePromptConfig";
import { useAiConfigHandlers } from "@/hooks/useAiConfigHandlers";
import { usePromptConfigMutation } from "@/hooks/usePromptConfigMutation";
import { usePromptBackup } from "@/hooks/usePromptBackup";

// Components
import {
  StageConfigCard,
  GlobalAiConfigCard,
  PipelineHeader,
  WorkflowInfoCard,
} from "@/components/settings";

type StageConfigKey = keyof Omit<PromptConfig, "aiConfig">;

const Settings = memo(function Settings() {
  // State
  const [activeConfig, setActiveConfig] = useState<PromptConfig | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [aiConfig, setAiConfig] = useState<AiConfig>(DEFAULT_AI_CONFIG);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const originalConfig = useRef<PromptConfig | null>(null);

  // Query
  const { data: activePromptConfig, isLoading, refetch } = useQuery<PromptConfigRecord>({
    queryKey: ["/api/prompts/active"],
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
  });

  // Custom hooks
  const { handleStageConfigChange, isPromptEmpty, getCompletionStats } = usePromptConfig(
    activeConfig,
    setActiveConfig
  );

  const {
    handleStageAiConfigChange,
    handleStageOpenAIParamsChange,
    handleStageProviderChange,
    handleGlobalAiConfigChange,
  } = useAiConfigHandlers(activeConfig, setActiveConfig, aiConfig, setAiConfig);

  const { mutation, handleSave, isSaving } = usePromptConfigMutation(
    activeConfig,
    aiConfig,
    activePromptConfig?.id
  );

  const { handleBackup, handleRestore } = usePromptBackup(handleSave, fileInputRef, refetch);

  // Track unsaved changes
  useEffect(() => {
    if (!originalConfig.current || !activeConfig) return;
    const hasChanges = JSON.stringify(originalConfig.current) !== JSON.stringify(activeConfig);
    setHasUnsavedChanges(hasChanges);

    // Warn before leaving with unsaved changes
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [activeConfig]);

  // Sync config from server
  useEffect(() => {
    if (activePromptConfig?.config) {
      const config = activePromptConfig.config as PromptConfig;
      setActiveConfig(config);
      originalConfig.current = config;
      if (config.aiConfig) {
        setAiConfig(config.aiConfig);
      }
      setHasUnsavedChanges(false);
    }
  }, [activePromptConfig]);

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex items-center justify-center h-64">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </div>
      </div>
    );
  }

  const stats = getCompletionStats;

  return (
    <div className="min-h-screen bg-background">
      <AppHeader />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Instellingen</h1>
            <p className="text-muted-foreground">Beheer alle configuraties en instellingen</p>
          </div>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="pipeline" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 lg:w-[400px]">
            <TabsTrigger value="general" data-testid="tab-general">
              Algemeen
            </TabsTrigger>
            <TabsTrigger value="pipeline" data-testid="tab-pipeline">
              Rapport Pipeline
            </TabsTrigger>
          </TabsList>

          {/* Tab: Algemeen */}
          <TabsContent value="general" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Algemene Instellingen</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <SettingsIcon className="h-12 w-12 text-muted-foreground/50 mb-4" />
                  <h3 className="text-lg font-medium text-muted-foreground mb-2">Komt Binnenkort</h3>
                  <p className="text-sm text-muted-foreground max-w-md">
                    Hier komen toekomstige algemene instellingen zoals notificaties, gebruikersvoorkeuren en meer.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Tab: Rapport Pipeline */}
          <TabsContent value="pipeline" className="space-y-6">
            <PipelineHeader
              stats={stats}
              isSaving={isSaving}
              hasUnsavedChanges={hasUnsavedChanges}
              onSave={handleSave}
              onBackup={handleBackup}
              onRestoreClick={() => fileInputRef.current?.click()}
              fileInputRef={fileInputRef}
              onRestore={handleRestore}
            />

            {/* Prompt Stages */}
            <div className="grid gap-6">
              {PROMPT_STAGES.map((stage) => {
                const stageConfig = activeConfig?.[stage.key as StageConfigKey] as StageConfig;
                const isEmpty = isPromptEmpty(stageConfig?.prompt || "");

                return (
                  <StageConfigCard
                    key={stage.key}
                    stage={stage}
                    stageConfig={stageConfig}
                    globalAiConfig={aiConfig}
                    isEmpty={isEmpty}
                    onPromptChange={(value) => handleStageConfigChange(stage.key as StageKey, "prompt", value)}
                    onGroundingChange={(value) =>
                      handleStageConfigChange(stage.key as StageKey, "useGrounding", value)
                    }
                    onWebSearchChange={(value) =>
                      handleStageConfigChange(stage.key as StageKey, "useWebSearch", value)
                    }
                    onPolishPromptChange={(value) =>
                      handleStageConfigChange(stage.key as StageKey, "polishPrompt", value)
                    }
                    onStageAiConfigChange={(key, value) =>
                      handleStageAiConfigChange(stage.key as StageKey, key, value)
                    }
                    onStageOpenAIParamsChange={(paramType, value) =>
                      handleStageOpenAIParamsChange(stage.key as StageKey, paramType, value)
                    }
                    onProviderChange={(value) => handleStageProviderChange(stage.key as StageKey, value)}
                  />
                );
              })}
            </div>

            <GlobalAiConfigCard aiConfig={aiConfig} onAiConfigChange={handleGlobalAiConfigChange} />

            <WorkflowInfoCard />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
});

export default Settings;
