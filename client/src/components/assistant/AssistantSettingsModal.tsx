import { memo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Brain, Zap } from "lucide-react";
import { DEFAULT_FISCAL_ASSISTANT_PROMPT } from "@/pages/follow-up-assistant";

// Note: The prompt uses "body" instead of "body_html" to generate plain text emails

// Available AI models - matching the server configuration
const AI_MODELS = {
  google: [
    { value: "gemini-3-pro-preview", label: "Gemini 3 Pro (Nieuwste - Thinking)" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro (Beste kwaliteit)" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Snelste)" },
  ],
  openai: [
    { value: "gpt-5", label: "GPT-5 (Nieuwste)" },
    { value: "gpt-4o", label: "GPT-4o (Beste kwaliteit)" },
    { value: "gpt-4o-mini", label: "GPT-4o Mini (Snel)" },
    { value: "o3-mini", label: "o3-mini (Reasoning)" },
  ],
} as const;

interface AssistantSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  aiModel: string;
  setAiModel: (model: string) => void;
  systemPrompt: string;
  setSystemPrompt: (prompt: string) => void;
}

export const AssistantSettingsModal = memo(function AssistantSettingsModal({
  open,
  onOpenChange,
  aiModel,
  setAiModel,
  systemPrompt,
  setSystemPrompt,
}: AssistantSettingsModalProps) {
  // Determine current provider based on model
  const currentProvider = aiModel.startsWith("gpt") || aiModel.startsWith("o3") ? "openai" : "google";

  const handleProviderChange = (provider: "google" | "openai") => {
    // Set default model for the selected provider
    const defaultModel = provider === "google" ? "gemini-3-pro-preview" : "gpt-4o";
    setAiModel(defaultModel);
  };

  const handleResetDefault = () => {
    setSystemPrompt(DEFAULT_FISCAL_ASSISTANT_PROMPT);
  };

  const handleSaveAndClose = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assistent Instellingen</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* AI Provider Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">AI Provider</Label>
            <Select value={currentProvider} onValueChange={handleProviderChange}>
              <SelectTrigger>
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

          {/* AI Model Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">AI Model</Label>
            <Select value={aiModel} onValueChange={setAiModel}>
              <SelectTrigger id="model_select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AI_MODELS[currentProvider].map((model) => (
                  <SelectItem key={model.value} value={model.value}>
                    {model.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* System Prompt */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Systeem Prompt (Fiscaal Assistent)</Label>
              <Button
                onClick={handleResetDefault}
                variant="ghost"
                size="sm"
                type="button"
              >
                Herstel Standaard
              </Button>
            </div>
            <Textarea
              id="system_prompt_input"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              className="font-mono text-xs min-h-96"
              placeholder="Voer de systeem prompt in..."
            />
            <p className="text-xs text-muted-foreground">
              Deze prompt bepaalt hoe de AI vervolgvragen analyseert en conceptantwoorden genereert.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSaveAndClose} type="button">
            Opslaan & Sluiten
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
