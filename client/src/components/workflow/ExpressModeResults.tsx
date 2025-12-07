import { useState, useCallback, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
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
  Loader2,
  ArrowRight,
  MessageSquare,
  Undo2,
} from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { parseFeedbackToProposals } from '@/lib/parse-feedback';
import { STAGE_NAMES, REVIEW_STAGES } from '@shared/constants';
import { QUERY_KEYS } from '@/lib/queryKeys';
import { useToast } from '@/hooks/use-toast';
import type { ExpressModeSummary, ExpressModeStageSummary, ExpressModeChange } from '@shared/types/api';

interface ExpressModeResultsProps {
  reportId: string;
  /** Direct summary from SSE stream (optional if stageResults provided) */
  summary?: ExpressModeSummary;
  /** Raw stageResults from report - will be parsed client-side to rebuild summary */
  stageResults?: Record<string, string>;
  /** Final concept report content */
  finalContent?: string;
  /** Current concept version */
  finalVersion?: number;
  /** Previously rolled back changes (loaded from database) */
  initialRolledBackChanges?: Record<string, { rolledBackAt: string }>;
  onClose: () => void;
  onSaveComplete?: () => void;
}

/**
 * Build ExpressModeSummary from raw stageResults
 * This allows reopening the results view after the initial SSE stream
 */
function buildSummaryFromStageResults(
  stageResults: Record<string, string>,
  finalContent: string,
  finalVersion: number
): ExpressModeSummary {
  const stages: ExpressModeStageSummary[] = [];

  // Process each review stage that has results
  for (const stageId of REVIEW_STAGES) {
    const rawFeedback = stageResults[stageId];
    if (!rawFeedback) continue;

    const stageName = STAGE_NAMES[stageId] || stageId;

    // Use shared parser to extract proposals
    const proposals = parseFeedbackToProposals(rawFeedback, stageName, stageId);

    // Convert to ExpressModeChange format with original and reasoning
    const changes: ExpressModeChange[] = proposals.map(p => ({
      type: p.changeType,
      description: p.proposed || p.reasoning,
      severity: p.severity,
      section: p.section !== 'Algemeen' ? p.section : undefined,
      original: p.original || undefined,
      reasoning: p.reasoning || undefined,
    }));

    stages.push({
      stageId,
      stageName,
      changesCount: changes.length,
      changes,
    });
  }

  const totalChanges = stages.reduce((sum, s) => sum + s.changesCount, 0);

  return {
    stages,
    totalChanges,
    finalVersion,
    totalProcessingTimeMs: 0, // Not available when rebuilding
    finalContent,
  };
}

