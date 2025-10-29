import { useState } from "react";
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
  ChevronUp
} from "lucide-react";
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';

export interface ChangeProposal {
  id: string;
  specialist: string;
  changeType: 'add' | 'modify' | 'delete' | 'restructure';
  section: string;
  original: string;
  proposed: string;
  reasoning: string;
  severity: 'critical' | 'important' | 'suggestion';
  userDecision?: 'accept' | 'reject' | 'modify';
  userNote?: string;
}

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
        return <AlertTriangle className="h-5 w-5 text-red-500" />;
      case 'important':
        return <Info className="h-5 w-5 text-blue-500" />;
      case 'suggestion':
        return <Lightbulb className="h-5 w-5 text-yellow-500" />;
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
        return 'bg-red-100 text-red-800 border-red-300';
      case 'important':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'suggestion':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
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
    <Card className={`${getSeverityColor()} border-2 transition-all ${isDecided ? 'opacity-60' : ''}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3 flex-1">
            {getSeverityIcon()}
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="font-semibold">
                  {getSeverityLabel()}
                </Badge>
                <Badge variant="secondary">
                  {getChangeTypeLabel()}
                </Badge>
                <Badge variant="secondary">
                  {proposal.specialist}
                </Badge>
                {isDecided && (
                  <Badge 
                    variant={proposal.userDecision === 'accept' ? 'default' : 'destructive'}
                    className="ml-auto"
                  >
                    {proposal.userDecision === 'accept' ? '✅ Geaccepteerd' : 
                     proposal.userDecision === 'reject' ? '❌ Afgewezen' : 
                     '✏️ Aangepast'}
                  </Badge>
                )}
              </div>
              <div className="text-sm font-medium text-foreground">
                Sectie: {proposal.section}
              </div>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="space-y-4">
          {/* Reasoning */}
          <div className="bg-background/50 p-3 rounded-md">
            <p className="text-sm font-medium mb-1">Reden:</p>
            <p className="text-sm text-muted-foreground">{proposal.reasoning}</p>
          </div>

          {/* Diff View */}
          {showDiff && proposal.changeType !== 'add' && (
            <div className="border rounded-lg overflow-hidden bg-background">
              <ReactDiffViewer
                oldValue={proposal.original}
                newValue={proposal.proposed}
                splitView={false}
                compareMethod={DiffMethod.WORDS}
                hideLineNumbers={true}
                showDiffOnly={true}
                styles={{
                  variables: {
                    light: {
                      diffViewerBackground: '#ffffff',
                      addedBackground: '#e6ffed',
                      removedBackground: '#ffeef0',
                      wordAddedBackground: '#acf2bd',
                      wordRemovedBackground: '#fdb8c0',
                    },
                  },
                }}
              />
            </div>
          )}

          {/* Just show new text for additions */}
          {proposal.changeType === 'add' && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Nieuwe tekst:</p>
              <div className="bg-green-50 border border-green-200 p-3 rounded-md">
                <p className="text-sm whitespace-pre-wrap">{proposal.proposed}</p>
              </div>
            </div>
          )}

          {/* Modification Note */}
          {isModifying && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Jouw aanpassing:</label>
              <Textarea
                value={modificationNote}
                onChange={(e) => setModificationNote(e.target.value)}
                placeholder="Beschrijf hoe je deze wijziging wilt aanpassen..."
                rows={3}
                className="bg-background"
              />
            </div>
          )}

          {/* Show user note if decided */}
          {isDecided && proposal.userNote && (
            <div className="bg-background/50 p-3 rounded-md border-l-4 border-primary">
              <p className="text-sm font-medium mb-1">Jouw notitie:</p>
              <p className="text-sm text-muted-foreground">{proposal.userNote}</p>
            </div>
          )}

          {/* Action Buttons */}
          {!isDecided && (
            <div className="flex items-center gap-2 pt-2">
              <Button
                variant="default"
                size="sm"
                onClick={handleAccept}
                className="flex-1"
              >
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Accepteer
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleReject}
                className="flex-1"
              >
                <XCircle className="h-4 w-4 mr-2" />
                Afwijzen
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleModify}
                className="flex-1"
              >
                <Edit3 className="h-4 w-4 mr-2" />
                {isModifying ? 'Opslaan' : 'Aanpassen'}
              </Button>
            </div>
          )}

          {isModifying && !isDecided && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsModifying(false)}
              className="w-full"
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
    <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
      <CardContent className="pt-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Overzicht Voorstellen</h3>
            <Badge variant="secondary">
              {decidedCount}/{totalCount} behandeld
            </Badge>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 bg-white rounded-lg border border-red-200">
              <AlertTriangle className="h-6 w-6 text-red-500 mx-auto mb-1" />
              <p className="text-2xl font-bold text-red-600">{criticalCount}</p>
              <p className="text-xs text-muted-foreground">Kritiek</p>
            </div>
            <div className="text-center p-3 bg-white rounded-lg border border-blue-200">
              <Info className="h-6 w-6 text-blue-500 mx-auto mb-1" />
              <p className="text-2xl font-bold text-blue-600">{importantCount}</p>
              <p className="text-xs text-muted-foreground">Belangrijk</p>
            </div>
            <div className="text-center p-3 bg-white rounded-lg border border-yellow-200">
              <Lightbulb className="h-6 w-6 text-yellow-500 mx-auto mb-1" />
              <p className="text-2xl font-bold text-yellow-600">{suggestionCount}</p>
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
