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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  CheckCircle,
  Eye,
  EyeOff,
  ChevronRight,
  ChevronDown,
  Copy,
  Check,
  MessageSquare,
  Clock,
  ArrowRight,
  Send,
  FileText,
  Zap,
  RefreshCw,
  Info,
  Edit3,
  Activity,
  Wand2,
  PenTool,
  AlertTriangle
} from "lucide-react";
import { useState } from "react";
import { InformatieCheckViewer } from "./InformatieCheckViewer";
import { ComplexiteitsCheckViewer } from "./ComplexiteitsCheckViewer";
import { SimpleFeedbackProcessor } from "./SimpleFeedbackProcessor";
import { normalizePromptToString } from "@/lib/promptUtils";

export interface WorkflowStageCardProps {
  stageKey: string;
  stageName: string;
  stageIcon: React.ReactNode;
  stageStatus: 'idle' | 'processing' | 'completed' | 'blocked' | 'error';
  isExpanded: boolean;
  onToggleExpand: () => void;

  // Content
  stageResult?: string;
  stagePrompt?: string;
  conceptVersion?: string;
  reportId?: string;

  // Controls
  canExecute: boolean;
  isProcessing: boolean;
  onExecute: () => void;

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
}

export function WorkflowStageCard({
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
  canExecute,
  isProcessing,
  onExecute,
  progress,
  isInputCollapsed,
  isOutputCollapsed,
  isPromptCollapsed,
  onToggleInput,
  onToggleOutput,
  onTogglePrompt,
  showFeedbackProcessor,
  onFeedbackProcessed,
  blockReason
}: WorkflowStageCardProps) {
  const [copied, setCopied] = useState(false);

  // Get status badge - Using JdB theme colors
  const getStatusBadge = () => {
    switch (stageStatus) {
      case 'completed':
        return <Badge variant="success"><CheckCircle className="w-3 h-3 mr-1" />Voltooid</Badge>;
      case 'processing':
        return <Badge className="bg-jdb-blue-primary text-white animate-pulse"><Activity className="w-3 h-3 mr-1" />Bezig...</Badge>;
      case 'blocked':
        return <Badge variant="warning"><AlertTriangle className="w-3 h-3 mr-1" />Geblokkeerd</Badge>;
      case 'error':
        return <Badge variant="destructive"><AlertTriangle className="w-3 h-3 mr-1" />Fout</Badge>;
      default:
        return <Badge variant="outline" className="text-jdb-text-subtle"><Clock className="w-3 h-3 mr-1" />Nog niet gestart</Badge>;
    }
  };

  // Copy to clipboard
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className={`
      ${stageStatus === 'completed' ? 'border-jdb-success/30 bg-green-50/30 dark:bg-green-950/10' : ''}
      ${stageStatus === 'processing' ? 'border-jdb-blue-primary/30 bg-jdb-blue-light/30 dark:bg-jdb-blue-primary/10 shadow-lg' : ''}
      ${stageStatus === 'blocked' ? 'border-jdb-warning/30 bg-amber-50/30 dark:bg-amber-950/10' : ''}
      ${stageStatus === 'error' ? 'border-jdb-danger/30 bg-red-50/30 dark:bg-red-950/10' : ''}
      transition-all duration-300
    `}>
      <CardHeader className="cursor-pointer hover:bg-jdb-bg/50 dark:hover:bg-jdb-border/10 transition-colors" onClick={onToggleExpand}>
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
              {/* Action Buttons */}
              <div className="flex gap-2">
                <Button
                  onClick={onExecute}
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
                      Opnieuw uitvoeren
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 mr-2" />
                      Uitvoeren
                    </>
                  )}
                </Button>
              </div>

              {/* Input Section */}
              <div className="border border-jdb-border rounded-lg">
                <button
                  onClick={onToggleInput}
                  className="w-full px-4 py-3 min-h-[44px] flex items-center justify-between hover:bg-jdb-bg dark:hover:bg-jdb-border/10 transition-colors focus:outline-none focus:ring-2 focus:ring-jdb-blue-primary focus:ring-offset-2 rounded-lg"
                >
                  <span className="font-medium text-sm flex items-center gap-2 text-jdb-text-heading">
                    <FileText className="w-4 h-4" />
                    Input
                  </span>
                  {isInputCollapsed ? <ChevronRight className="w-4 h-4 text-jdb-text-subtle" /> : <ChevronDown className="w-4 h-4 text-jdb-text-subtle" />}
                </button>
                {!isInputCollapsed && (
                  <div className="px-4 py-4 bg-jdb-bg/50 dark:bg-jdb-border/5 border-t border-jdb-border">
                    <p className="text-sm text-jdb-text-body">
                      Input wordt automatisch gegenereerd uit vorige stappen
                    </p>
                  </div>
                )}
              </div>

              {/* Output Section */}
              {stageResult && (
                <div className="border border-jdb-border rounded-lg">
                  <button
                    onClick={onToggleOutput}
                    className="w-full px-4 py-3 min-h-[44px] flex items-center justify-between hover:bg-jdb-bg dark:hover:bg-jdb-border/10 transition-colors focus:outline-none focus:ring-2 focus:ring-jdb-blue-primary focus:ring-offset-2 rounded-lg"
                  >
                    <span className="font-medium text-sm flex items-center gap-2 text-jdb-text-heading">
                      <MessageSquare className="w-4 h-4" />
                      Output {stageResult && `(${stageResult.length} karakters)`}
                    </span>
                    <div className="flex items-center gap-2">
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
                      {isOutputCollapsed ? <ChevronRight className="w-4 h-4 text-jdb-text-subtle" /> : <ChevronDown className="w-4 h-4 text-jdb-text-subtle" />}
                    </div>
                  </button>
                  {!isOutputCollapsed && (
                    <div className="px-4 py-4 bg-jdb-bg/50 dark:bg-jdb-border/5 border-t border-jdb-border overflow-hidden">
                      {/* Special viewers for specific stages */}
                      {stageKey === '1_informatiecheck' && <InformatieCheckViewer rawOutput={stageResult} />}
                      {stageKey === '2_complexiteitscheck' && <ComplexiteitsCheckViewer rawOutput={stageResult} />}

                      {/* Default output display */}
                      {!['1_informatiecheck', '2_complexiteitscheck'].includes(stageKey) && (
                        <div className="bg-white p-3 rounded border font-mono text-xs overflow-y-auto max-h-96 w-full">
                          <pre className="whitespace-pre-wrap break-all" style={{ wordBreak: 'break-all', overflowWrap: 'anywhere' }}>{stageResult}</pre>
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
                        <pre className="whitespace-pre-wrap text-jdb-text-body">{normalizePromptToString(stagePrompt)}</pre>
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
}