export function ExpressModeResults({
  reportId,
  summary: providedSummary,
  stageResults,
  finalContent,
  finalVersion = 1,
  initialRolledBackChanges,
  onClose,
  onSaveComplete,
}: ExpressModeResultsProps) {
  // Build summary from stageResults if not provided directly
  const summary = useMemo(() => {
    if (providedSummary) return providedSummary;
    if (stageResults && finalContent) {
      return buildSummaryFromStageResults(stageResults, finalContent, finalVersion);
    }
    // Fallback empty summary
    return {
      stages: [],
      totalChanges: 0,
      finalVersion: 1,
      totalProcessingTimeMs: 0,
      finalContent: finalContent || '',
    };
  }, [providedSummary, stageResults, finalContent, finalVersion]);

  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState(summary.finalContent);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  // Initialize with persisted rolled back changes from database
  const [rolledBackChanges, setRolledBackChanges] = useState<Set<string>>(
    () => new Set(Object.keys(initialRolledBackChanges || {}))
  );
  const [rollingBackChange, setRollingBackChange] = useState<string | null>(null);
  const [displayedContent, setDisplayedContent] = useState(summary.finalContent);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Rollback mutation
  const rollbackMutation = useMutation({
    mutationFn: async ({ stageId, changeIndex }: { stageId: string; changeIndex: number }) => {
      const response = await apiRequest(
        'POST',
        `/api/reports/${reportId}/rollback-change`,
        { stageId, changeIndex }
      );
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Rollback mislukt');
      }
      return response.json();
    },
    onMutate: ({ stageId, changeIndex }) => {
      setRollingBackChange(`${stageId}-${changeIndex}`);
    },
    onSuccess: (data, { stageId, changeIndex }) => {
      const changeKey = `${stageId}-${changeIndex}`;
      setRolledBackChanges(prev => new Set(Array.from(prev).concat(changeKey)));
      setRollingBackChange(null);

      // Update displayed content with new version
      if (data.data?.newContent) {
        setDisplayedContent(data.data.newContent);
        setEditedContent(data.data.newContent);
      }

      // Invalidate report cache
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.reports.detail(reportId) });

      toast({
        title: 'Wijziging teruggedraaid',
        description: data.data?.warning || `Versie ${data.data?.newVersion} opgeslagen`,
        variant: data.data?.warning ? 'default' : 'default',
      });

      // Note: Don't call onSaveComplete here - it triggers page reload which closes this modal
      // The query cache is already invalidated above, so the UI will update correctly
    },
    onError: (error: Error, { stageId, changeIndex }) => {
      setRollingBackChange(null);
      toast({
        title: 'Rollback mislukt',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

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
          <Card className="flex flex-col min-h-0 border-2">
            <CardHeader className="pb-3 border-b bg-muted/30">
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Wijzigingen per Reviewer
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 p-0">
              <ScrollArea className="h-full p-4">
                {summary.stages.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>Geen wijzigingen voorgesteld</p>
                    <p className="text-sm mt-1">Het rapport was al van goede kwaliteit</p>
                  </div>
                ) : (
                  <Accordion type="multiple" defaultValue={summary.stages.map(s => s.stageId)} className="space-y-3">
                    {summary.stages.map((stage) => (
                      <AccordionItem
                        key={stage.stageId}
                        value={stage.stageId}
                        className="border rounded-lg px-4 bg-card/50"
                      >
                        <AccordionTrigger className="hover:no-underline py-4">
                          <div className="flex items-center gap-3 flex-1">
                            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                              <span className="text-xs font-bold text-primary">
                                {stage.changesCount}
                              </span>
                            </div>
                            <div className="flex flex-col items-start gap-0.5">
                              <span className="font-semibold text-base">{stage.stageName}</span>
                              <span className="text-xs text-muted-foreground">
                                {stage.changesCount} {stage.changesCount === 1 ? 'wijziging' : 'wijzigingen'}
                                {stage.processingTimeMs ? ` • ${formatTime(stage.processingTimeMs)}` : ''}
                              </span>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent>
                          <div className="space-y-3 pt-2">
                            {stage.changes.map((change, idx) => {
                              const changeKey = `${stage.stageId}-${idx}`;
                              const isRolledBack = rolledBackChanges.has(changeKey);
                              const isRollingBack = rollingBackChange === changeKey;

                              return (
                                <div
                                  key={idx}
                                  className={`
                                    relative rounded-lg border-l-4 bg-card p-4 shadow-sm
                                    ${isRolledBack
                                      ? 'border-l-gray-300 bg-gray-50/50 dark:bg-gray-950/20 opacity-60'
                                      : change.severity === 'critical'
                                      ? 'border-l-red-500 bg-red-50/50 dark:bg-red-950/20'
                                      : change.severity === 'important'
                                      ? 'border-l-blue-500 bg-blue-50/50 dark:bg-blue-950/20'
                                      : 'border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20'
                                    }
                                  `}
                                >
                                  {/* Header row with rollback button */}
                                  <div className="flex items-center justify-between gap-2 mb-2">
                                    <div className="flex items-center gap-2">
                                      {getSeverityIcon(change.severity)}
                                      {getSeverityBadge(change.severity)}
                                      <span className="text-xs font-medium px-2 py-0.5 rounded bg-muted">
                                        {getChangeTypeLabel(change.type)}
                                      </span>
                                      {isRolledBack && (
                                        <Badge variant="outline" className="text-xs text-gray-500">
                                          Teruggedraaid
                                        </Badge>
                                      )}
                                    </div>
                                    {/* Rollback button - only show if has original text and not already rolled back */}
                                    {(change.original || change.type === 'add') && !isRolledBack && (
                                      <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-7 px-2.5 text-xs border-orange-300 text-orange-700 hover:bg-orange-50 hover:text-orange-800 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-950"
                                            disabled={isRollingBack || rollbackMutation.isPending}
                                          >
                                            {isRollingBack ? (
                                              <Loader2 className="h-3 w-3 animate-spin" />
                                            ) : (
                                              <>
                                                <Undo2 className="h-3 w-3 mr-1" />
                                                Terugdraaien
                                              </>
                                            )}
                                          </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                          <AlertDialogHeader>
                                            <AlertDialogTitle>Wijziging terugdraaien?</AlertDialogTitle>
                                            <AlertDialogDescription className="space-y-2">
                                              <p>Weet je zeker dat je deze wijziging ongedaan wilt maken?</p>
                                              {change.original && (
                                                <div className="mt-3 p-3 bg-muted rounded-md text-sm">
                                                  <p className="font-medium text-foreground mb-1">Originele tekst:</p>
                                                  <p className="text-muted-foreground line-clamp-3">{change.original}</p>
                                                </div>
                                              )}
                                            </AlertDialogDescription>
                                          </AlertDialogHeader>
                                          <AlertDialogFooter>
                                            <AlertDialogCancel>Annuleren</AlertDialogCancel>
                                            <AlertDialogAction
                                              onClick={() => rollbackMutation.mutate({ stageId: stage.stageId, changeIndex: idx })}
                                              className="bg-orange-600 hover:bg-orange-700"
                                            >
                                              <Undo2 className="h-4 w-4 mr-2" />
                                              Ja, terugdraaien
                                            </AlertDialogAction>
                                          </AlertDialogFooter>
                                        </AlertDialogContent>
                                      </AlertDialog>
                                    )}
                                  </div>

                                  {/* Section indicator */}
                                  {change.section && (
                                    <div className="text-xs text-muted-foreground mb-2 font-medium">
                                      📍 {change.section}
                                    </div>
                                  )}

                                  {/* Original → New diff view (when original differs from description) */}
                                  {change.original && change.original.length > 0 && change.original !== change.description ? (
                                    <div className="space-y-2">
                                      {/* Original text (strikethrough) */}
                                      <div className="flex items-start gap-2">
                                        <span className="text-xs font-medium text-red-600 dark:text-red-400 shrink-0 mt-0.5">Oud:</span>
                                        <p className={`text-sm text-red-700 dark:text-red-300 ${isRolledBack ? '' : 'line-through opacity-75'}`}>
                                          {change.original}
                                        </p>
                                      </div>
                                      {!isRolledBack && (
                                        <>
                                          {/* Arrow separator */}
                                          <div className="flex items-center gap-2 pl-6">
                                            <ArrowRight className="h-3 w-3 text-muted-foreground" />
                                          </div>
                                          {/* New text */}
                                          <div className="flex items-start gap-2">
                                            <span className="text-xs font-medium text-green-600 dark:text-green-400 shrink-0 mt-0.5">Nieuw:</span>
                                            <p className="text-sm text-green-700 dark:text-green-300 font-medium">
                                              {change.description}
                                            </p>
                                          </div>
                                        </>
                                      )}
                                    </div>
                                  ) : (
                                    /* Description only (no diff available) */
                                    <p className={`text-sm leading-relaxed ${isRolledBack ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                                      {change.description}
                                    </p>
                                  )}

                                  {/* Reasoning (why this change was made) */}
                                  {change.reasoning && change.reasoning !== change.description && !isRolledBack && (
                                    <div className="mt-3 pt-2 border-t border-dashed border-muted-foreground/30">
                                      <div className="flex items-start gap-2">
                                        <MessageSquare className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
                                        <p className="text-xs text-muted-foreground italic">
                                          {change.reasoning}
                                        </p>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
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
                  <div className="prose prose-sm max-w-none dark:prose-invert">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        h1: ({ children }) => (
                          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mt-6 mb-3 border-b border-primary/30 pb-2">
                            {children}
                          </h1>
                        ),
                        h2: ({ children }) => (
                          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100 mt-5 mb-3 border-b border-gray-200 dark:border-gray-700 pb-1">
                            {children}
                          </h2>
                        ),
                        h3: ({ children }) => (
                          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 mt-4 mb-2">
                            {children}
                          </h3>
                        ),
                        p: ({ children }) => (
                          <p className="mb-3 text-gray-700 dark:text-gray-300 leading-relaxed text-sm">
                            {children}
                          </p>
                        ),
                        ul: ({ children }) => (
                          <ul className="mb-3 list-disc list-outside ml-5 space-y-1 text-sm">
                            {children}
                          </ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="mb-3 list-decimal list-outside ml-5 space-y-1 text-sm">
                            {children}
                          </ol>
                        ),
                        li: ({ children }) => (
                          <li className="text-gray-700 dark:text-gray-300">
                            {children}
                          </li>
                        ),
                        strong: ({ children }) => (
                          <strong className="font-semibold text-gray-900 dark:text-gray-100">
                            {children}
                          </strong>
                        ),
                        table: ({ children }) => (
                          <div className="overflow-x-auto mb-3">
                            <table className="min-w-full divide-y divide-gray-300 dark:divide-gray-700 text-sm">
                              {children}
                            </table>
                          </div>
                        ),
                        thead: ({ children }) => (
                          <thead className="bg-gray-50 dark:bg-gray-800">
                            {children}
                          </thead>
                        ),
                        tbody: ({ children }) => (
                          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                            {children}
                          </tbody>
                        ),
                        th: ({ children }) => (
                          <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                            {children}
                          </th>
                        ),
                        td: ({ children }) => (
                          <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">
                            {children}
                          </td>
                        ),
                        blockquote: ({ children }) => (
                          <blockquote className="border-l-4 border-primary/50 pl-3 italic my-3 text-gray-600 dark:text-gray-400 text-sm">
                            {children}
                          </blockquote>
                        ),
                        hr: () => (
                          <hr className="my-4 border-gray-200 dark:border-gray-700" />
                        ),
                      }}
                    >
                      {displayedContent}
                    </ReactMarkdown>
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
