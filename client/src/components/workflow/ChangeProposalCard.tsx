import { useState, lazy, Suspense } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2,
  XCircle,
  Edit3,
  AlertTriangle,
  Info,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  Loader2
} from "lucide-react";

// Lazy load diff viewer - only loads when proposal card is expanded with diff view
const ReactDiffViewer = lazy(() => import('react-diff-viewer-continued'));
import { DiffMethod } from 'react-diff-viewer-continued';

// Import ChangeProposal type from shared module
import type { ChangeProposal } from '@shared/lib/parse-feedback';

// Re-export for backwards compatibility
export type { ChangeProposal } from '@shared/lib/parse-feedback';

interface ChangeProposalCardProps {
  proposal: ChangeProposal;
  onDecision: (proposalId: string, decision: 'accept' | 'reject' | 'modify', note?: string) => void;
  showDiff?: boolean;
}

export function ChangeProposalCard({ 
  proposal, 
  onDecision,
  showDiff = true 
}: ChangeProposalCardProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isModifying, setIsModifying] = useState(false);
  const [modificationNote, setModificationNote] = useState(proposal.userNote || "");

  const getSeverityIcon = () => {
    switch (proposal.severity) {
      case 'critical':
        return <AlertTriangle className="h-4 w-4 text-red-500" />;
      case 'important':
        return <Info className="h-4 w-4 text-blue-500" />;
      case 'suggestion':
        return <Lightbulb className="h-4 w-4 text-amber-500" />;
    }
  };

  const getSeverityLabel = () => {
    switch (proposal.severity) {
      case 'critical':
        return 'Kritiek';
      case 'important':
        return 'Belangrijk';
      case 'suggestion':
        return 'Suggestie';
    }
  };

  const getSeverityColor = () => {
    switch (proposal.severity) {
      case 'critical':
        return 'bg-red-50 dark:bg-red-950/20 text-red-900 dark:text-red-100 border-red-300 dark:border-red-800';
      case 'important':
        return 'bg-blue-50 dark:bg-blue-950/20 text-blue-900 dark:text-blue-100 border-blue-300 dark:border-blue-800';
      case 'suggestion':
        return 'bg-yellow-50 dark:bg-yellow-950/20 text-yellow-900 dark:text-yellow-100 border-yellow-300 dark:border-yellow-800';
    }
  };

  const getChangeTypeLabel = () => {
    switch (proposal.changeType) {
      case 'add':
        return 'Toevoegen';
      case 'modify':
        return 'Wijzigen';
      case 'delete':
        return 'Verwijderen';
      case 'restructure':
        return 'Herstructureren';
    }
  };

  const handleAccept = () => {
    onDecision(proposal.id, 'accept');
  };

  const handleReject = () => {
    onDecision(proposal.id, 'reject');
  };

  const handleModify = () => {
    if (isModifying) {
      onDecision(proposal.id, 'modify', modificationNote);
      setIsModifying(false);
    } else {
      setIsModifying(true);
    }
  };

  const isDecided = !!proposal.userDecision;

  return (
    <Card className={`${getSeverityColor()} border transition-all ${isDecided ? 'opacity-50' : ''}`}>
      <CardHeader className="py-2.5 px-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <span className="flex-shrink-0">{getSeverityIcon()}</span>
            <div className="flex items-center gap-1.5 flex-wrap min-w-0">
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">
                {getSeverityLabel()}
              </Badge>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
                {getChangeTypeLabel()}
              </Badge>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5">
                {proposal.specialist}
              </Badge>
            </div>
            {isDecided && (
              <Badge
                variant={proposal.userDecision === 'accept' ? 'default' : 'destructive'}
                className="text-[10px] px-1.5 py-0 h-5 ml-auto flex-shrink-0"
              >
                {proposal.userDecision === 'accept' ? '✓' :
                 proposal.userDecision === 'reject' ? '✗' : '✎'}
              </Badge>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 flex-shrink-0"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <p className="text-xs text-foreground/80 mt-1 truncate pl-7">
          {proposal.section}
        </p>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-3 pt-0 px-3 pb-3">
          {/* Reasoning - compact */}
          <div className="bg-background/50 dark:bg-gray-800/50 px-2.5 py-2 rounded border border-gray-200/50 dark:border-gray-700/50">
            <p className="text-[11px] font-medium text-muted-foreground mb-0.5">Reden:</p>
            <p className="text-xs text-foreground/80 leading-relaxed">{proposal.reasoning}</p>
          </div>

          {/* Diff View - compact */}
          {showDiff && proposal.changeType !== 'add' && (
            <div className="border rounded overflow-hidden bg-background dark:bg-gray-900 text-xs">
              <Suspense fallback={
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="ml-2 text-xs text-muted-foreground">Laden...</span>
                </div>
              }>
                <ReactDiffViewer
                  oldValue={proposal.original}
                  newValue={proposal.proposed}
                  splitView={false}
                  compareMethod={DiffMethod.WORDS}
                  hideLineNumbers={true}
                  showDiffOnly={true}
                  styles={{
                    contentText: {
                      fontSize: '12px',
                      lineHeight: '1.4',
                      fontFamily: 'ui-monospace, SFMono-Regular, SF Mono, Menlo, monospace',
                    },
                    line: {
                      padding: '2px 8px',
                    },
                    variables: {
                      light: {
                        diffViewerBackground: '#ffffff',
                        addedBackground: '#ecfdf5',
                        removedBackground: '#fef2f2',
                        wordAddedBackground: '#bbf7d0',
                        wordRemovedBackground: '#fecaca',
                      },
                      dark: {
                        diffViewerBackground: '#1f2937',
                        addedBackground: '#064e3b',
                        removedBackground: '#7f1d1d',
                        wordAddedBackground: '#065f46',
                        wordRemovedBackground: '#991b1b',
                      },
                    },
                  }}
                />
              </Suspense>
            </div>
          )}

          {/* Just show new text for additions - compact */}
          {proposal.changeType === 'add' && (
            <div className="bg-green-50/50 dark:bg-green-950/20 border border-green-200/50 dark:border-green-800/50 px-2.5 py-2 rounded">
              <p className="text-xs whitespace-pre-wrap text-foreground/80 font-mono leading-relaxed">{proposal.proposed}</p>
            </div>
          )}

          {/* Modification Note - compact */}
          {isModifying && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Jouw aanpassing:</label>
              <Textarea
                value={modificationNote}
                onChange={(e) => setModificationNote(e.target.value)}
                placeholder="Beschrijf hoe je deze wijziging wilt aanpassen..."
                rows={2}
                className="bg-background text-xs min-h-[60px]"
              />
            </div>
          )}

          {/* Show user note if decided - compact */}
          {isDecided && proposal.userNote && (
            <div className="bg-background/50 px-2.5 py-2 rounded border-l-2 border-primary">
              <p className="text-[11px] font-medium text-muted-foreground mb-0.5">Notitie:</p>
              <p className="text-xs text-foreground/80">{proposal.userNote}</p>
            </div>
          )}

          {/* Action Buttons - compact row */}
          {!isDecided && (
            <div className="flex items-center gap-1.5 pt-1">
              <Button
                variant="default"
                size="sm"
                onClick={handleAccept}
                className="flex-1 h-8 text-xs"
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                Accepteer
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleReject}
                className="flex-1 h-8 text-xs"
              >
                <XCircle className="h-3.5 w-3.5 mr-1.5" />
                Afwijzen
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleModify}
                className="flex-1 h-8 text-xs"
              >
                <Edit3 className="h-3.5 w-3.5 mr-1.5" />
                {isModifying ? 'Opslaan' : 'Aanpassen'}
              </Button>
            </div>
          )}

          {isModifying && !isDecided && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsModifying(false)}
              className="w-full h-7 text-xs"
            >
              Annuleer
            </Button>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// Bulk Action Component for managing multiple proposals
