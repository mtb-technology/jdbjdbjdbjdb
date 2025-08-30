import { useState, useEffect } from "react";
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
  Search
} from "lucide-react";
import type { PromptConfigRecord, PromptConfig, AiConfig } from "@shared/schema";

const PROMPT_STAGES = [
  { key: "1_informatiecheck", label: "1. Informatiecheck", description: "Validatie en opslag dossier" },
  { key: "2_complexiteitscheck", label: "2. Complexiteitscheck", description: "Validatie en opslag bouwplan" },
  { key: "3_generatie", label: "3. Generatie", description: "Basis rapport generatie" },
  { key: "4a_BronnenSpecialist", label: "4a. Bronnen Specialist", description: "Bronverwerking in rapport" },
  { key: "4b_FiscaalTechnischSpecialist", label: "4b. Fiscaal Technisch Specialist", description: "Technische fiscale expertise" },
  { key: "4c_ScenarioGatenAnalist", label: "4c. Scenario Gaten Analist", description: "Scenario analyse en gaps" },
  { key: "4d_DeVertaler", label: "4d. De Vertaler", description: "Taal en communicatie optimalisatie" },
  { key: "4e_DeAdvocaat", label: "4e. De Advocaat", description: "Juridische compliance check" },
  { key: "4f_DeKlantpsycholoog", label: "4f. De Klantpsycholoog", description: "Klantgerichte communicatie" },
  { key: "4g_ChefEindredactie", label: "4g. Chef Eindredactie", description: "Finale redactionele controle" },
  { key: "final_check", label: "Final Check", description: "Laatste controle voor Mathijs" },
] as const;

export default function Settings() {
  const [activeConfig, setActiveConfig] = useState<PromptConfig | null>(null);
  const [aiConfig, setAiConfig] = useState<AiConfig>({
    model: "gemini-2.5-pro",
    temperature: 0.1,
    topP: 0.95,
    topK: 20,
    maxOutputTokens: 2048,
    useGrounding: true,
  });
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: activePromptConfig, isLoading } = useQuery<PromptConfigRecord>({
    queryKey: ["/api/prompts/active"],
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

  const handlePromptChange = (stageKey: string, value: string) => {
    if (!activeConfig) return;
    
    setActiveConfig({
      ...activeConfig,
      [stageKey]: value,
    });
  };

  const handleSave = () => {
    if (!activeConfig || !activePromptConfig?.id) return;
    
    const configWithAi = {
      ...activeConfig,
      aiConfig,
    };
    
    updatePromptMutation.mutate({
      id: activePromptConfig.id,
      config: configWithAi,
    });
  };

  const handleAiConfigChange = (key: keyof AiConfig, value: any) => {
    setAiConfig(prev => ({
      ...prev,
      [key]: value,
    }));
  };

  const isPromptEmpty = (prompt: string) => {
    return !prompt || prompt.trim() === "" || prompt.startsWith("PLACEHOLDER:");
  };

  const getCompletionStats = () => {
    if (!activeConfig) return { completed: 0, total: PROMPT_STAGES.length };
    
    const completed = PROMPT_STAGES.filter(stage => 
      !isPromptEmpty(activeConfig[stage.key as keyof PromptConfig] as string)
    ).length;
    
    return { completed, total: PROMPT_STAGES.length };
  };

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

  const stats = getCompletionStats();

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground flex items-center">
                <SettingsIcon className="mr-3 h-8 w-8 text-primary" />
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
            const prompt = (activeConfig?.[stage.key as keyof PromptConfig] as string) || "";
            const isEmpty = isPromptEmpty(prompt);
            
            return (
              <Card key={stage.key} className="shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        isEmpty ? 'bg-muted text-muted-foreground' : 'bg-primary text-primary-foreground'
                      }`}>
                        {isEmpty ? (
                          <AlertCircle className="h-4 w-4" />
                        ) : (
                          <CheckCircle className="h-4 w-4" />
                        )}
                      </div>
                      <div>
                        <CardTitle className="text-lg">{stage.label}</CardTitle>
                        <p className="text-sm text-muted-foreground">{stage.description}</p>
                      </div>
                    </div>
                    
                    <Badge variant={isEmpty ? "secondary" : "default"}>
                      {isEmpty ? "Niet Ingesteld" : "Actief"}
                    </Badge>
                  </div>
                </CardHeader>
                
                <CardContent>
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">
                      Prompt Template (gebruik {"{{variabele}}"} voor vervangingen)
                    </Label>
                    <Textarea
                      value={prompt}
                      onChange={(e) => handlePromptChange(stage.key, e.target.value)}
                      className="font-mono text-sm min-h-32"
                      placeholder={`Voer hier de ${stage.label} prompt in...\n\nBeschikbare variabelen:\n- ${"{{datum}}"} - Huidige datum\n- ${"{{dossier}}"} - Klant dossier JSON\n- ${"{{bouwplan}}"} - Rapport structuur JSON\n- ${"{{rapport}}"} - Vorige stage resultaat (vanaf stage 4)`}
                      data-testid={`textarea-prompt-${stage.key}`}
                    />
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
                <CardTitle className="text-lg">AI Model Configuratie</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Configureer Gemini model instellingen voor optimale prestaties
                </p>
              </div>
            </div>
          </CardHeader>
          
          <CardContent className="space-y-6">
            
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
                  <SelectItem value="gemini-2.5-pro">
                    <div className="flex items-center space-x-2">
                      <Brain className="h-4 w-4" />
                      <div>
                        <div className="font-medium">Gemini 2.5 Pro</div>
                        <div className="text-xs text-muted-foreground">Beste kwaliteit, uitgebreide redenering</div>
                      </div>
                    </div>
                  </SelectItem>
                  <SelectItem value="gemini-2.5-flash">
                    <div className="flex items-center space-x-2">
                      <Zap className="h-4 w-4" />
                      <div>
                        <div className="font-medium">Gemini 2.5 Flash</div>
                        <div className="text-xs text-muted-foreground">Snellere verwerking, lagere kosten</div>
                      </div>
                    </div>
                  </SelectItem>
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

            {/* Google Search Grounding */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <Label className="text-sm font-medium">Google Search Grounding</Label>
                  <p className="text-xs text-muted-foreground">
                    Alternatief voor Deep Research - zoekt actuele informatie online
                  </p>
                </div>
                <Switch
                  checked={aiConfig.useGrounding}
                  onCheckedChange={(checked) => handleAiConfigChange("useGrounding", checked)}
                  data-testid="switch-grounding"
                />
              </div>
            </div>

            {/* Deep Research Info */}
            <div className="bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <Search className="h-5 w-5 text-green-600 dark:text-green-400 mt-0.5" />
                <div>
                  <h4 className="font-medium text-green-900 dark:text-green-100 mb-1">
                    Research Functionaliteit 
                  </h4>
                  <p className="text-sm text-green-700 dark:text-green-300">
                    Google Search grounding is nu actief als alternatief voor Deep Research. 
                    Dit geeft Gemini toegang tot actuele fiscale informatie van betrouwbare bronnen.
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
}