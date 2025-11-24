/**
 * WorkflowStageCard - Individual Stage Rendering Component
 *
 * Extracted from SimplifiedWorkflowView to reduce complexity.
 * Responsible for rendering a single workflow stage with:
 * - Stage status badge
 * - Expand/collapse controls
 * - Input/Output/Prompt sections
 * - Action buttons (execute, manual mode, streaming)
 * - Progress tracking
 *
 * Part of the SimplifiedWorkflowView refactor (2024-01-08)
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  CheckCircle,
  ChevronRight,
  ChevronDown,
  Copy,
  Check,
  MessageSquare,
  Clock,
  FileText,
  RefreshCw,
  Activity,
  Wand2,
  AlertTriangle,
  Code2,
  Sparkles,
  ExternalLink,
  Trash2
} from "lucide-react";
import { useState, useCallback, useMemo, memo } from "react";
import { InformatieCheckViewer } from "./InformatieCheckViewer";
import { ComplexiteitsCheckViewer } from "./ComplexiteitsCheckViewer";
import { SimpleFeedbackProcessor } from "./SimpleFeedbackProcessor";
import { normalizePromptToString } from "@/lib/promptUtils";
import { getSamenvattingFromStage1 } from "@/lib/workflowParsers";

export interface WorkflowStageCardProps {
  stageKey: string;
  stageName: string;
  stageIcon: React.ReactNode;
  stageStatus: 'idle' | 'processing' | 'completed' | 'blocked' | 'error' | 'feedback_ready';
  isExpanded: boolean;
  onToggleExpand: () => void;

  // Content
  stageResult?: string;
  stagePrompt?: string;
  conceptVersion?: string;
  reportId?: string;
  stage1Result?: string; // For Stage 2 to access Stage 1 data

  // Controls
  canExecute: boolean;
  isProcessing: boolean;
  onExecute: (customContext?: string) => void; // 🔥 NEW: Support custom context for re-runs
  onForceContinue?: () => void; // For stage 1 when incomplete
  onResetStage?: () => void; // Reset/clear stage results

  // Progress
  progress?: {
    progress: number;
    status: string;
    startTime?: number;
    estimatedTime?: number;
  };

  // Collapsible sections
  isInputCollapsed: boolean;
  isOutputCollapsed: boolean;
  isPromptCollapsed: boolean;
  onToggleInput: () => void;
  onToggleOutput: () => void;
  onTogglePrompt: () => void;

  // Optional features
  showFeedbackProcessor?: boolean;
  onFeedbackProcessed?: (response: any) => void;
  blockReason?: string;

  // Manual mode (for stage 3 - deep research)
  manualMode?: 'ai' | 'manual';
  onToggleManualMode?: (mode: 'ai' | 'manual') => void;
  manualContent?: string;
  onManualContentChange?: (content: string) => void;
  onManualExecute?: () => void;
}

export const WorkflowStageCard = memo(function WorkflowStageCard({
  stageKey,
  stageName,
  stageIcon,
  stageStatus,
  isExpanded,
  onToggleExpand,
  stageResult,
  stagePrompt,
  conceptVersion,
  reportId,
  stage1Result,
  canExecute,
  isProcessing,
  onExecute,
  onForceContinue,
  onResetStage,
  progress,
  isInputCollapsed,
  isOutputCollapsed,
  isPromptCollapsed,
  onToggleInput,
  onToggleOutput,
  onTogglePrompt,
  showFeedbackProcessor,
  onFeedbackProcessed,
  blockReason,
  manualMode = 'ai',
  onToggleManualMode,
  manualContent = '',
  onManualContentChange,
  onManualExecute
}: WorkflowStageCardProps) {
  const [copied, setCopied] = useState(false);
  const [isRawInputCollapsed, setIsRawInputCollapsed] = useState(true);
  const [customContext, setCustomContext] = useState('');
  const [showCustomContext, setShowCustomContext] = useState(false);

  // Check if this stage supports manual mode (stage 3, 4a, 4b)
  const supportsManualMode = useMemo(() => [
    '3_generatie',
    '4a_BronnenSpecialist',
    '4b_FiscaalTechnischSpecialist'
  ].includes(stageKey), [stageKey]);

  // Handler for executing stage with optional custom context
  const handleExecuteClick = useCallback(() => {
    onExecute(customContext.trim() || undefined);
  }, [onExecute, customContext]);

  // Get status badge - Using JdB theme colors
  const getStatusBadge = useCallback(() => {
    switch (stageStatus) {
      case 'completed':
        return <Badge variant="success"><CheckCircle className="w-3 h-3 mr-1" />Voltooid</Badge>;
      case 'feedback_ready':
        return <Badge className="bg-orange-500 text-white"><Sparkles className="w-3 h-3 mr-1" />Review Beschikbaar</Badge>;
      case 'processing':
        return <Badge className="bg-jdb-blue-primary text-white"><Activity className="w-3 h-3 mr-1 animate-spin" />Bezig...</Badge>;
      case 'blocked':
        return <Badge variant="warning"><AlertTriangle className="w-3 h-3 mr-1" />Geblokkeerd</Badge>;
      case 'error':
        return <Badge variant="destructive"><AlertTriangle className="w-3 h-3 mr-1" />Fout</Badge>;
      default:
        return <Badge variant="outline" className="text-jdb-text-subtle"><Clock className="w-3 h-3 mr-1" />Nog niet gestart</Badge>;
    }
  }, [stageStatus]);

  // Copy to clipboard
  const handleCopy = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  return (
    <Card className={`
      ${stageStatus === 'completed' ? 'border-jdb-success/30 bg-green-50/30 dark:bg-green-950/10' : ''}
      ${stageStatus === 'feedback_ready' ? 'border-orange-400/50 bg-orange-50/40 dark:bg-orange-950/20 shadow-md' : ''}
      ${stageStatus === 'processing' ? 'border-jdb-blue-primary/30 bg-jdb-blue-light/30 dark:bg-jdb-blue-primary/10 shadow-lg' : ''}
      ${stageStatus === 'blocked' ? 'border-jdb-warning/30 bg-amber-50/30 dark:bg-amber-950/10' : ''}
      ${stageStatus === 'error' ? 'border-jdb-danger/30 bg-red-50/30 dark:bg-red-950/10' : ''}
      transition-all duration-300
    `}>
      <CardHeader
        className="cursor-pointer hover:bg-jdb-bg/50 dark:hover:bg-jdb-border/10 transition-colors"
        onClick={onToggleExpand}
        role="button"
        aria-expanded={isExpanded}
        aria-label={`${stageName} - ${isExpanded ? 'Inklappen' : 'Uitklappen'}`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleExpand();
          }
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {isExpanded ? <ChevronDown className="w-5 h-5 text-jdb-text-subtle" /> : <ChevronRight className="w-5 h-5 text-jdb-text-subtle" />}
            <div className="p-2 bg-jdb-blue-light dark:bg-jdb-blue-primary/10 rounded-lg">
              {stageIcon}
            </div>
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                {stageName}
              </CardTitle>
              <p className="text-xs text-jdb-text-subtle mt-1">{stageKey}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {getStatusBadge()}
          </div>
        </div>

        {/* Progress Bar */}
        {isProcessing && progress && (
          <div className="mt-3 space-y-2">
            <Progress value={progress.progress} className="h-2" />
            <div className="flex justify-between text-xs text-gray-500">
              <span>{progress.status}</span>
              {progress.estimatedTime && <span>~{Math.ceil(progress.estimatedTime / 1000)}s resterend</span>}
            </div>
          </div>
        )}

        {/* Block Reason */}
        {stageStatus === 'blocked' && blockReason && (
          <div className="mt-2 p-2 bg-orange-100 border border-orange-300 rounded text-sm text-orange-800">
            <AlertTriangle className="w-4 h-4 inline mr-2" />
            {blockReason}
          </div>
        )}
      </CardHeader>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            <CardContent className="space-y-4">
              {/* Manual Mode Toggle for Stage 3 */}
              {supportsManualMode && onToggleManualMode && (
                <div className="bg-amber-50 dark:bg-amber-950/20 border-2 border-amber-200 dark:border-amber-800 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <Sparkles className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-3">
                      <div>
                        <h4 className="font-semibold text-sm text-amber-900 dark:text-amber-100">Deep Research Mode</h4>
                        <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                          Deze stap vereist diepgaand onderzoek. Kies hoe je deze stap wilt uitvoeren:
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          onClick={() => onToggleManualMode('ai')}
                          variant={manualMode === 'ai' ? 'default' : 'outline'}
                          size="sm"
                          className="flex-1"
                        >
                          <Activity className="w-4 h-4 mr-2" />
                          AI Automatisch
                        </Button>
                        <Button
                          onClick={() => onToggleManualMode('manual')}
                          variant={manualMode === 'manual' ? 'default' : 'outline'}
                          size="sm"
                          className="flex-1"
                        >
                          <ExternalLink className="w-4 h-4 mr-2" />
                          Handmatig (Gemini Deep Research)
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Manual Mode Interface */}
              {supportsManualMode && manualMode === 'manual' && (
                <div className="bg-blue-50 dark:bg-blue-950/20 border-2 border-blue-200 dark:border-blue-800 rounded-lg p-4 space-y-4">
                  {stagePrompt && (
                    <>
                      <div className="flex items-start gap-3">
                        <ExternalLink className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <h4 className="font-semibold text-sm text-blue-900 dark:text-blue-100">Kopieer de prompt</h4>
                          <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                            Kopieer onderstaande prompt en plak deze in de Gemini Deep Research interface
                          </p>
                        </div>
                      </div>

                      <div className="bg-white dark:bg-gray-900 rounded-lg border-2 border-blue-300 dark:border-blue-700 overflow-hidden w-full">
                        <div className="p-3 border-b border-blue-200 dark:border-blue-800 flex items-center justify-between">
                          <span className="text-xs font-medium text-blue-900 dark:text-blue-100">Prompt voor Gemini Deep Research</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopy(normalizePromptToString(stagePrompt))}
                            className="h-8 flex-shrink-0"
                          >
                            {copied ? (
                              <>
                                <Check className="w-4 h-4 mr-2" />
                                Gekopieerd!
                              </>
                            ) : (
                              <>
                                <Copy className="w-4 h-4 mr-2" />
                                Kopieer Prompt
                              </>
                            )}
                          </Button>
                        </div>
                        <div className="p-4 max-h-[400px] overflow-y-auto w-full">
                          <pre className="text-xs font-mono text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-all w-full min-w-0" style={{wordBreak: 'break-all', overflowWrap: 'anywhere'}}>
                            {normalizePromptToString(stagePrompt)}
                          </pre>
                        </div>
                      </div>
                    </>
                  )}

                  <div className="flex items-start gap-3 pt-2">
                    <ExternalLink className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-3">
                      <div>
                        <h4 className="font-semibold text-sm text-blue-900 dark:text-blue-100">Plak het resultaat van Gemini Deep Research</h4>
                        <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                          Nadat je de prompt in Gemini Deep Research hebt gebruikt, plak het resultaat hieronder
                        </p>
                      </div>
                      <Textarea
                        value={manualContent}
                        onChange={(e) => onManualContentChange?.(e.target.value)}
                        placeholder="Plak hier het resultaat van Gemini Deep Research..."
                        className="min-h-[200px] font-mono text-sm"
                      />
                      <Button
                        onClick={onManualExecute}
                        disabled={!manualContent.trim() || isProcessing}
                        className="w-full"
                        size="lg"
                      >
                        {isProcessing ? (
                          <>
                            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                            Verwerken...
                          </>
                        ) : (
                          <>
                            <CheckCircle className="w-4 h-4 mr-2" />
                            {stageName} Voltooien met Dit Resultaat
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Action Buttons - Only show for AI mode or non-manual stages */}
              {(!supportsManualMode || manualMode === 'ai') && (
                <div className="space-y-3">
                  {/* Custom Context Section - Always show when stage can execute */}
                  {canExecute && (
                    <div className="bg-purple-50 dark:bg-purple-950/20 border-2 border-purple-200 dark:border-purple-800 rounded-lg p-4">
                      <button
                        onClick={() => setShowCustomContext(!showCustomContext)}
                        className="w-full flex items-center justify-between text-left"
                      >
                        <div className="flex items-start gap-3">
                          <MessageSquare className="w-5 h-5 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <h4 className="font-semibold text-sm text-purple-900 dark:text-purple-100">
                              {stageStatus === 'completed' ? 'Extra Context voor Re-run (optioneel)' : 'Extra Context (optioneel)'}
                            </h4>
                            <p className="text-xs text-purple-700 dark:text-purple-300 mt-1">
                              Voeg extra instructies of context toe die de AI moet gebruiken
                            </p>
                          </div>
                        </div>
                        {showCustomContext ? <ChevronDown className="w-5 h-5 text-purple-600" /> : <ChevronRight className="w-5 h-5 text-purple-600" />}
                      </button>

                      {showCustomContext && (
                        <div className="mt-3 space-y-3">
                          <Textarea
                            value={customContext}
                            onChange={(e) => setCustomContext(e.target.value)}
                            placeholder="Bijv: 'De klant heeft bevestigd dat het vermogen €500k is, niet €300k zoals eerder vermeld. Neem dit mee in de analyse.'"
                            className="min-h-[100px] text-sm"
                          />
                          <div className="flex items-start gap-2 text-xs text-purple-700 dark:text-purple-300">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                            <p>
                              Deze context wordt toegevoegd aan de originele prompt. De AI zal rekening houden met deze extra informatie.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      onClick={handleExecuteClick}
                      disabled={!canExecute || isProcessing}
                      className="flex-1"
                      variant={stageStatus === 'completed' ? 'outline' : 'default'}
                    >
                      {isProcessing ? (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                          Bezig...
                        </>
                      ) : stageStatus === 'completed' ? (
                        <>
                          <RefreshCw className="w-4 h-4 mr-2" />
                          {customContext.trim() ? 'Opnieuw uitvoeren met Extra Context' : 'Opnieuw uitvoeren'}
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 mr-2" />
                          Uitvoeren
                        </>
                      )}
                    </Button>

                    {/* Reset Stage Button - Only show if stage is completed and onResetStage is provided */}
                    {stageStatus === 'completed' && onResetStage && (
                      <Button
                        onClick={onResetStage}
                        disabled={isProcessing}
                        variant="outline"
                        size="icon"
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                        title="Wis stage resultaat om opnieuw uit te voeren"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {/* Raw LLM Input Preview - Only show if prompt exists */}
              {stagePrompt && (
                <div className="border-2 border-jdb-blue-primary/30 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 overflow-hidden max-w-full">
                  <button
                    onClick={() => setIsRawInputCollapsed(!isRawInputCollapsed)}
                    className="w-full px-4 py-3 min-h-[44px] flex items-center justify-between hover:bg-blue-100/50 dark:hover:bg-blue-950/30 transition-colors focus:outline-none focus:ring-2 focus:ring-jdb-blue-primary focus:ring-offset-2 rounded-lg"
                  >
                    <span className="font-medium text-sm flex items-center gap-2 text-jdb-blue-primary">
                      <Code2 className="w-4 h-4" />
                      Raw LLM Input Preview (voor verificatie)
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs bg-white">
                        {stagePrompt.length.toLocaleString()} chars
                      </Badge>
                      {isRawInputCollapsed ? <ChevronRight className="w-4 h-4 text-jdb-blue-primary" /> : <ChevronDown className="w-4 h-4 text-jdb-blue-primary" />}
                    </div>
                  </button>
                  {!isRawInputCollapsed && (
                    <div className="px-4 py-4 bg-white dark:bg-jdb-panel border-t-2 border-jdb-blue-primary/30 max-w-full">
                      <div className="mb-2 flex items-center justify-between">
                        <p className="text-xs text-jdb-text-subtle font-medium">
                          Dit is exact wat naar de LLM wordt gestuurd - controleer of concept rapport + feedback beide aanwezig zijn
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCopy(normalizePromptToString(stagePrompt))}
                          className="min-h-[36px] min-w-[36px]"
                        >
                          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        </Button>
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg border border-gray-300 dark:border-gray-700 font-mono text-xs overflow-x-auto overflow-y-auto max-h-[500px] max-w-full">
                        <pre className="whitespace-pre-wrap break-words text-gray-800 dark:text-gray-200" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', maxWidth: '100%' }}>{normalizePromptToString(stagePrompt)}</pre>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Output Section */}
              {stageResult && (
                <div className="border border-jdb-border rounded-lg overflow-hidden max-w-full">
                  <div className="w-full px-4 py-3 min-h-[44px] flex items-center justify-between">
                    <button
                      onClick={onToggleOutput}
                      className="flex-1 flex items-center gap-2 text-left hover:opacity-80 transition-opacity focus:outline-none focus:ring-2 focus:ring-jdb-blue-primary focus:ring-offset-2 rounded"
                    >
                      <span className="font-medium text-sm flex items-center gap-2 text-jdb-text-heading">
                        <MessageSquare className="w-4 h-4" />
                        Output {stageResult && `(${stageResult.length} karakters)`}
                      </span>
                      {isOutputCollapsed ? <ChevronRight className="w-4 h-4 text-jdb-text-subtle" /> : <ChevronDown className="w-4 h-4 text-jdb-text-subtle" />}
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopy(stageResult);
                      }}
                      className="min-h-[44px] min-w-[44px]"
                    >
                      {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                  {!isOutputCollapsed && (
                    <div className="px-4 py-4 bg-jdb-bg/50 dark:bg-jdb-border/5 border-t border-jdb-border overflow-hidden max-w-full">
                      {/* Special viewers for specific stages */}
                      {stageKey === '1_informatiecheck' && (
                        <InformatieCheckViewer
                          rawOutput={stageResult}
                          onForceContinue={onForceContinue}
                        />
                      )}
                      {stageKey === '2_complexiteitscheck' && (
                        <ComplexiteitsCheckViewer
                          rawOutput={stageResult}
                          samenvatting={getSamenvattingFromStage1(stage1Result) || undefined}
                        />
                      )}

                      {/* Default output display */}
                      {!['1_informatiecheck', '2_complexiteitscheck'].includes(stageKey) && (
                        <div className="bg-white dark:bg-gray-900 p-3 rounded border border-gray-300 dark:border-gray-700 font-mono text-xs overflow-x-auto overflow-y-auto max-h-96 w-full max-w-full">
                          <pre className="whitespace-pre-wrap break-words text-gray-800 dark:text-gray-200" style={{ wordBreak: 'break-word', overflowWrap: 'anywhere', maxWidth: '100%' }}>{stageResult}</pre>
                        </div>
                      )}

                      {/* Feedback Processor for reviewer stages */}
                      {showFeedbackProcessor && reportId && (
                        <div className="mt-4">
                          <SimpleFeedbackProcessor
                            reportId={reportId}
                            stageId={stageKey}
                            stageName={stageName}
                            rawFeedback={stageResult}
                            onProcessingComplete={onFeedbackProcessed}
                            manualMode={manualMode}
                            onToggleManualMode={onToggleManualMode}
                            manualContent={manualContent}
                            onManualContentChange={onManualContentChange}
                            onManualExecute={onManualExecute}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Prompt Section */}
              {stagePrompt && (
                <div className="border border-jdb-border rounded-lg">
                  <button
                    onClick={onTogglePrompt}
                    className="w-full px-4 py-3 min-h-[44px] flex items-center justify-between hover:bg-jdb-bg dark:hover:bg-jdb-border/10 transition-colors focus:outline-none focus:ring-2 focus:ring-jdb-blue-primary focus:ring-offset-2 rounded-lg"
                  >
                    <span className="font-medium text-sm flex items-center gap-2 text-jdb-text-heading">
                      <Wand2 className="w-4 h-4" />
                      Gebruikte Prompt
                    </span>
                    {isPromptCollapsed ? <ChevronRight className="w-4 h-4 text-jdb-text-subtle" /> : <ChevronDown className="w-4 h-4 text-jdb-text-subtle" />}
                  </button>
                  {!isPromptCollapsed && (
                    <div className="px-4 py-4 bg-jdb-bg/50 dark:bg-jdb-border/5 border-t border-jdb-border">
                      <div className="bg-white dark:bg-jdb-panel p-4 rounded-lg border border-jdb-border font-mono text-xs overflow-auto max-h-96">
                        <pre className="whitespace-pre-wrap break-all text-jdb-text-body" style={{ wordBreak: 'break-all', overflowWrap: 'anywhere' }}>{normalizePromptToString(stagePrompt)}</pre>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
});