interface BulkActionsProps {
  proposals: ChangeProposal[];
  onBulkAccept: (severity: 'critical' | 'important' | 'suggestion' | 'all') => void;
  onBulkReject: (severity: 'critical' | 'important' | 'suggestion' | 'all') => void;
}

export function ChangeProposalBulkActions({ 
  proposals, 
  onBulkAccept, 
  onBulkReject 
}: BulkActionsProps) {
  const criticalCount = proposals.filter(p => p.severity === 'critical' && !p.userDecision).length;
  const importantCount = proposals.filter(p => p.severity === 'important' && !p.userDecision).length;
  const suggestionCount = proposals.filter(p => p.severity === 'suggestion' && !p.userDecision).length;
  const decidedCount = proposals.filter(p => !!p.userDecision).length;
  const totalCount = proposals.length;

  return (
    <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 border-blue-200 dark:border-blue-800">
      <CardContent className="pt-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">Overzicht Voorstellen</h3>
            <Badge variant="secondary">
              {decidedCount}/{totalCount} behandeld
            </Badge>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="text-center p-2 bg-white dark:bg-gray-900 rounded-lg border border-red-200 dark:border-red-800">
              <AlertTriangle className="h-5 w-5 text-red-500 mx-auto mb-1" />
              <p className="text-xl font-bold text-red-600 dark:text-red-400">{criticalCount}</p>
              <p className="text-xs text-muted-foreground">Kritiek</p>
            </div>
            <div className="text-center p-2 bg-white dark:bg-gray-900 rounded-lg border border-blue-200 dark:border-blue-800">
              <Info className="h-5 w-5 text-blue-500 mx-auto mb-1" />
              <p className="text-xl font-bold text-blue-600 dark:text-blue-400">{importantCount}</p>
              <p className="text-xs text-muted-foreground">Belangrijk</p>
            </div>
            <div className="text-center p-2 bg-white dark:bg-gray-900 rounded-lg border border-yellow-200 dark:border-yellow-800">
              <Lightbulb className="h-5 w-5 text-yellow-500 mx-auto mb-1" />
              <p className="text-xl font-bold text-yellow-600 dark:text-yellow-400">{suggestionCount}</p>
              <p className="text-xs text-muted-foreground">Suggestie</p>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Snelle acties:</p>
            <div className="flex flex-wrap gap-2">
              {criticalCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onBulkAccept('critical')}
                  className="border-red-300 hover:bg-red-50"
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Accepteer alle kritieke ({criticalCount})
                </Button>
              )}
              {importantCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onBulkAccept('important')}
                  className="border-blue-300 hover:bg-blue-50"
                >
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Accepteer alle belangrijke ({importantCount})
                </Button>
              )}
              {suggestionCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onBulkReject('suggestion')}
                  className="border-yellow-300 hover:bg-yellow-50"
                >
                  <XCircle className="h-4 w-4 mr-2" />
                  Wijs alle suggesties af ({suggestionCount})
                </Button>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
