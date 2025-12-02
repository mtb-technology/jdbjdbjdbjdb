import { useState, useEffect, useCallback, useMemo, memo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Settings as SettingsIcon,
  Save,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Workflow,
  Brain,
  Zap,
  Search,
  Download,
  Upload,
} from "lucide-react";
import { AppHeader } from "@/components/app-header";
import type { PromptConfigRecord, PromptConfig, AiConfig, StageConfig } from "@shared/schema";

// Available AI models by provider - MUST match server/config/index.ts AI_MODELS
const AI_MODELS = {
  google: [
    { value: "gemini-3-pro-preview", label: "🧠 Gemini 3 Pro (Nieuwste - Advanced Reasoning)" },
    { value: "gemini-2.5-pro", label: "🌟 Gemini 2.5 Pro (Beste kwaliteit)" },
    { value: "gemini-2.5-flash", label: "⚡ Gemini 2.5 Flash (Snelste)" },
    { value: "gemini-2.5-pro-deep-research", label: "🔬 Gemini 2.5 Pro Deep Research (Diepgaande analyse)" },
  ],
  openai: [
    { value: "gpt-5", label: "🚀 GPT-5 (Nieuwste - Responses API)" },
    { value: "gpt-4o", label: "GPT-4o (Beste kwaliteit)" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini (Snel & Efficiënt)" },
    { value: "o3-mini", label: "o3-mini (Reasoning)" },
    { value: "o3", label: "o3 (Advanced Reasoning)" },
    { value: "o3-deep-research-2025-06-26", label: "o3 Deep Research (Deep Analysis)" },
    { value: "o4-mini-deep-research-2025-06-26", label: "o4-mini Deep Research (Fast Deep Analysis)" },
  ],
} as const;

const PROMPT_STAGES = [
  { key: "1_informatiecheck", label: "1. Informatiecheck", description: "Validatie en opslag dossier", type: "generator" },
  { key: "2_complexiteitscheck", label: "2. Complexiteitscheck", description: "Validatie en opslag bouwplan", type: "generator" },
  { key: "3_generatie", label: "3. Generatie", description: "Basis rapport generatie", type: "generator" },
  { key: "4a_BronnenSpecialist", label: "4a. Bronnen Specialist", description: "Review bronnen → JSON feedback", type: "reviewer" },
  { key: "4b_FiscaalTechnischSpecialist", label: "4b. Fiscaal Technisch Specialist", description: "Review fiscale techniek → JSON feedback", type: "reviewer" },
  { key: "4c_ScenarioGatenAnalist", label: "4c. Scenario Gaten Analist", description: "Review scenarios → JSON feedback", type: "reviewer" },
  { key: "4e_DeAdvocaat", label: "4e. De Advocaat", description: "Review juridisch → JSON feedback", type: "reviewer" },
  { key: "4f_HoofdCommunicatie", label: "4f. Hoofd Communicatie", description: "Review communicatie en klantgerichtheid → JSON feedback", type: "reviewer" },
  { key: "editor", label: "Editor (Chirurgische Redacteur)", description: "Past wijzigingen van reviewers toe op rapport", type: "editor" },
] as const;

const Settings = memo(function Settings() {
  const [activeConfig, setActiveConfig] = useState<PromptConfig | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [aiConfig, setAiConfig] = useState<AiConfig>({
    provider: "google",
    model: "gemini-2.5-pro",
    temperature: 0.1,
    topP: 0.95,
    topK: 20,
    maxOutputTokens: 8192,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const originalConfig = useRef<PromptConfig | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Track unsaved changes
  useEffect(() => {
    if (!originalConfig.current || !activeConfig) return;
    const hasChanges = JSON.stringify(originalConfig.current) !== JSON.stringify(activeConfig);
    setHasUnsavedChanges(hasChanges);

    // Warn before leaving with unsaved changes
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [activeConfig]);

  const { data: activePromptConfig, isLoading, refetch } = useQuery<PromptConfigRecord>({
    queryKey: ["/api/prompts/active"],
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });

  const updatePromptMutation = useMutation({
    mutationFn: async (data: { id: string; config: PromptConfig }) => {
      try {
        const response = await apiRequest("PUT", `/api/prompts/${data.id}`, {
          config: data.config,
          isActive: true,
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const responseData = await response.json();
        
        // Validate response structure
        if (!responseData || typeof responseData !== 'object') {
          throw new Error('Invalid response format');
        }

        if ('error' in responseData) {
          throw new Error(responseData.error?.message || 'Failed to update settings');
        }

        if ('success' in responseData && responseData.success === true) {
          return responseData.data;
        }

        return responseData;
      } catch (error: any) {
        console.error('Settings update failed:', error);
        throw new Error(error.message || 'Failed to update settings');
      }
    },
    onMutate: async (newData) => {
      // Cancel any outgoing refetches 
      await queryClient.cancelQueries({ queryKey: ["/api/prompts/active"] });
      await queryClient.cancelQueries({ queryKey: ["/api/prompts"] });

      // Snapshot previous values
      const previousData = queryClient.getQueryData(["/api/prompts/active"]);

      // Optimistically update
      queryClient.setQueryData(["/api/prompts/active"], (old: any) => ({
        ...old,
        [newData.id]: newData.config
      }));

      return { previousData };
    },
    onError: (err, newData, context: any) => {
      // Rollback on error
      if (context?.previousData) {
        queryClient.setQueryData(["/api/prompts/active"], context.previousData);
      }
      
      toast({
        title: "Instellingen niet opgeslagen",
        description: err.message || "Er ging iets mis bij het opslaan van de instellingen",
        variant: "destructive",
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/prompts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/prompts/active"] });
      toast({
        title: "Configuratie opgeslagen",
        description: "Prompt configuratie is succesvol bijgewerkt.",
      });
    },
    retry: 2, // Retry failed mutations twice
    retryDelay: 1000 // Wait 1 second between retries
  });

  useEffect(() => {
    if (activePromptConfig?.config) {
      const config = activePromptConfig.config as PromptConfig;
      setActiveConfig(config);
      originalConfig.current = config; // Store original for change detection
      if (config.aiConfig) {
        setAiConfig(config.aiConfig);
      }
      setHasUnsavedChanges(false); // Reset unsaved changes flag
    }
  }, [activePromptConfig]);


  const handlePromptChange = useCallback((stageKey: string, value: string) => {
    if (!activeConfig) return;
    
    const currentStageConfig = activeConfig[stageKey as keyof Omit<PromptConfig, 'aiConfig'>] as StageConfig;
    
    setActiveConfig({
      ...activeConfig,
      [stageKey]: {
        ...currentStageConfig,
        prompt: value,
      },
    });
  }, [activeConfig]);

  const handleGroundingChange = useCallback((stageKey: string, useGrounding: boolean) => {
    if (!activeConfig) return;
    
    const currentStageConfig = activeConfig[stageKey as keyof Omit<PromptConfig, 'aiConfig'>] as StageConfig;
    
    setActiveConfig({
      ...activeConfig,
      [stageKey]: {
        ...currentStageConfig,
        useGrounding,
      },
    });
  }, [activeConfig]);

  const handleWebSearchChange = useCallback((stageKey: string, useWebSearch: boolean) => {
    if (!activeConfig) return;
    
    const currentStageConfig = activeConfig[stageKey as keyof Omit<PromptConfig, 'aiConfig'>] as StageConfig;
    
    setActiveConfig({
      ...activeConfig,
      [stageKey]: {
        ...currentStageConfig,
        useWebSearch,
      },
    });
  }, [activeConfig]);

  const handleStepTypeChange = useCallback((stageKey: string, stepType: "generator" | "reviewer") => {
    if (!activeConfig) return;
    
    const currentStageConfig = activeConfig[stageKey as keyof Omit<PromptConfig, 'aiConfig'>] as StageConfig;
    
    setActiveConfig({
      ...activeConfig,
      [stageKey]: {
        ...currentStageConfig,
        stepType,
      },
    });
  }, [activeConfig]);

  const handleVerwerkerPromptChange = useCallback((stageKey: string, verwerkerPrompt: string) => {
    if (!activeConfig) return;

    const currentStageConfig = activeConfig[stageKey as keyof Omit<PromptConfig, 'aiConfig'>] as StageConfig;

    setActiveConfig({
      ...activeConfig,
      [stageKey]: {
        ...currentStageConfig,
        verwerkerPrompt,
      },
    });
  }, [activeConfig]);

  const handlePolishPromptChange = useCallback((stageKey: string, polishPrompt: string) => {
    if (!activeConfig) return;

    const currentStageConfig = activeConfig[stageKey as keyof Omit<PromptConfig, 'aiConfig'>] as StageConfig;

    setActiveConfig({
      ...activeConfig,
      [stageKey]: {
        ...currentStageConfig,
        polishPrompt,
      },
    });
  }, [activeConfig]);

  const handleStageAiConfigChange = useCallback((stageKey: string, aiConfigKey: keyof AiConfig, value: any) => {
    if (!activeConfig) return;

    const currentStageConfig = activeConfig[stageKey as keyof Omit<PromptConfig, 'aiConfig'>] as StageConfig;
    const currentAiConfig = currentStageConfig?.aiConfig || {
      provider: "google",
      model: "gemini-2.5-pro",
      temperature: 0.1,
      topP: 0.95,
      topK: 20,
      maxOutputTokens: 8192,
    };

    const updates: Partial<AiConfig> = { [aiConfigKey]: value };

    // Auto-adjust parameters for Gemini 3 Pro
    if (aiConfigKey === 'model' && value === 'gemini-3-pro-preview') {
      updates.temperature = 1.0; // Gemini 3 optimized for temperature 1.0
      updates.thinkingLevel = currentAiConfig.thinkingLevel || 'high'; // Default thinking level
    }

    setActiveConfig({
      ...activeConfig,
      [stageKey]: {
        ...currentStageConfig,
        aiConfig: {
          ...currentAiConfig,
          ...updates,
        },
      },
    });
  }, [activeConfig]);

  // Special handler for nested OpenAI parameters
  const handleStageOpenAIParamsChange = useCallback((stageKey: string, paramType: 'reasoning' | 'verbosity', value: any) => {
    if (!activeConfig) return;
    
    const currentStageConfig = activeConfig[stageKey as keyof Omit<PromptConfig, 'aiConfig'>] as StageConfig;
    const currentAiConfig = currentStageConfig?.aiConfig || {
      provider: "google",
      model: "gemini-2.5-pro",
      temperature: 0.1,
      topP: 0.95,
      topK: 20,
      maxOutputTokens: 8192,
    };
    
    if (paramType === 'reasoning') {
      setActiveConfig({
        ...activeConfig,
        [stageKey]: {
          ...currentStageConfig,
          aiConfig: {
            ...currentAiConfig,
            reasoning: {
              effort: value,
            },
          },
        },
      });
    } else if (paramType === 'verbosity') {
      setActiveConfig({
        ...activeConfig,
        [stageKey]: {
          ...currentStageConfig,
          aiConfig: {
            ...currentAiConfig,
            verbosity: value,
          },
        },
      });
    }
  }, [activeConfig]);

  const handleSave = useCallback(async () => {
    if (!activeConfig || !activePromptConfig?.id) {
      toast({
        title: "Kan niet opslaan",
        description: "Er is geen actieve configuratie om op te slaan",
        variant: "destructive",
      });
      return;
    }
    
    try {
      // Add loading state
      toast({
        title: "Bezig met opslaan...",
        description: "Even geduld terwijl we je instellingen opslaan",
      });
      
      // Make sure we have the latest data before saving
      const currentConfig = queryClient.getQueryData(["/api/prompts/active"]);
      if (!currentConfig) {
        await queryClient.fetchQuery({ queryKey: ["/api/prompts/active"] });
      }
      
      // Save with optimistic updates and error handling
      await updatePromptMutation.mutateAsync({
        id: activePromptConfig.id,
        config: {
          ...activeConfig,
          aiConfig: aiConfig // Make sure we save the current AI config
        },
      });

    } catch (error: any) {
      console.error('Save failed:', error);
      // Error is already handled by mutation error handler
    }
  }, [activeConfig, updatePromptMutation, activePromptConfig?.id, aiConfig, queryClient, toast]);

  const handleBackup = async () => {
    try {
      // Sla eerst huidige wijzigingen op
      await handleSave();
      
      const response = await fetch('/api/prompts/backup');
      const responseData = await response.json();
      // Handle new API response format
      const data = responseData && typeof responseData === 'object' && 'success' in responseData && responseData.success === true ? responseData.data : responseData;
      
      // Download als JSON file
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `prompts-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      
      toast({
        title: "JSON geëxporteerd",
        description: "Prompt configuraties zijn geëxporteerd als JSON bestand. Upload dit bestand in productie om de configuraties te synchroniseren.",
      });
    } catch (error) {
      console.error('Backup failed:', error);
      toast({
        title: "Export mislukt",
        description: "Kon JSON bestand niet exporteren",
        variant: "destructive",
      });
    }
  };

  const handleRestore = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    try {
      const text = await file.text();
      let data;
      
      // First, try to parse JSON with specific error handling
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        toast({
          title: "Ongeldig JSON bestand",
          description: "Het bestand bevat geen geldige JSON data. Upload een geldig export bestand.",
          variant: "destructive",
        });
        return;
      }
      
      // Basic client-side validation
      const isValidFormat = (data: any) => {
        // Check if it's an array or has prompt_configs array (both supported formats)
        if (Array.isArray(data)) return data.length > 0;
        if (data && Array.isArray(data.prompt_configs)) return data.prompt_configs.length > 0;
        return false;
      };
      
      if (!isValidFormat(data)) {
        toast({
          title: "Ongeldig JSON bestand",
          description: "Het bestand bevat geen geldige prompt configuraties. Upload een geldig export bestand.",
          variant: "destructive",
        });
        return;
      }
      
      const response = await apiRequest('POST', '/api/prompts/restore', data);
      const responseData = await response.json();
      // Handle new API response format
      const result = responseData && typeof responseData === 'object' && 'success' in responseData && responseData.success === true ? responseData.data : responseData;
      
      toast({
        title: "Import geslaagd",
        description: result.message || "Prompt configuraties zijn geïmporteerd uit JSON bestand",
      });
      
      // Refresh de data
      queryClient.invalidateQueries({ queryKey: ["/api/prompts/active"] });
      refetch();
    } catch (error: any) {
      console.error('Restore failed:', error);
      toast({
        title: "Import mislukt",
        description: "Kon JSON bestand niet importeren. Controleer of het bestand geldig is.",
        variant: "destructive",
      });
    }
    
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };


  const handleAiConfigChange = useCallback((key: keyof AiConfig, value: any) => {
    setAiConfig(prev => {
      const updates: Partial<AiConfig> = { [key]: value };

      // Auto-adjust parameters for Gemini 3 Pro
      if (key === 'model' && value === 'gemini-3-pro-preview') {
        updates.temperature = 1.0; // Gemini 3 optimized for temperature 1.0
        updates.thinkingLevel = prev.thinkingLevel || 'high'; // Default thinking level

        toast({
          title: "Parameters aangepast voor Gemini 3 Pro",
          description: "Temperature automatisch ingesteld op 1.0 (aanbevolen voor optimale prestaties)",
        });
      }

      return {
        ...prev,
        ...updates,
      };
    });
  }, [toast]);

  const isPromptEmpty = useCallback((prompt: string) => {
    return !prompt || prompt.trim() === "" || prompt.startsWith("PLACEHOLDER:");
  }, []);

  const getCompletionStats = useMemo(() => {
    if (!activeConfig) return { completed: 0, total: PROMPT_STAGES.length };
    
    const completed = PROMPT_STAGES.filter(stage => {
      const stageConfig = activeConfig[stage.key as keyof Omit<PromptConfig, 'aiConfig'>] as StageConfig;
      return !isPromptEmpty(stageConfig?.prompt || "");
    }).length;
    
    return { completed, total: PROMPT_STAGES.length };
  }, [activeConfig, isPromptEmpty]);

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
            <h1 className="text-2xl font-bold tracking-tight">Prompt Configuratie</h1>
            <p className="text-muted-foreground">Configureer de workflow prompts voor fiscale rapportgeneratie</p>
          </div>
            
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <div className="text-2xl font-bold text-foreground">
                  {stats.completed}/{stats.total}
                </div>
                <div className="text-xs text-muted-foreground">Prompts Ingesteld</div>
              </div>
              
              <div className="flex gap-2">
                <Button 
                  onClick={handleBackup}
                  variant="outline"
                  size="sm"
                  data-testid="button-export-json"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export JSON
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleRestore}
                  className="hidden"
                  data-testid="input-import-file"
                />
                <Button 
                  onClick={() => fileInputRef.current?.click()}
                  variant="outline"
                  size="sm"
                  data-testid="button-import-json"
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Import JSON
                </Button>
                <Button 
                  onClick={handleSave}
                  disabled={updatePromptMutation.isPending}
                  data-testid="button-save-config"
                >
                  <Save className="mr-2 h-4 w-4" />
                  {updatePromptMutation.isPending ? "Opslaan..." : "Opslaan"}
                </Button>
              </div>
            </div>
        </div>

        {/* Prompt Stages */}
        <div className="grid gap-6">
          {PROMPT_STAGES.map((stage, index) => {
            const stageConfig = activeConfig?.[stage.key as keyof Omit<PromptConfig, 'aiConfig'>] as StageConfig;
            const prompt = stageConfig?.prompt || "";
            const useGrounding = stageConfig?.useGrounding || false;
            const useWebSearch = stageConfig?.useWebSearch || false;
            const stepType = stageConfig?.stepType || stage.type || "generator";
            const isEmpty = isPromptEmpty(prompt);
            const isReviewer = stepType === "reviewer";
            const isProcessor = stepType === "processor";
            
            return (
              <Card key={stage.key} className={`shadow-sm ${
                isReviewer ? 'border-l-4 border-l-orange-400' : 
                isProcessor ? 'border-l-4 border-l-purple-400' : 
                'border-l-4 border-l-blue-400'
              }`}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        isEmpty ? 'bg-muted text-muted-foreground' : 
                        isReviewer ? 'bg-orange-500 text-white' : 
                        isProcessor ? 'bg-purple-500 text-white' :
                        'bg-blue-500 text-white'
                      }`}>
                        {isEmpty ? (
                          <AlertCircle className="h-4 w-4" />
                        ) : (
                          <CheckCircle className="h-4 w-4" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center space-x-2">
                          <CardTitle className="text-lg">{stage.label}</CardTitle>
                          <Badge variant={isReviewer ? "destructive" : isProcessor ? "secondary" : "default"} className="text-xs">
                            {isReviewer ? "🔍 Review" : isProcessor ? "⚙️ Processor" : "📝 Generator"}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{stage.description}</p>
                      </div>
                    </div>
                    
                    <Badge variant={isEmpty ? "secondary" : "default"}>
                      {isEmpty ? "Niet Ingesteld" : "Actief"}
                    </Badge>
                  </div>
                </CardHeader>
                
                <CardContent>
                  <div className="space-y-4">
                    
                    {/* Step Type Indicator */}
                    {isReviewer && (
                      <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4">
                        <div className="flex items-center space-x-2 mb-2">
                          <span className="text-orange-700 font-medium text-sm">🔍 Review Stap</span>
                        </div>
                        <p className="text-xs text-orange-700">
                          Deze stap geeft <strong>JSON feedback</strong> op het rapport. Stap 5 (Verwerker) verwerkt alle feedback automatisch.
                        </p>
                      </div>
                    )}
                    
                    {/* Processor Type Indicator */}
                    {isProcessor && (
                      <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-4">
                        <div className="flex items-center space-x-2 mb-2">
                          <span className="text-purple-700 font-medium text-sm">⚙️ Processor Stap</span>
                        </div>
                        <p className="text-xs text-purple-700">
                          Deze stap verwerkt <strong>alle JSON feedback</strong> van stap 4a-4g en past het rapport aan.
                        </p>
                      </div>
                    )}
                    
                    {/* Grounding Toggle per Stage - Only for Google provider */}
                    {(stageConfig?.aiConfig?.provider || aiConfig.provider) === "google" && (
                      <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                        <div className="space-y-1">
                          <Label className="text-sm font-medium flex items-center">
                            <Search className="mr-2 h-4 w-4" />
                            Google Search Grounding voor deze stap
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Zoekt actuele informatie online tijdens deze prompt stap
                          </p>
                        </div>
                        <Switch
                          checked={useGrounding}
                          onCheckedChange={(checked) => handleGroundingChange(stage.key, checked)}
                          data-testid={`switch-grounding-${stage.key}`}
                        />
                      </div>
                    )}

                    {/* Web Search Toggle per Stage - Only for OpenAI provider */}
                    {(stageConfig?.aiConfig?.provider || aiConfig.provider) === "openai" && (
                      <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
                        <div className="space-y-1">
                          <Label className="text-sm font-medium flex items-center">
                            <Search className="mr-2 h-4 w-4" />
                            Web Search voor deze stap
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            Gebruikt web search voor actuele informatie tijdens deze prompt stap
                          </p>
                        </div>
                        <Switch
                          checked={useWebSearch}
                          onCheckedChange={(checked) => handleWebSearchChange(stage.key, checked)}
                          data-testid={`switch-websearch-${stage.key}`}
                        />
                      </div>
                    )}

                    {/* Per-Stage AI Configuration */}
                    <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-4">
                      <div className="flex items-center space-x-2 mb-3">
                        <Brain className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        <Label className="text-sm font-medium text-blue-900 dark:text-blue-100">AI Model voor deze stap</Label>
                        <Badge variant="outline" className="text-xs">Overschrijft global default</Badge>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Provider Selection per Stage */}
                        <div className="space-y-2">
                          <Label className="text-xs font-medium text-blue-900 dark:text-blue-100">AI Provider</Label>
                          <Select
                            value={stageConfig?.aiConfig?.provider || aiConfig.provider}
                            onValueChange={(value: "google" | "openai") => {
                              if (!activeConfig) return;
                              
                              const defaultModel = value === "google" ? "gemini-2.5-pro" : "gpt-4o";
                              const currentStageConfig = activeConfig[stage.key as keyof Omit<PromptConfig, 'aiConfig'>] as StageConfig;
                              const currentAiConfig = currentStageConfig?.aiConfig || {
                                provider: aiConfig.provider,
                                model: aiConfig.model,
                                temperature: aiConfig.temperature,
                                topP: aiConfig.topP,
                                topK: aiConfig.topK,
                                maxOutputTokens: aiConfig.maxOutputTokens,
                              };
                              
                              setActiveConfig({
                                ...activeConfig,
                                [stage.key]: {
                                  ...currentStageConfig,
                                  useGrounding: value === "google" ? (currentStageConfig?.useGrounding || false) : false,
                                  useWebSearch: value === "openai" ? (currentStageConfig?.useWebSearch || false) : false,
                                  aiConfig: {
                                    ...currentAiConfig,
                                    provider: value,
                                    model: defaultModel,
                                  },
                                },
                              });
                            }}
                            data-testid={`select-stage-provider-${stage.key}`}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Kies provider" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="google">
                                <div className="flex items-center space-x-2">
                                  <Brain className="h-3 w-3" />
                                  <span>Google AI</span>
                                </div>
                              </SelectItem>
                              <SelectItem value="openai">
                                <div className="flex items-center space-x-2">
                                  <Zap className="h-3 w-3" />
                                  <span>OpenAI</span>
                                </div>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        
                        {/* Model Selection per Stage */}
                        <div className="space-y-2">
                          <Label className="text-xs font-medium text-blue-900 dark:text-blue-100">Model</Label>
                          <Select
                            value={stageConfig?.aiConfig?.model || aiConfig.model}
                            onValueChange={(value) => handleStageAiConfigChange(stage.key, "model", value)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="Kies model" />
                            </SelectTrigger>
                            <SelectContent>
                              {AI_MODELS[stageConfig?.aiConfig?.provider || aiConfig.provider] && 
                               AI_MODELS[stageConfig?.aiConfig?.provider || aiConfig.provider].map((model) => (
                                <SelectItem key={model.value} value={model.value}>
                                  <span className="text-xs">{model.label}</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      
                      {/* Google-specific parameters */}
                      {(stageConfig?.aiConfig?.provider || aiConfig.provider) === "google" && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                          <div className="col-span-2">
                            <Label className="text-xs font-medium text-blue-900 dark:text-blue-100 mb-2 flex items-center">
                              <Brain className="h-3 w-3 mr-1" />
                              Google AI Specifieke Parameters
                            </Label>
                          </div>

                          {/* Temperature */}
                          <div className="space-y-2">
                            <Label className="text-xs font-medium text-blue-900 dark:text-blue-100">Temperature</Label>
                            <Input
                              type="number"
                              step="0.1"
                              min="0"
                              max="2"
                              value={stageConfig?.aiConfig?.temperature ?? aiConfig.temperature}
                              onChange={(e) => handleStageAiConfigChange(stage.key, "temperature", parseFloat(e.target.value) || 0)}
                              className="h-8 text-xs"
                              placeholder="0.0 - 2.0"
                              data-testid={`input-temperature-${stage.key}`}
                            />
                            <p className="text-xs text-blue-700 dark:text-blue-300">0 = precies, 1 = gebalanceerd, 2 = creatief</p>
                          </div>

                          {/* Max Output Tokens */}
                          <div className="space-y-2">
                            <Label className="text-xs font-medium text-blue-900 dark:text-blue-100">Max Output Tokens</Label>
                            <Input
                              type="number"
                              step="256"
                              min="100"
                              max="8192"
                              value={stageConfig?.aiConfig?.maxOutputTokens ?? aiConfig.maxOutputTokens}
                              onChange={(e) => handleStageAiConfigChange(stage.key, "maxOutputTokens", parseInt(e.target.value) || 8192)}
                              className="h-8 text-xs"
                              placeholder="100 - 8192"
                              data-testid={`input-max-tokens-${stage.key}`}
                            />
                            <p className="text-xs text-blue-700 dark:text-blue-300">Maximaal aantal tokens in de response</p>
                          </div>

                          {/* Top P */}
                          <div className="space-y-2">
                            <Label className="text-xs font-medium text-blue-900 dark:text-blue-100">Top P</Label>
                            <Input
                              type="number"
                              step="0.05"
                              min="0.1"
                              max="1"
                              value={stageConfig?.aiConfig?.topP ?? aiConfig.topP}
                              onChange={(e) => handleStageAiConfigChange(stage.key, "topP", parseFloat(e.target.value) || 0.95)}
                              className="h-8 text-xs"
                              placeholder="0.1 - 1.0"
                              data-testid={`input-topP-${stage.key}`}
                            />
                            <p className="text-xs text-blue-700 dark:text-blue-300">0.1 = gefocust, 1.0 = gevarieerd</p>
                          </div>

                          {/* Top K */}
                          <div className="space-y-2">
                            <Label className="text-xs font-medium text-blue-900 dark:text-blue-100">Top K</Label>
                            <Input
                              type="number"
                              step="1"
                              min="1"
                              max="40"
                              value={stageConfig?.aiConfig?.topK ?? aiConfig.topK}
                              onChange={(e) => handleStageAiConfigChange(stage.key, "topK", parseInt(e.target.value) || 20)}
                              className="h-8 text-xs"
                              placeholder="1 - 40"
                              data-testid={`input-topK-${stage.key}`}
                            />
                            <p className="text-xs text-blue-700 dark:text-blue-300">Aantal top kandidaten voor sampling</p>
                          </div>

                          {/* Thinking Level - Gemini 3 only */}
                          {(stageConfig?.aiConfig?.model || aiConfig.model) === 'gemini-3-pro-preview' && (
                            <div className="space-y-2 col-span-2">
                              <Label className="text-xs font-medium text-blue-900 dark:text-blue-100">Thinking Level (Gemini 3)</Label>
                              <Select
                                value={stageConfig?.aiConfig?.thinkingLevel || aiConfig.thinkingLevel || 'high'}
                                onValueChange={(value) => handleStageAiConfigChange(stage.key, "thinkingLevel", value)}
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="high">
                                    <div className="flex flex-col">
                                      <span className="font-medium">High - Maximale Reasoning</span>
                                      <span className="text-xs text-muted-foreground">Voor complexe taken (langzamer, dieper denken)</span>
                                    </div>
                                  </SelectItem>
                                  <SelectItem value="low">
                                    <div className="flex flex-col">
                                      <span className="font-medium">Low - Minimale Latency</span>
                                      <span className="text-xs text-muted-foreground">Voor simpele taken (sneller, minder denken)</span>
                                    </div>
                                  </SelectItem>
                                </SelectContent>
                              </Select>
                              <p className="text-xs text-blue-700 dark:text-blue-300">Controleert diepte van reasoning proces</p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* OpenAI-specific parameters */}
                      {(stageConfig?.aiConfig?.provider || aiConfig.provider) === "openai" && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 p-3 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded-lg">
                          <div className="col-span-2">
                            <Label className="text-xs font-medium text-orange-900 dark:text-orange-100 mb-2 flex items-center">
                              <Zap className="h-3 w-3 mr-1" />
                              OpenAI Specifieke Parameters
                            </Label>
                          </div>

                          {/* Temperature */}
                          <div className="space-y-2">
                            <Label className="text-xs font-medium text-orange-900 dark:text-orange-100">Temperature</Label>
                            <Input
                              type="number"
                              step="0.1"
                              min="0"
                              max="2"
                              value={stageConfig?.aiConfig?.temperature ?? aiConfig.temperature}
                              onChange={(e) => handleStageAiConfigChange(stage.key, "temperature", parseFloat(e.target.value) || 0)}
                              className="h-8 text-xs"
                              placeholder="0.0 - 2.0"
                              data-testid={`input-temperature-${stage.key}`}
                            />
                            <p className="text-xs text-orange-700 dark:text-orange-300">0 = precies, 1 = gebalanceerd, 2 = creatief</p>
                          </div>

                          {/* Max Output Tokens */}
                          <div className="space-y-2">
                            <Label className="text-xs font-medium text-orange-900 dark:text-orange-100">Max Output Tokens</Label>
                            <Input
                              type="number"
                              step="256"
                              min="100"
                              max="8192"
                              value={stageConfig?.aiConfig?.maxOutputTokens ?? aiConfig.maxOutputTokens}
                              onChange={(e) => handleStageAiConfigChange(stage.key, "maxOutputTokens", parseInt(e.target.value) || 8192)}
                              className="h-8 text-xs"
                              placeholder="100 - 8192"
                              data-testid={`input-max-tokens-${stage.key}`}
                            />
                            <p className="text-xs text-orange-700 dark:text-orange-300">Maximaal aantal tokens in de response</p>
                          </div>

                          {/* Reasoning Effort */}
                          <div className="space-y-2">
                            <Label className="text-xs font-medium text-orange-900 dark:text-orange-100">Reasoning Effort</Label>
                            <Select
                              value={stageConfig?.aiConfig?.reasoning?.effort ?? "medium"}
                              onValueChange={(value) => handleStageOpenAIParamsChange(stage.key, "reasoning", value)}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="minimal">Minimal (Snelst, GPT-4o-mini)</SelectItem>
                                <SelectItem value="low">Low (Snel)</SelectItem>
                                <SelectItem value="medium">Medium (Balans)</SelectItem>
                                <SelectItem value="high">High (Diep)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Verbosity */}
                          <div className="space-y-2">
                            <Label className="text-xs font-medium text-orange-900 dark:text-orange-100">Verbosity</Label>
                            <Select
                              value={stageConfig?.aiConfig?.verbosity ?? "medium"}
                              onValueChange={(value) => handleStageOpenAIParamsChange(stage.key, "verbosity", value)}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="low">Low (Beknopt)</SelectItem>
                                <SelectItem value="medium">Medium (Standaard)</SelectItem>
                                <SelectItem value="high">High (Uitgebreid)</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}

                      {/* Special indicators for specific models */}
                      {(stageConfig?.aiConfig?.model || aiConfig.model).includes('o3') && (
                        <div className="text-xs text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-950/20 p-2 rounded">
                          🧠 <strong>Deep Research Mode:</strong> o3 gebruikt geavanceerde redenering voor complexe analyses
                        </div>
                      )}
                    </div>

                    {/* Main Prompt */}
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">
                        {isReviewer ? "Review Prompt (→ JSON feedback)" :
                         isProcessor ? "Processor Prompt (JSON feedback → Rapport update)" :
                         "Generator Prompt (→ Rapport content)"}
                      </Label>
                      <Textarea
                        value={prompt}
                        onChange={(e) => handlePromptChange(stage.key, e.target.value)}
                        className="font-mono text-sm min-h-32"
                        placeholder={isReviewer ?
                          `Review prompt die JSON feedback geeft voor ${stage.label}...` :
                          isProcessor ?
                          `Processor prompt die alle JSON feedback verwerkt in het rapport...` :
                          `Generator prompt voor ${stage.label}...`
                        }
                        data-testid={`textarea-prompt-${stage.key}`}
                      />
                    </div>

                    {/* Polish Prompt - Only for Stage 3 (Generatie) with Deep Research */}
                    {stage.key === "3_generatie" && (
                      <div className="space-y-2 mt-4">
                        <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-lg p-4">
                          <div className="flex items-center space-x-2 mb-3">
                            <span className="text-lg">✨</span>
                            <Label className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
                              Polish Instructies (Deep Research)
                            </Label>
                            <Badge variant="outline" className="text-xs bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300">
                              Automatisch toegepast
                            </Badge>
                          </div>
                          <p className="text-xs text-emerald-700 dark:text-emerald-300 mb-3">
                            Deze instructies worden automatisch toegepast in de laatste fase van deep research om het rapport te polijsten (schrijfstijl, nummering, volledigheid).
                          </p>
                          <Textarea
                            value={stageConfig?.polishPrompt || ''}
                            onChange={(e) => handlePolishPromptChange(stage.key, e.target.value)}
                            className="font-mono text-sm min-h-40 bg-white dark:bg-gray-900"
                            placeholder={`POLIJST INSTRUCTIES (pas dit toe op het eindrapport):

1. SCHRIJFSTIJL
   - Gebruik consequent WIJ-vorm of objectieve schrijfstijl
   - Vermijd IK-vorm volledig
   - Professioneel en zakelijk taalgebruik

2. STRUCTUUR
   - Nummer alle hoofdstukken: 1. / 1.1 / 1.1.1
   - Volg exact de structuur uit de originele prompt
   - Zorg voor logische volgorde en flow

3. VOLLEDIGHEID
   - Controleer kritisch of elke sectie voldoende diepgang heeft
   - Breid waar nodig uit met extra toelichting en onderbouwing
   - Voeg concrete voorbeelden toe waar relevant

4. KWALITEITSCONTROLE
   - Verwijder herhalingen en redundante tekst
   - Zorg voor consistente terminologie
   - Controleer op spelling en grammatica`}
                            data-testid={`textarea-polish-prompt-${stage.key}`}
                          />
                        </div>
                      </div>
                    )}

                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* AI Configuration */}
        <Card className="mt-8">
          <CardHeader>
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <Brain className="h-4 w-4 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">AI Model Configuratie (Global Default)</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Configureer standaard AI provider en model instellingen. Elke stap kan deze overschrijven.
                </p>
              </div>
            </div>
          </CardHeader>
          
          <CardContent className="space-y-6">
            
            {/* Provider Selection */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">AI Provider</Label>
              <Select 
                value={aiConfig.provider} 
                onValueChange={(value: "google" | "openai") => {
                  const defaultModel = value === "google" ? "gemini-2.5-pro" : "gpt-4o";
                  handleAiConfigChange("provider", value);
                  handleAiConfigChange("model", defaultModel);
                }}
              >
                <SelectTrigger data-testid="select-ai-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="google">
                    <div className="flex items-center space-x-2">
                      <Brain className="h-4 w-4" />
                      <div>
                        <div className="font-medium">Google AI (Gemini)</div>
                        <div className="text-xs text-muted-foreground">Grounding & Research</div>
                      </div>
                    </div>
                  </SelectItem>
                  <SelectItem value="openai">
                    <div className="flex items-center space-x-2">
                      <Zap className="h-4 w-4" />
                      <div>
                        <div className="font-medium">OpenAI (GPT/o3)</div>
                        <div className="text-xs text-muted-foreground">Deep Research & Reasoning</div>
                      </div>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            {/* Model Selection */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Model Selectie</Label>
              <Select 
                value={aiConfig.model} 
                onValueChange={(value) => handleAiConfigChange("model", value)}
              >
                <SelectTrigger data-testid="select-ai-model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {aiConfig.provider && AI_MODELS[aiConfig.provider] && AI_MODELS[aiConfig.provider].map((model) => (
                    <SelectItem key={model.value} value={model.value}>
                      <div className="flex items-center space-x-2">
                        <Brain className="h-4 w-4" />
                        <div>
                          <div className="font-medium">{model.label}</div>
                          <div className="text-xs text-muted-foreground">
                            {model.value.includes('o3') ? 'Deep Research & Reasoning' : 
                             model.value.includes('flash') ? 'Snelle verwerking, lagere kosten' :
                             'Beste kwaliteit, uitgebreide redenering'}
                          </div>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Temperature */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Creativiteit (Temperature)</Label>
              <Input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={aiConfig.temperature}
                onChange={(e) => handleAiConfigChange("temperature", parseFloat(e.target.value) || 0)}
                placeholder="0.0 - 2.0"
                data-testid="input-temperature"
              />
              <p className="text-xs text-muted-foreground">0 = precies, 1 = gebalanceerd, 2 = creatief</p>
            </div>

            {/* Top P */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Focus (Top P)</Label>
              <Input
                type="number"
                step="0.05"
                min="0.1"
                max="1"
                value={aiConfig.topP}
                onChange={(e) => handleAiConfigChange("topP", parseFloat(e.target.value) || 0.95)}
                placeholder="0.1 - 1.0"
                data-testid="input-topP"
              />
              <p className="text-xs text-muted-foreground">0.1 = gefocust, 1.0 = gevarieerd</p>
            </div>

            {/* Max Output Tokens */}
            <div className="space-y-3">
              <Label className="text-sm font-medium">Max Output Tokens</Label>
              <Input
                type="number"
                step="256"
                min="100"
                max="8192"
                value={aiConfig.maxOutputTokens}
                onChange={(e) => handleAiConfigChange("maxOutputTokens", parseInt(e.target.value) || 2048)}
                placeholder="100 - 8192"
                data-testid="input-max-tokens"
              />
              <p className="text-xs text-muted-foreground">Maximaal aantal tokens in de response</p>
            </div>

            {/* Top K (Google models only) */}
            {aiConfig.provider === "google" && (
              <div className="space-y-3">
                <Label className="text-sm font-medium">Top K (Google modellen)</Label>
                <Input
                  type="number"
                  step="1"
                  min="1"
                  max="40"
                  value={aiConfig.topK}
                  onChange={(e) => handleAiConfigChange("topK", parseInt(e.target.value) || 20)}
                  placeholder="1 - 40"
                  data-testid="input-topK"
                />
                <p className="text-xs text-muted-foreground">Aantal top kandidaten voor sampling (alleen Google AI)</p>
              </div>
            )}

            {/* Thinking Level (Gemini 3 only) */}
            {aiConfig.provider === "google" && aiConfig.model === 'gemini-3-pro-preview' && (
              <div className="space-y-3">
                <Label className="text-sm font-medium">Thinking Level (Gemini 3)</Label>
                <Select
                  value={aiConfig.thinkingLevel || 'high'}
                  onValueChange={(value) => handleAiConfigChange("thinkingLevel", value)}
                >
                  <SelectTrigger data-testid="select-thinking-level">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">
                      <div className="flex flex-col">
                        <span className="font-medium">High - Maximale Reasoning</span>
                        <span className="text-xs text-muted-foreground">Voor complexe taken (langzamer, dieper denken)</span>
                      </div>
                    </SelectItem>
                    <SelectItem value="low">
                      <div className="flex flex-col">
                        <span className="font-medium">Low - Minimale Latency</span>
                        <span className="text-xs text-muted-foreground">Voor simpele taken (sneller, minder denken)</span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Controleert diepte van reasoning proces (alleen Gemini 3 Pro)</p>
              </div>
            )}

            {/* Deep Research Info */}
            <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <Search className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5" />
                <div>
                  <h4 className="font-medium text-green-900 dark:text-green-100 mb-1">
                    Per-Stage Research Grounding 
                  </h4>
                  <p className="text-sm text-green-700 dark:text-green-300">
                    Google Search grounding is nu per prompt stap instelbaar. 
                    Elke stap heeft een eigen toggle voor research functionaliteit.
                  </p>
                </div>
              </div>
            </div>

          </CardContent>
        </Card>

        {/* Footer Info */}
        <Card className="mt-8 bg-muted/50">
          <CardContent className="p-6">
            <div className="flex items-start space-x-3">
              <Workflow className="h-5 w-5 text-primary mt-1" />
              <div>
                <h3 className="font-semibold text-foreground mb-2">Workflow Overzicht</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  De 11-stappen workflow verwerkt elk rapport sequentieel door gespecialiseerde AI rollen. 
                  Elke stap bouwt voort op de resultaten van de vorige stap, wat zorgt voor een gelaagde 
                  en grondige analyse. Configureer alle prompts om de volledige functionaliteit te benutten.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        
      </div>
    </div>
  );
});

export default Settings;