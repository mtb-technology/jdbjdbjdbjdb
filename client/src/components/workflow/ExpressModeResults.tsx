import { useState, useCallback, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  CheckCircle,
  Clock,
  Edit3,
  FileText,
  Save,
  X,
  AlertTriangle,
  Info,
  Lightbulb,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import type { ExpressModeSummary, ExpressModeStageSummary, ExpressModeChange } from '@shared/types/api';

interface ExpressModeResultsProps {
  reportId: string;
  summary: ExpressModeSummary;
  onClose: () => void;
  onSaveComplete?: () => void;
}

export function ExpressModeResults({
  reportId,
  summary,
  onClose,
  onSaveComplete,
}: ExpressModeResultsProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(summary.finalContent);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Save mutation for concept content
  const saveMutation = useMutation({
    mutationFn: async (content: string) => {
      const response = await apiRequest(
        'PATCH',
        `/api/reports/${reportId}/concept-content`,
        { content }
      );
      return response;
    },
    onMutate: () => {
      setSaveStatus('saving');
      setSaveError(null);
    },
    onSuccess: () => {
      setSaveStatus('saved');
      setIsEditing(false);
      onSaveComplete?.();
      // Reset to idle after 2 seconds
      setTimeout(() => {
        setSaveStatus(prev => prev === 'saved' ? 'idle' : prev);
      }, 2000);
    },
    onError: (error: Error) => {
      setSaveStatus('error');
      setSaveError(error.message || 'Opslaan mislukt');
    },
  });

  const handleSave = useCallback(() => {
    saveMutation.mutate(editedContent);
  }, [editedContent, saveMutation]);

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <AlertTriangle className="h-3 w-3 text-red-500" />;
      case 'important':
        return <Info className="h-3 w-3 text-blue-500" />;
      default:
        return <Lightbulb className="h-3 w-3 text-yellow-500" />;
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <Badge variant="destructive" className="text-xs">Kritiek</Badge>;
      case 'important':
        return <Badge variant="default" className="text-xs">Belangrijk</Badge>;
      default:
        return <Badge variant="secondary" className="text-xs">Suggestie</Badge>;
    }
  };

  const getChangeTypeLabel = (type: string) => {
    switch (type) {
      case 'add':
        return 'Toegevoegd';
      case 'delete':
        return 'Verwijderd';
      case 'restructure':
        return 'Herstructureerd';
      default:
        return 'Aangepast';
    }
  };

  // Group changes by severity for stats
  const severityStats = useMemo(() => {
    const stats = { critical: 0, important: 0, suggestion: 0 };
    summary.stages.forEach(stage => {
      stage.changes.forEach(change => {
        stats[change.severity as keyof typeof stats]++;
      });
    });
    return stats;
  }, [summary.stages]);

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm overflow-hidden">
      <div className="container mx-auto h-full flex flex-col py-6 px-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="h-12 w-12 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
              <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Express Mode Voltooid</h1>
              <p className="text-muted-foreground">
                {summary.stages.length} reviewers, {summary.totalChanges} wijzigingen
                <span className="mx-2">•</span>
                <Clock className="h-3 w-3 inline mr-1" />
                {formatTime(summary.totalProcessingTimeMs)}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>
            <X className="h-4 w-4 mr-2" />
            Sluiten
          </Button>
        </div>

        {/* Stats bar */}
        <div className="flex gap-4 mb-6">
          {severityStats.critical > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              <span className="text-sm font-medium">{severityStats.critical} kritiek</span>
            </div>
          )}
          {severityStats.important > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg">
              <Info className="h-4 w-4 text-blue-500" />
              <span className="text-sm font-medium">{severityStats.important} belangrijk</span>
            </div>
          )}
          {severityStats.suggestion > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 rounded-lg">
              <Lightbulb className="h-4 w-4 text-yellow-500" />
              <span className="text-sm font-medium">{severityStats.suggestion} suggesties</span>
            </div>
          )}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-900 border rounded-lg ml-auto">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">Versie {summary.finalVersion}</span>
          </div>
        </div>

        {/* Main content grid */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-6 min-h-0">
          {/* Left: Change Summary */}
          <Card className="flex flex-col min-h-0">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Wijzigingen per Reviewer</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 p-0">
              <ScrollArea className="h-full px-6 pb-6">
                {summary.stages.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Geen wijzigingen voorgesteld</p>
                    <p className="text-sm mt-1">Het rapport was al van goede kwaliteit</p>
                  </div>
                ) : (
                  <Accordion type="multiple" defaultValue={summary.stages.map(s => s.stageId)}>
                    {summary.stages.map((stage) => (
                      <AccordionItem key={stage.stageId} value={stage.stageId}>
                        <AccordionTrigger className="hover:no-underline">
                          <div className="flex items-center gap-3 flex-1">
                            <span className="font-medium">{stage.stageName}</span>
                            <Badge variant="outline" className="ml-auto mr-2">
                              {stage.changesCount} {stage.changesCount === 1 ? 'wijziging' : 'wijzigingen'}
                            </Badge>
                            {stage.processingTimeMs && (
                              <span className="text-xs text-muted-foreground">
                                {formatTime(stage.processingTimeMs)}
                              </span>
                            )}
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-2 pl-2">
                            {stage.changes.map((change, idx) => (
                              <div
                                key={idx}
                                className="flex items-start gap-2 p-2 rounded-md bg-muted/50"
                              >
                                {getSeverityIcon(change.severity)}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-medium text-muted-foreground">
                                      {getChangeTypeLabel(change.type)}
                                    </span>
                                    {change.section && (
                                      <span className="text-xs text-muted-foreground">
                                        in {change.section}
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-sm">{change.description}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                )}
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Right: Editor */}
          <Card className="flex flex-col min-h-0">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Finale Rapport</CardTitle>
              <div className="flex items-center gap-2">
                {saveStatus === 'saved' && (
                  <span className="text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle className="h-3 w-3" /> Opgeslagen
                  </span>
                )}
                {saveStatus === 'saving' && (
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> Opslaan...
                  </span>
                )}
                {saveStatus === 'error' && (
                  <span className="text-xs text-red-600">{saveError}</span>
                )}
                {isEditing ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditedContent(summary.finalContent);
                        setIsEditing(false);
                      }}
                    >
                      Annuleer
                    </Button>
                    <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending}>
                      {saveMutation.isPending ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      Opslaan
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setIsEditing(true)}>
                    <Edit3 className="h-4 w-4 mr-2" />
                    Bewerken
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 p-0">
              {isEditing ? (
                <Textarea
                  value={editedContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  className="h-full resize-none border-0 rounded-none focus-visible:ring-0 font-mono text-sm"
                  placeholder="Rapport content..."
                />
              ) : (
                <ScrollArea className="h-full px-6 pb-6">
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                    {summary.finalContent}
                  </pre>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
