import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, Eye, EyeOff, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface StepInputOutputProps {
  stageName: string;
  stageIndex: number;
  prompt: string;
  output: string;
  isActive: boolean;
  isProcessing: boolean;
  processingTime?: number;
}

export function StepInputOutput({
  stageName,
  stageIndex,
  prompt,
  output,
  isActive,
  isProcessing,
  processingTime
}: StepInputOutputProps) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [showOutput, setShowOutput] = useState(true);
  const [isExpanded, setIsExpanded] = useState(isActive);
  const { toast } = useToast();

  const copyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: `${type} gekopieerd`,
      description: "Naar klembord gekopieerd",
      duration: 2000,
    });
  };

  return (
    <Card className={`mb-4 ${isActive ? 'ring-2 ring-primary' : ''} ${output ? 'bg-green-50/50 dark:bg-green-950/10' : ''}`}>
      <CardHeader 
        className="cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
            <CardTitle className="text-lg">
              Step {stageIndex + 1}: {stageName}
            </CardTitle>
            {isProcessing && (
              <Badge className="bg-orange-500">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Processing...
                </div>
              </Badge>
            )}
            {output && !isProcessing && (
              <Badge className="bg-green-600">✓ Complete</Badge>
            )}
            {processingTime && (
              <Badge variant="outline">{processingTime}s</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      
      {isExpanded && (
        <CardContent className="space-y-4">
          {/* PROMPT/INPUT Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                📥 INPUT (Prompt naar AI)
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowPrompt(!showPrompt)}
                >
                  {showPrompt ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  {showPrompt ? "Verberg" : "Toon"}
                </Button>
              </h4>
              {prompt && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(prompt, "Prompt")}
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Kopieer Prompt
                </Button>
              )}
            </div>
            
            {showPrompt && prompt && (
              <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
                <pre className="whitespace-pre-wrap text-xs font-mono overflow-x-auto">
                  {prompt}
                </pre>
              </div>
            )}
            
            {!prompt && !isProcessing && (
              <div className="text-sm text-muted-foreground italic">
                Wachtend op uitvoering...
              </div>
            )}
          </div>

          {/* OUTPUT Section */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                📤 OUTPUT (Resultaat van AI)
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowOutput(!showOutput)}
                >
                  {showOutput ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  {showOutput ? "Verberg" : "Toon"}
                </Button>
              </h4>
              {output && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(output, "Output")}
                >
                  <Copy className="h-4 w-4 mr-2" />
                  Kopieer Output
                </Button>
              )}
            </div>
            
            {showOutput && output && (
              <div className="bg-blue-50 dark:bg-blue-950/20 p-4 rounded-lg border border-blue-200 dark:border-blue-800">
                <pre className="whitespace-pre-wrap text-xs font-mono overflow-x-auto">
                  {output}
                </pre>
              </div>
            )}
            
            {isProcessing && (
              <div className="flex items-center gap-3 text-sm text-orange-600 dark:text-orange-400">
                <div className="w-4 h-4 border-2 border-orange-600 border-t-transparent rounded-full animate-spin"></div>
                AI is bezig met verwerken...
              </div>
            )}
            
            {!output && !isProcessing && (
              <div className="text-sm text-muted-foreground italic">
                Nog geen output beschikbaar
              </div>
            )}
          </div>

          {/* Show what goes to next step */}
          {output && stageIndex < 10 && (
            <div className="pt-3 border-t">
              <p className="text-xs text-muted-foreground">
                ↓ Deze output wordt gebruikt als input voor de volgende stap
              </p>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}