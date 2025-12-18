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

import { useState, useEffect, memo, useRef, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/lib/queryKeys";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Save, RefreshCw } from "lucide-react";
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
  ToolAiConfigCard,
  TOOL_CONFIGS,
  Box3SettingsCard,
  type Box3Config,
} from "@/components/settings";

type StageConfigKey = keyof Omit<PromptConfig, "aiConfig">;

const Settings = memo(function Settings() {
  // Get initial tab from URL query parameter
  const [location] = useLocation();
  const initialTab = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("tab") || "pipeline";
  }, []);

  // State
  const [activeConfig, setActiveConfig] = useState<PromptConfig | null>(null);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [aiConfig, setAiConfig] = useState<AiConfig>(DEFAULT_AI_CONFIG);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const originalConfig = useRef<PromptConfig | null>(null);

  // Query
  const { data: activePromptConfig, isLoading, refetch } = useQuery<PromptConfigRecord>({
    queryKey: QUERY_KEYS.prompts.active(),
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

  // Sync config from server + migrate localStorage Box3 prompts if needed
  useEffect(() => {
    if (activePromptConfig?.config) {
      const config = activePromptConfig.config as PromptConfig;

      // Migrate Box3 prompts from localStorage if box3Config is empty
      const configWithMigration = { ...config };
      if (!config.box3Config?.emailPrompt) {
        try {
          const savedPrompts = localStorage.getItem("box3-validator-prompts");
          if (savedPrompts) {
            const parsed = JSON.parse(savedPrompts);
            if (parsed.email) {
              configWithMigration.box3Config = {
                ...configWithMigration.box3Config,
                emailPrompt: parsed.email,
              };
              // Clear localStorage after migration to prevent re-migration
              localStorage.removeItem("box3-validator-prompts");
              console.log("📦 Migrated Box3 email prompt from localStorage to settings");
            }
          }
        } catch {
          // Ignore parse errors
        }
      }

      setActiveConfig(configWithMigration);
      originalConfig.current = configWithMigration;
      if (configWithMigration.aiConfig) {
        setAiConfig(configWithMigration.aiConfig);
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
        <Tabs defaultValue={initialTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 lg:w-[500px]">
            <TabsTrigger value="general" data-testid="tab-general">
              Algemeen
            </TabsTrigger>
            <TabsTrigger value="pipeline" data-testid="tab-pipeline">
              Rapport Pipeline
            </TabsTrigger>
            <TabsTrigger value="box3" data-testid="tab-box3">
              Box 3
            </TabsTrigger>
          </TabsList>

          {/* Tab: Algemeen - Tool AI Configuraties */}
          <TabsContent value="general" className="space-y-6">
            {/* Header with save button */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Tool AI Configuraties</h2>
                <p className="text-sm text-muted-foreground">
                  Configureer AI settings per tool. Als een tool geen eigen configuratie heeft, wordt de globale default gebruikt.
                </p>
              </div>
              <Button
                onClick={handleSave}
                disabled={isSaving}
                data-testid="button-save-general"
              >
                <Save className="mr-2 h-4 w-4" />
                {isSaving ? "Opslaan..." : "Opslaan"}
              </Button>
            </div>

            {/* Tool Config Cards */}
            <div className="grid gap-6">
              {TOOL_CONFIGS.map((tool) => (
                <ToolAiConfigCard
                  key={tool.key}
                  toolKey={tool.key}
                  title={tool.title}
                  description={tool.description}
                  icon={tool.icon}
                  aiConfig={(activeConfig as any)?.[tool.key]}
                  globalAiConfig={aiConfig}
                  onAiConfigChange={(toolKey, field, value) => {
                    if (!activeConfig) return;
                    setActiveConfig({
                      ...activeConfig,
                      [toolKey]: {
                        ...((activeConfig as any)[toolKey] || {}),
                        aiConfig: {
                          ...(((activeConfig as any)[toolKey] as any)?.aiConfig || aiConfig),
                          [field]: value,
                        },
                      },
                    });
                  }}
                />
              ))}
            </div>

            {/* Global Default (read-only reference) */}
            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Globale Default Configuratie
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Deze configuratie wordt gebruikt als fallback. Wijzig in de "Rapport Pipeline" tab.
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Provider:</span>
                    <span className="ml-2 font-medium">{aiConfig.provider}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Model:</span>
                    <span className="ml-2 font-medium">{aiConfig.model}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Temperature:</span>
                    <span className="ml-2 font-medium">{aiConfig.temperature}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Max Tokens:</span>
                    <span className="ml-2 font-medium">{aiConfig.maxOutputTokens}</span>
                  </div>
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

          {/* Tab: Box 3 */}
          <TabsContent value="box3" className="space-y-6">
            {/* Header with save button */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">Box 3 Validator Instellingen</h2>
                <p className="text-sm text-muted-foreground">
                  Configureer de e-mail prompt en bekijk de forfaitaire rendementen referentie.
                </p>
              </div>
              <Button
                onClick={handleSave}
                disabled={isSaving}
                data-testid="button-save-box3"
              >
                <Save className="mr-2 h-4 w-4" />
                {isSaving ? "Opslaan..." : "Opslaan"}
              </Button>
            </div>

            <Box3SettingsCard
              config={(activeConfig as any)?.box3Config as Box3Config | undefined}
              onConfigChange={(field, value) => {
                if (!activeConfig) return;
                setActiveConfig({
                  ...activeConfig,
                  box3Config: {
                    ...((activeConfig as any).box3Config || {}),
                    [field]: value,
                  },
                });
              }}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
});

export default Settings;
