import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  MessageSquare, 
  Play,
  CheckCircle,
  Copy,
  Loader2
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import type { ProcessFeedbackRequest, ProcessFeedbackResponse } from '@shared/types/api';

interface SimpleFeedbackProcessorProps {
  reportId: string;
  stageId: string;
  stageName: string;
  rawFeedback: string;
  onProcessingComplete?: (result: ProcessFeedbackResponse) => void;
}

export function SimpleFeedbackProcessor({
  reportId,
  stageId,
  stageName,
  rawFeedback,
  onProcessingComplete
}: SimpleFeedbackProcessorProps) {
  const [userInstructions, setUserInstructions] = useState("");
  const [hasProcessed, setHasProcessed] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Mutation for processing feedback
  const processFeedbackMutation = useMutation({
    mutationFn: async (payload: ProcessFeedbackRequest): Promise<ProcessFeedbackResponse> => {
      return await apiRequest({
        method: 'POST',
        url: `/api/reports/${reportId}/stage/${stageId}/process-feedback`,
        data: payload
      });
    },
    onSuccess: (response: ProcessFeedbackResponse) => {
      console.log(`✅ Feedback processed successfully - v${response.newVersion}`);
      
      setHasProcessed(true);
      setUserInstructions(""); // Clear input
      
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['/api/reports', reportId] });
      
      toast({
        title: "Feedback verwerkt",
        description: `Concept rapport bijgewerkt naar versie ${response.newVersion}`,
        duration: 4000,
      });

      onProcessingComplete?.(response);
    },
    onError: (error: any) => {
      console.error(`❌ Failed to process feedback:`, error);
      
      toast({
        title: "Feedback processing gefaald",
        description: error.message || "Er ging iets mis bij het verwerken van je instructies",
        variant: "destructive",
        duration: 5000,
      });
    }
  });

  const handleProcess = () => {
    if (!userInstructions.trim()) {
      toast({
        title: "Instructies vereist",
        description: "Geef aan welke feedback je wilt verwerken en welke niet",
        variant: "destructive",
        duration: 3000,
      });
      return;
    }

    console.log(`🔧 Processing feedback for ${stageId} with instructions:`, userInstructions);
    
    processFeedbackMutation.mutate({
      userInstructions: userInstructions.trim(),
      processingStrategy: 'merge'
    });
  };

  const copyFeedback = () => {
    navigator.clipboard.writeText(rawFeedback);
    toast({
      title: "Feedback gekopieerd",
      duration: 2000,
    });
  };

  return (
    <Card className="w-full" data-testid="feedback-processor">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Feedback Review - {stageName}
          </CardTitle>
          
          <div className="flex items-center gap-2">
            {hasProcessed ? (
              <Badge variant="outline" className="text-green-600 border-green-300">
                <CheckCircle className="h-3 w-3 mr-1" />
                Verwerkt
              </Badge>
            ) : (
              <Badge variant="outline" className="text-blue-600 border-blue-300">
                <MessageSquare className="h-3 w-3 mr-1" />
                Wacht op instructies
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Raw Feedback Display */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <Label className="text-sm font-medium">Originele Feedback van {stageName}</Label>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={copyFeedback}
              data-testid="button-copy-feedback"
            >
              <Copy className="h-4 w-4 mr-1" />
              Kopieer
            </Button>
          </div>
          
          <ScrollArea className="h-48 w-full border rounded-md p-3 bg-gray-50 dark:bg-gray-800">
            <pre className="text-sm whitespace-pre-wrap font-mono" data-testid="text-raw-feedback">
              {rawFeedback}
            </pre>
          </ScrollArea>
        </div>

        {/* User Instructions Input */}
        <div>
          <Label htmlFor="userInstructions" className="text-sm font-medium">
            Jouw Instructies
          </Label>
          <p className="text-xs text-muted-foreground mb-2">
            Geef aan wat je wel en niet wilt verwerken. Bijvoorbeeld: "Verwerk alleen de bronverwijzingen, negeer stijlwijzigingen"
          </p>
          
          <Textarea
            id="userInstructions"
            placeholder="Verwerk alleen de punten over bronnen, negeer de stijlwijzigingen..."
            value={userInstructions}
            onChange={(e) => setUserInstructions(e.target.value)}
            disabled={processFeedbackMutation.isPending || hasProcessed}
            rows={4}
            className="resize-none"
            data-testid="input-user-instructions"
          />
          
          <div className="flex justify-between items-center mt-2">
            <p className="text-xs text-muted-foreground">
              {userInstructions.length}/2000 karakters
            </p>
            {userInstructions.length > 2000 && (
              <p className="text-xs text-red-500">Te veel karakters</p>
            )}
          </div>
        </div>

        {/* Process Button */}
        <div className="flex justify-end">
          <Button 
            onClick={handleProcess}
            disabled={
              !userInstructions.trim() || 
              userInstructions.length > 2000 ||
              processFeedbackMutation.isPending || 
              hasProcessed
            }
            className="min-w-[160px]"
            data-testid="button-process-feedback"
          >
            {processFeedbackMutation.isPending ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Verwerkt...</span>
              </div>
            ) : hasProcessed ? (
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                <span>Verwerkt</span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Play className="h-4 w-4" />
                <span>Process Feedback</span>
              </div>
            )}
          </Button>
        </div>

        {/* Success Message */}
        {hasProcessed && (
          <div className="mt-4 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md">
            <p className="text-sm text-green-700 dark:text-green-300">
              ✅ Feedback succesvol verwerkt! Het concept rapport is bijgewerkt volgens jouw instructies.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}