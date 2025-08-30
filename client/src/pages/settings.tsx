import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { 
  Settings as SettingsIcon, 
  Save, 
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Workflow
} from "lucide-react";
import type { PromptConfigRecord, PromptConfig } from "@shared/schema";

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
      setActiveConfig(activePromptConfig.config as PromptConfig);
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
    
    updatePromptMutation.mutate({
      id: activePromptConfig.id,
      config: activeConfig,
    });
  };

  const isPromptEmpty = (prompt: string) => {
    return !prompt || prompt.trim() === "" || prompt.startsWith("PLACEHOLDER:");
  };

  const getCompletionStats = () => {
    if (!activeConfig) return { completed: 0, total: PROMPT_STAGES.length };
    
    const completed = PROMPT_STAGES.filter(stage => 
      !isPromptEmpty(activeConfig[stage.key as keyof PromptConfig])
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
            const prompt = activeConfig?.[stage.key as keyof PromptConfig] || "";
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