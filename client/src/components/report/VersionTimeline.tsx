import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  GitBranch,
  CheckCircle2,
  Circle,
  Clock,
  TrendingUp,
  FileText,
  RotateCcw,
  Trash2
} from "lucide-react";

interface VersionCheckpoint {
  version: number;
  stageKey: string;
  stageName: string;
  changeCount?: number;
  timestamp?: string;
  isCurrent?: boolean;
}

interface VersionTimelineProps {
  versions: VersionCheckpoint[];
  currentVersion?: number;
  onVersionSelect?: (version: number) => void;
  onRestore?: (version: number) => void;
  onDelete?: (stageKey: string) => void;
}

export function VersionTimeline({
  versions,
  currentVersion,
  onVersionSelect,
  onRestore,
  onDelete
}: VersionTimelineProps) {
  const sortedVersions = [...versions].sort((a, b) => a.version - b.version);

  const formatTimestamp = (timestamp?: string) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleString('nl-NL', { 
      day: '2-digit', 
      month: 'short', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const getTotalChanges = () => {
    return sortedVersions.reduce((sum, v) => sum + (v.changeCount || 0), 0);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5" />
            Versie Geschiedenis
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">
              {sortedVersions.length} versies
            </Badge>
            {getTotalChanges() > 0 && (
              <Badge variant="outline">
                <TrendingUp className="h-3 w-3 mr-1" />
                {getTotalChanges()} wijzigingen
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-6">
          {/* Timeline */}
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />

            {/* Version checkpoints */}
            <div className="space-y-4">
              {sortedVersions.map((checkpoint, index) => {
                const isLast = index === sortedVersions.length - 1;
                const isCurrent = checkpoint.version === currentVersion || checkpoint.isCurrent;

                return (
                  <div key={`${checkpoint.stageKey}-${checkpoint.version}-${index}`} className="relative pl-12">
                    {/* Checkpoint marker */}
                    <div className={`absolute left-0 top-1 flex items-center justify-center w-8 h-8 rounded-full border-2 ${
                      isCurrent 
                        ? 'bg-primary border-primary' 
                        : isLast
                        ? 'bg-blue-100 border-blue-500'
                        : 'bg-background border-border'
                    }`}>
                      {isCurrent ? (
                        <CheckCircle2 className="h-5 w-5 text-primary-foreground" />
                      ) : isLast ? (
                        <Clock className="h-4 w-4 text-blue-500" />
                      ) : (
                        <Circle className="h-3 w-3 fill-muted-foreground text-muted-foreground" />
                      )}
                    </div>

                    {/* Version content */}
                    <div 
                      className={`p-4 rounded-lg border-2 transition-all cursor-pointer ${
                        isCurrent 
                          ? 'bg-primary/5 border-primary shadow-sm' 
                          : 'bg-background border-border hover:border-primary/50 hover:shadow-sm'
                      }`}
                      onClick={() => onVersionSelect?.(checkpoint.version)}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-sm">
                              {checkpoint.stageName}
                            </span>
                            {isCurrent && (
                              <Badge variant="default" className="text-xs">
                                Huidig
                              </Badge>
                            )}
                            {isLast && !isCurrent && (
                              <Badge variant="secondary" className="text-xs">
                                Nieuwste
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Stage: {checkpoint.stageKey}
                          </p>
                        </div>
                        {checkpoint.changeCount !== undefined && checkpoint.changeCount > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {checkpoint.changeCount > 0 ? '+' : ''}{checkpoint.changeCount} wijz.
                          </Badge>
                        )}
                      </div>

                      {checkpoint.timestamp && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatTimestamp(checkpoint.timestamp)}
                        </p>
                      )}

                      {/* Action buttons */}
                      <div className="mt-2 flex gap-2">
                        {!isCurrent && onRestore && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRestore(checkpoint.version);
                            }}
                          >
                            <RotateCcw className="h-3 w-3 mr-1" />
                            Herstel
                          </Button>
                        )}
                        {onDelete && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={(e) => {
                              e.stopPropagation();
                              const warningMessage = isCurrent
                                ? `⚠️ WAARSCHUWING: Je staat op het punt de HUIDIGE versie te verwijderen!\n\n` +
                                  `${checkpoint.stageName} (${checkpoint.stageKey}) + alle latere stages worden verwijderd.\n\n` +
                                  `Weet je het ZEKER?`
                                : `Weet je zeker dat je ${checkpoint.stageName} (${checkpoint.stageKey}) wilt verwijderen?\n\n` +
                                  `Dit verwijdert ook alle latere stages.`;

                              const confirmed = window.confirm(warningMessage);
                              if (confirmed) {
                                onDelete(checkpoint.stageKey);
                              }
                            }}
                          >
                            <Trash2 className="h-3 w-3 mr-1" />
                            Verwijder
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Summary card */}
          {sortedVersions.length > 0 && (
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <FileText className="h-4 w-4" />
                <span>Rapport Evolutie</span>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-primary">
                    v{sortedVersions[0]?.version || 1}
                  </p>
                  <p className="text-xs text-muted-foreground">Start</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-blue-600">
                    {sortedVersions.length - 1}
                  </p>
                  <p className="text-xs text-muted-foreground">Review rondes</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-green-600">
                    v{sortedVersions[sortedVersions.length - 1]?.version || 1}
                  </p>
                  <p className="text-xs text-muted-foreground">Huidig</p>
                </div>
              </div>
            </div>
          )}

          {sortedVersions.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <GitBranch className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>Nog geen versies beschikbaar</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Compact horizontal timeline for inline use
interface CompactTimelineProps {
  versions: VersionCheckpoint[];
  currentVersion?: number;
}

export function CompactVersionTimeline({ versions, currentVersion }: CompactTimelineProps) {
  const sortedVersions = [...versions].sort((a, b) => a.version - b.version);

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-2">
      {sortedVersions.map((checkpoint, index) => {
        const isCurrent = checkpoint.version === currentVersion || checkpoint.isCurrent;
        const isLast = index === sortedVersions.length - 1;

        return (
          <div key={`${checkpoint.stageKey}-${checkpoint.version}-${index}`} className="flex items-center">
            {/* Version bubble */}
            <div 
              className={`flex flex-col items-center min-w-[80px] ${
                isCurrent ? 'scale-110' : ''
              }`}
            >
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                  isCurrent
                    ? 'bg-primary border-primary text-primary-foreground font-bold'
                    : 'bg-background border-border text-muted-foreground'
                }`}
              >
                <span className="text-[10px] font-semibold">{checkpoint.stageKey.split('_')[0]}</span>
              </div>
              <p className="text-xs text-center mt-1 text-muted-foreground truncate max-w-[80px]" title={checkpoint.stageName}>
                {checkpoint.stageName.split(' v')[0].split(' ').slice(-2).join(' ')}
              </p>
              {checkpoint.changeCount !== undefined && checkpoint.changeCount > 0 && (
                <Badge variant="secondary" className="text-xs mt-1">
                  +{checkpoint.changeCount}
                </Badge>
              )}
            </div>

            {/* Arrow */}
            {!isLast && (
              <div className="px-2">
                <div className="h-0.5 w-8 bg-border" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
