import { useState, useEffect, useCallback, useMemo, memo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
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
  Info
} from "lucide-react";
import type { PromptConfigRecord, PromptConfig, AiConfig, StageConfig } from "@shared/schema";

// Available AI models by provider
const AI_MODELS = {
  google: [
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ],
  openai: [
    { value: "gpt-4o", label: "GPT-4o" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini" },
    { value: "o3-mini", label: "o3 Mini (Deep Research)" },
    { value: "o3", label: "o3 (Deep Research)" },
  ],
} as const;

const PROMPT_STAGES = [
  { key: "1_informatiecheck", label: "1. Informatiecheck", description: "Validatie en opslag dossier", type: "generator" },
  { key: "2_complexiteitscheck", label: "2. Complexiteitscheck", description: "Validatie en opslag bouwplan", type: "generator" },
  { key: "3_generatie", label: "3. Generatie", description: "Basis rapport generatie", type: "generator" },
  { key: "4a_BronnenSpecialist", label: "4a. Bronnen Specialist", description: "Review bronnen → JSON feedback", type: "reviewer" },
  { key: "4b_FiscaalTechnischSpecialist", label: "4b. Fiscaal Technisch Specialist", description: "Review fiscale techniek → JSON feedback", type: "reviewer" },
  { key: "4c_ScenarioGatenAnalist", label: "4c. Scenario Gaten Analist", description: "Review scenarios → JSON feedback", type: "reviewer" },
  { key: "4d_DeVertaler", label: "4d. De Vertaler", description: "Review communicatie → JSON feedback", type: "reviewer" },
  { key: "4e_DeAdvocaat", label: "4e. De Advocaat", description: "Review juridisch → JSON feedback", type: "reviewer" },
  { key: "4f_DeKlantpsycholoog", label: "4f. De Klantpsycholoog", description: "Review klant focus → JSON feedback", type: "reviewer" },
  { key: "5_feedback_verwerker", label: "5. Feedback Verwerker", description: "Verwerkt JSON feedback in het rapport", type: "processor" },
  { key: "final_check", label: "Final Check", description: "Laatste controle voor Mathijs", type: "generator" },
] as const;

const Settings = memo(function Settings() {
  const [activeConfig, setActiveConfig] = useState<PromptConfig | null>(null);
  const [aiConfig, setAiConfig] = useState<AiConfig>({
    provider: "google",
    model: "gemini-2.5-pro",
    temperature: 0.1,
    topP: 0.95,
    topK: 20,
    maxOutputTokens: 2048,
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: activePromptConfig, isLoading, refetch } = useQuery<PromptConfigRecord>({
    queryKey: ["/api/prompts/active"],
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  });

  const updatePromptMutation = useMutation({
    mutationFn: async (data: { id: string; config: PromptConfig }) => {
      const response = await apiRequest("PUT", `/api/prompts/${data.id}`, {
        config: data.config,
        isActive: true,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/prompts"] });
      toast({
        title: "Configuratie opgeslagen",
        description: "Prompt configuratie is succesvol bijgewerkt.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Fout bij opslaan",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (activePromptConfig?.config) {
      const config = activePromptConfig.config as PromptConfig;
      setActiveConfig(config);
      if (config.aiConfig) {
        setAiConfig(config.aiConfig);
      }
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

  const handleStageAiConfigChange = useCallback((stageKey: string, aiConfigKey: keyof AiConfig, value: any) => {
    if (!activeConfig) return;
    
    const currentStageConfig = activeConfig[stageKey as keyof Omit<PromptConfig, 'aiConfig'>] as StageConfig;
    const currentAiConfig = currentStageConfig?.aiConfig || {
      provider: "google",
      model: "gemini-2.5-pro",
      temperature: 0.1,
      topP: 0.95,
      topK: 20,
      maxOutputTokens: 2048,
    };
    
    setActiveConfig({
      ...activeConfig,
      [stageKey]: {
        ...currentStageConfig,
        aiConfig: {
          ...currentAiConfig,
          [aiConfigKey]: value,
        },
      },
    });
  }, [activeConfig]);

  const handleSave = useCallback(async () => {
    if (!activeConfig) return;
    
    // Refetch to ensure we have the latest ID
    const result = await refetch();
    const latestConfig = result.data;
    
    if (!latestConfig?.id) {
      toast({
        title: "Geen actieve configuratie gevonden",
        description: "Vernieuw de pagina en probeer opnieuw.",
        variant: "destructive",
      });
      return;
    }
    
    const configWithAi = {
      ...activeConfig,
      aiConfig,
    };
    
    updatePromptMutation.mutate({
      id: latestConfig.id,
      config: configWithAi,
    });
  }, [activeConfig, aiConfig, updatePromptMutation, refetch, toast]);

  const handleAiConfigChange = useCallback((key: keyof AiConfig, value: any) => {
    setAiConfig(prev => ({
      ...prev,
      [key]: value,
    }));
  }, []);

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
      
      {/* Header */}
      <header className="border-b border-border bg-card shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <SettingsIcon className="text-2xl text-primary mr-3 h-8 w-8" />
                <span className="text-xl font-bold text-foreground">Instellingen</span>
              </div>
              <nav className="hidden md:ml-10 md:flex md:space-x-8">
                <a href="/" className="text-muted-foreground hover:text-foreground" data-testid="nav-pipeline">
                  Pipeline
                </a>
                <a href="/cases" className="text-muted-foreground hover:text-foreground" data-testid="nav-cases">
                  Cases
                </a>
                <a href="/settings" className="text-primary font-medium" data-testid="nav-settings">
                  Instellingen
                </a>
              </nav>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground">
                Prompt Configuratie
              </h1>
              <p className="text-muted-foreground mt-2">
                Configureer de 11-stappen prompting workflow voor fiscale rapportgeneratie
              </p>
            </div>
            
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <div className="text-2xl font-bold text-foreground">
                  {stats.completed}/{stats.total}
                </div>
                <div className="text-xs text-muted-foreground">Prompts Ingesteld</div>
              </div>
              
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
          
          {/* Progress indicator */}
          <div className="mt-4">
            <div className="w-full bg-muted rounded-full h-2">
              <div 
                className="bg-primary h-2 rounded-full transition-all duration-300"
                style={{ width: `${(stats.completed / stats.total) * 100}%` }}
              ></div>
            </div>
          </div>
        </div>

        {/* Prompt Stages */}
        <div className="grid gap-6">
          {PROMPT_STAGES.map((stage, index) => {
            const stageConfig = activeConfig?.[stage.key as keyof Omit<PromptConfig, 'aiConfig'>] as StageConfig;
            const prompt = stageConfig?.prompt || "";
            const useGrounding = stageConfig?.useGrounding || false;
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

                    {/* Per-Stage AI Configuration */}
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-4">
                      <div className="flex items-center space-x-2 mb-3">
                        <Brain className="h-4 w-4 text-blue-600" />
                        <Label className="text-sm font-medium text-blue-900">AI Model voor deze stap</Label>
                        <Badge variant="outline" className="text-xs">Overschrijft global default</Badge>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-4">
                        {/* Provider Selection per Stage */}
                        <div className="space-y-2">
                          <Label className="text-xs font-medium">AI Provider</Label>
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
                          <Label className="text-xs font-medium">Model</Label>
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
                      
                      {/* Special indicators for specific models */}
                      {(stageConfig?.aiConfig?.model || aiConfig.model).includes('o3') && (
                        <div className="text-xs text-blue-700 bg-blue-100 p-2 rounded">
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
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Creativiteit (Temperature)</Label>
                <span className="text-sm text-muted-foreground">{aiConfig.temperature}</span>
              </div>
              <Slider
                value={[aiConfig.temperature]}
                onValueChange={([value]) => handleAiConfigChange("temperature", value)}
                min={0}
                max={2}
                step={0.1}
                className="w-full"
                data-testid="slider-temperature"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Precies (0)</span>
                <span>Gebalanceerd (1)</span>
                <span>Creatief (2)</span>
              </div>
            </div>

            {/* Top P */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Focus (Top P)</Label>
                <span className="text-sm text-muted-foreground">{aiConfig.topP}</span>
              </div>
              <Slider
                value={[aiConfig.topP]}
                onValueChange={([value]) => handleAiConfigChange("topP", value)}
                min={0.1}
                max={1}
                step={0.05}
                className="w-full"
                data-testid="slider-topP"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Gefocust (0.1)</span>
                <span>Gevarieerd (1.0)</span>
              </div>
            </div>

            {/* Max Output Tokens */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Max Output Tokens</Label>
                <span className="text-sm text-muted-foreground">{aiConfig.maxOutputTokens}</span>
              </div>
              <Slider
                value={[aiConfig.maxOutputTokens]}
                onValueChange={([value]) => handleAiConfigChange("maxOutputTokens", value)}
                min={500}
                max={8192}
                step={256}
                className="w-full"
                data-testid="slider-max-tokens"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Kort (500)</span>
                <span>Uitgebreid (8192)</span>
              </div>
            </div>

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