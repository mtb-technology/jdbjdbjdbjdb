import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Play,
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle,
  FileText,
  Zap,
  Eye,
  RotateCcw,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ProcessingStepProps {
  stageKey: string;
  stageName: string;
  stageDescription: string;
  icon?: React.ReactNode;
  reportId: string;
  output: string;
  status: 'idle' | 'processing' | 'completed' | 'error';
  error?: string;
  onExecute: () => void;
  onRetry?: () => void;
  autoStart?: boolean;
}

export function ProcessingStep({
  stageKey,
  stageName,
  stageDescription,
  icon,
  reportId,
  output,
  status,
  error,
  onExecute,
  onRetry,
  autoStart = false,
}: ProcessingStepProps) {
  const [hasAutoStarted, setHasAutoStarted] = useState(false);
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [promptPreview, setPromptPreview] = useState<string>("");
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [showOutput, setShowOutput] = useState(true);

  // Auto-start if enabled
  useEffect(() => {
    if (autoStart && !hasAutoStarted && status === 'idle') {
      setHasAutoStarted(true);
      onExecute();
    }
  }, [autoStart, hasAutoStarted, status, onExecute]);

  // Load prompt preview
  const loadPromptPreview = async () => {
    setLoadingPrompt(true);
    try {
      const response = await fetch(`/api/reports/${reportId}/stage/${stageKey}/preview`);
      const data = await response.json();
      setPromptPreview(data.data?.prompt || data.prompt || "Prompt niet beschikbaar");
      setShowPromptPreview(true);
    } catch (err) {
      console.error("Failed to load prompt:", err);
      setPromptPreview("Fout bij laden van prompt");
    } finally {
      setLoadingPrompt(false);
    }
  };

  const getStatusIcon = () => {
    switch (status) {
      case 'idle':
        return <Play className="h-6 w-6 text-gray-500" />;
      case 'processing':
        return <Loader2 className="h-6 w-6 text-blue-500 animate-spin" />;
      case 'completed':
        return <CheckCircle className="h-6 w-6 text-green-500" />;
      case 'error':
        return <XCircle className="h-6 w-6 text-red-500" />;
    }
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'idle':
        return <Badge variant="secondary">Gereed om te starten</Badge>;
      case 'processing':
        return <Badge className="bg-blue-100 text-blue-800">Verwerken...</Badge>;
      case 'completed':
        return <Badge className="bg-green-100 text-green-800">Voltooid</Badge>;
      case 'error':
        return <Badge variant="destructive">Fout opgetreden</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="text-center">
        <div className="flex justify-center mb-4">
          <div className={cn(
            "p-4 rounded-full transition-colors",
            status === 'processing' && "bg-blue-100 animate-pulse",
            status === 'completed' && "bg-green-100",
            status === 'error' && "bg-red-100",
            status === 'idle' && "bg-gray-100"
          )}>
            {icon || <Zap className="h-8 w-8" />}
          </div>
        </div>
        <div className="flex items-center justify-center gap-3 mb-2">
          <h3 className="text-2xl font-bold">{stageName}</h3>
          {getStatusBadge()}
        </div>
        <p className="text-muted-foreground">{stageDescription}</p>
      </div>

      {/* Status Alerts */}
      {status === 'idle' && !autoStart && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Klaar om te starten</AlertTitle>
          <AlertDescription>
            Klik op "Start Verwerking" om deze stap uit te voeren
          </AlertDescription>
        </Alert>
      )}

      {status === 'processing' && (
        <Alert className="bg-blue-50 border-blue-200">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          <AlertTitle className="text-blue-900">Bezig met verwerken...</AlertTitle>
          <AlertDescription className="text-blue-800">
            De AI verwerkt je verzoek. Dit kan enkele momenten duren.
          </AlertDescription>
        </Alert>
      )}

      {status === 'completed' && (
        <Alert className="bg-green-50 border-green-200">
          <CheckCircle className="h-4 w-4 text-green-600" />
          <AlertTitle className="text-green-900">Stap voltooid</AlertTitle>
          <AlertDescription className="text-green-800">
            Deze stap is succesvol afgerond. Bekijk de output hieronder en klik op "Volgende" om door te gaan.
          </AlertDescription>
        </Alert>
      )}

      {status === 'error' && (
        <Alert variant="destructive">
          <XCircle className="h-4 w-4" />
          <AlertTitle>Er is een fout opgetreden</AlertTitle>
          <AlertDescription>
            {error || "Er ging iets mis tijdens het verwerken. Probeer het opnieuw."}
          </AlertDescription>
        </Alert>
      )}

      {/* Action Buttons */}
      {status === 'idle' && !autoStart && (
        <div className="flex flex-col gap-3">
          <div className="flex justify-center gap-3">
            <Button
              onClick={loadPromptPreview}
              variant="outline"
              size="lg"
              disabled={loadingPrompt}
            >
              {loadingPrompt ? (
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              ) : (
                <Eye className="mr-2 h-5 w-5" />
              )}
              Bekijk Prompt
            </Button>
            <Button onClick={onExecute} size="lg" className="min-w-[200px]">
              <Play className="mr-2 h-5 w-5" />
              Start Verwerking
            </Button>
          </div>
        </div>
      )}

      {status === 'completed' && (
        <div className="flex justify-center gap-3">
          <Button
            onClick={loadPromptPreview}
            variant="outline"
            disabled={loadingPrompt}
          >
            {loadingPrompt ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Eye className="mr-2 h-4 w-4" />
            )}
            Bekijk Prompt
          </Button>
          <Button onClick={onExecute} variant="secondary">
            <RotateCcw className="mr-2 h-4 w-4" />
            Opnieuw Uitvoeren
          </Button>
        </div>
      )}

      {status === 'error' && onRetry && (
        <div className="flex justify-center gap-3">
          <Button onClick={onRetry} variant="destructive" size="lg">
            <RotateCcw className="mr-2 h-5 w-5" />
            Opnieuw Proberen
          </Button>
          <Button
            onClick={loadPromptPreview}
            variant="outline"
            disabled={loadingPrompt}
          >
            <Eye className="mr-2 h-4 w-4" />
            Bekijk Prompt
          </Button>
        </div>
      )}

      {/* Prompt Preview */}
      {showPromptPreview && promptPreview && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Eye className="h-5 w-5 text-blue-600" />
                Prompt Preview
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowPromptPreview(false)}
              >
                Sluiten
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px] w-full rounded-md border bg-white p-4">
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-gray-700">
                {promptPreview}
              </pre>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Output Display */}
      {output && (
        <Card className="border-green-200 bg-green-50/30">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5 text-green-600" />
                AI Output
                <Badge variant="outline" className="ml-2">
                  {output.length.toLocaleString()} karakters
                </Badge>
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowOutput(!showOutput)}
              >
                {showOutput ? (
                  <>
                    <ChevronUp className="h-4 w-4 mr-1" />
                    Verberg
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-4 w-4 mr-1" />
                    Toon
                  </>
                )}
              </Button>
            </div>
          </CardHeader>
          {showOutput && (
            <CardContent>
              <ScrollArea className="h-[500px] w-full rounded-md border bg-white p-6">
                <div className="prose prose-sm max-w-none">
                  <div className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-gray-800">
                    {output}
                  </div>
                </div>
              </ScrollArea>
              <div className="mt-4 text-xs text-muted-foreground">
                💡 Tip: Bekijk de output zorgvuldig en gebruik "Opnieuw Uitvoeren" als je aanpassingen wilt.
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Processing Placeholder */}
      {status === 'processing' && !output && (
        <div className="h-[400px] border rounded-md bg-muted/30 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-4" />
            <p className="text-muted-foreground">AI aan het werk...</p>
          </div>
        </div>
      )}
    </div>
  );
}

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <label className={cn("text-sm font-medium", className)}>{children}</label>;
}
