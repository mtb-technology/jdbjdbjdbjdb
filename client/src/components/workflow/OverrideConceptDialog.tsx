import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface OverrideConceptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  reportId: string;
  stageId: string;
  stageName: string;
  currentContent: string;
}

export function OverrideConceptDialog({
  isOpen,
  onClose,
  reportId,
  stageId,
  stageName,
  currentContent
}: OverrideConceptDialogProps) {
  const [content, setContent] = useState(currentContent);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Mutation for overriding concept content
  const overrideConceptM = useMutation({
    mutationFn: async (newContent: string): Promise<any> => {
      return await apiRequest('POST', `/api/reports/${reportId}/stage/${stageId}/override-concept`, { 
        content: newContent, 
        reason: `Handmatige overschrijving van ${stageName}` 
      });
    },
    onSuccess: (response: any) => {
      toast({
        title: "Concept overschreven",
        description: response.message || `${stageName} succesvol overschreven`,
        duration: 3000,
      });
      
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: [`/api/reports/${reportId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/reports'] });
      
      onClose();
    },
    onError: (error: any) => {
      console.error("❌ Failed to override concept:", error);
      const errorMessage = typeof error === 'string' ? error : 
                          error?.message || error?.userMessage || 
                          (error?.response?.data?.message) ||
                          'Er ging iets mis bij het overschrijven';
      toast({
        title: "Override mislukt",
        description: errorMessage,
        variant: "destructive",
        duration: 5000,
      });
    }
  });

  const handleSave = () => {
    if (!content.trim()) {
      toast({
        title: "Content vereist",
        description: "Voer inhoud in voor het concept rapport",
        variant: "destructive",
        duration: 3000,
      });
      return;
    }
    
    overrideConceptM.mutate(content);
  };

  const handleClose = () => {
    if (!overrideConceptM.isPending) {
      setContent(currentContent); // Reset content
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Overschrijf Concept - {stageName}</DialogTitle>
          <DialogDescription>
            Bewerk de inhoud van het concept rapport voor deze stage. 
            Dit wordt de nieuwe basis voor verdere stappen.
          </DialogDescription>
        </DialogHeader>
        
        <div className="flex-1 min-h-0">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Voer hier de nieuwe concept rapport inhoud in..."
            className="h-full min-h-[400px] font-mono text-sm resize-none"
            disabled={overrideConceptM.isPending}
            data-testid="textarea-override-content"
          />
        </div>
        
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={overrideConceptM.isPending}
            data-testid="button-cancel-override"
          >
            Annuleren
          </Button>
          <Button
            onClick={handleSave}
            disabled={overrideConceptM.isPending || !content.trim()}
            data-testid="button-save-override"
          >
            {overrideConceptM.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Opslaan...
              </>
            ) : (
              "Overschrijf Concept"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}