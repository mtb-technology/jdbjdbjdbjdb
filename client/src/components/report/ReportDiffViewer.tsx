import { useState, useMemo, lazy, Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Eye,
  Download,
  GitCompare,
  Loader2
} from "lucide-react";

// Lazy load the heavy diff viewer library (150 KB) - only loads when user opens Timeline tab
const ReactDiffViewer = lazy(() => import('react-diff-viewer-continued').then(module => ({ default: module.default })));
const DiffMethod = { WORDS: 'WORDS' as const };

interface ReportVersion {
  version: number;
  stageKey: string;
  stageName: string;
  content: string;
  timestamp?: string;
  changeCount?: number;
}

interface ReportDiffViewerProps {
  versions: Record<string, string>; // conceptReportVersions from report
  currentStageKey?: string;
  stageNames?: Record<string, string>; // Map stage keys to readable names
  onVersionSelect?: (oldVersion: number, newVersion: number) => void;
}

export function ReportDiffViewer({ 
  versions, 
  currentStageKey,
  stageNames = {},
  onVersionSelect
}: ReportDiffViewerProps) {
  // Convert versions object to array
  const versionArray = useMemo((): ReportVersion[] => {
    const stages = Object.keys(versions).sort();
    return stages.map((stageKey, index) => {
      const versionData = versions[stageKey];
      let content: string;
      let timestamp: string | undefined;
      
      if (typeof versionData === 'string') {
        content = versionData;
      } else if (versionData && typeof versionData === 'object') {
        content = (versionData as any).content || JSON.stringify(versionData);
        timestamp = (versionData as any).timestamp;
      } else {
        content = String(versionData);
      }
      
      return {
        version: index + 1,
        stageKey,
        stageName: stageNames[stageKey] || stageKey,
        content,
        timestamp,
        changeCount: undefined // We could calculate this
      };
    });
  }, [versions, stageNames]);

  // State for version selection
  const latestVersion = versionArray.length;
  const [oldVersion, setOldVersion] = useState(Math.max(1, latestVersion - 1));
  const [newVersion, setNewVersion] = useState(latestVersion);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('split');

  // Get content for selected versions
  const oldContent = versionArray[oldVersion - 1]?.content || "";
  const newContent = versionArray[newVersion - 1]?.content || "";

  // Calculate differences
  const changes = useMemo(() => {
    // Simple change detection - count line differences
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    
    let added = 0;
    let removed = 0;
    let modified = 0;

    // Very basic diff calculation
    if (oldLines.length !== newLines.length) {
      modified = Math.abs(oldLines.length - newLines.length);
    }

    return { added, removed, modified, total: added + removed + modified };
  }, [oldContent, newContent]);

  const handlePreviousChange = () => {
    // Navigate to previous version comparison
    if (oldVersion > 1) {
      setOldVersion(oldVersion - 1);
      setNewVersion(oldVersion);
      onVersionSelect?.(oldVersion - 1, oldVersion);
    }
  };

  const handleNextChange = () => {
    // Navigate to next version comparison
    if (newVersion < latestVersion) {
      setOldVersion(newVersion);
      setNewVersion(newVersion + 1);
      onVersionSelect?.(newVersion, newVersion + 1);
    }
  };

  const oldVersionInfo = versionArray[oldVersion - 1];
  const newVersionInfo = versionArray[newVersion - 1];

  if (versionArray.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <GitCompare className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>Nog geen versies beschikbaar om te vergelijken</p>
        </CardContent>
      </Card>
    );
  }

  if (versionArray.length === 1) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Rapport Preview - Versie 1
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {oldVersionInfo?.stageName}
          </p>
        </CardHeader>
        <CardContent>
          <div className="prose prose-sm max-w-none bg-muted/30 p-4 rounded-lg">
            <pre className="whitespace-pre-wrap font-sans text-sm">
              {oldContent}
            </pre>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={isFullscreen ? "fixed inset-4 z-50 overflow-auto" : ""}>
      <CardHeader className="space-y-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <GitCompare className="h-5 w-5" />
            Rapport Vergelijking
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setViewMode(viewMode === 'split' ? 'unified' : 'split')}
            >
              {viewMode === 'split' ? 'Unified View' : 'Split View'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsFullscreen(!isFullscreen)}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Version Selector */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Oude Versie</label>
            <Select 
              value={oldVersion.toString()} 
              onValueChange={(v) => setOldVersion(parseInt(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {versionArray.map((v) => (
                  <SelectItem key={v.version} value={v.version.toString()}>
                    v{v.version} - {v.stageName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Nieuwe Versie</label>
            <Select 
              value={newVersion.toString()} 
              onValueChange={(v) => setNewVersion(parseInt(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {versionArray.map((v) => (
                  <SelectItem 
                    key={v.version} 
                    value={v.version.toString()}
                    disabled={v.version <= oldVersion}
                  >
                    v{v.version} - {v.stageName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Navigation and Stats */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePreviousChange}
              disabled={oldVersion <= 1}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Vorige
            </Button>
            <span className="text-sm text-muted-foreground">
              Vergelijking {oldVersion} ↔ {newVersion}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleNextChange}
              disabled={newVersion >= latestVersion}
            >
              Volgende
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
            {changes.total > 0 && (
              <Badge variant="secondary">
                {changes.total} wijziging{changes.total !== 1 ? 'en' : ''}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="border rounded-lg overflow-hidden">
          <Suspense fallback={
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-3 text-sm text-muted-foreground">Diff viewer laden...</span>
            </div>
          }>
            <ReactDiffViewer
              oldValue={oldContent}
              newValue={newContent}
              splitView={viewMode === 'split'}
              compareMethod={DiffMethod.WORDS as any}
              leftTitle={`Versie ${oldVersion} - ${oldVersionInfo?.stageName}`}
              rightTitle={`Versie ${newVersion} - ${newVersionInfo?.stageName}`}
              styles={{
                variables: {
                  light: {
                    diffViewerBackground: '#ffffff',
                    diffViewerColor: '#000000',
                    addedBackground: '#e6ffed',
                    addedColor: '#24292e',
                    removedBackground: '#ffeef0',
                    removedColor: '#24292e',
                    wordAddedBackground: '#acf2bd',
                    wordRemovedBackground: '#fdb8c0',
                    addedGutterBackground: '#cdffd8',
                    removedGutterBackground: '#ffdce0',
                    gutterBackground: '#f6f8fa',
                    gutterBackgroundDark: '#f0f0f0',
                    highlightBackground: '#fffbdd',
                    highlightGutterBackground: '#fff5b1',
                  },
                  dark: {
                    diffViewerBackground: '#1e1e1e',
                    diffViewerColor: '#e8e8e8',
                    addedBackground: '#044B53',
                    addedColor: '#e8e8e8',
                    removedBackground: '#632F34',
                    removedColor: '#e8e8e8',
                    wordAddedBackground: '#055d67',
                    wordRemovedBackground: '#7d383f',
                    addedGutterBackground: '#034148',
                    removedGutterBackground: '#632b30',
                    gutterBackground: '#2c2c2c',
                    gutterBackgroundDark: '#262626',
                    highlightBackground: '#4a4a4a',
                    highlightGutterBackground: '#3d3d3d',
                  },
                },
              }}
            />
          </Suspense>
        </div>

        {/* Quick Actions */}
        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            💡 Tip: Gebruik de versie selectie om verschillende stappen te vergelijken
          </p>
          <Button variant="ghost" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Exporteer Diff
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
