import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileText,
  Maximize2,
  Minimize2,
  Download,
  Eye,
  EyeOff,
  ChevronRight,
  ChevronLeft,
  AlertCircle
} from "lucide-react";
import { CompactVersionTimeline } from "./VersionTimeline";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Strip markdown code fences that wrap the entire content
function stripCodeFences(content: string): string {
  // Remove leading ``` (with optional language) and trailing ```
  return content
    .replace(/^```[\w]*\n?/, '')  // Remove opening fence
    .replace(/\n?```\s*$/, '');   // Remove closing fence
}

// Transform numbered chapters (1. Title, 2. Title) to markdown H1 headers
function transformChaptersToHeaders(content: string): string {
  const stripped = stripCodeFences(content);
  return stripped.replace(
    /^(\d+)\.\s+([A-Z][^\n]*)/gm,
    '# $1. $2'
  );
}

interface StickyReportPreviewProps {
  content: string;
  version?: number;
  stageName?: string;
  changeCount?: number;
  versions?: Array<{
    version: number;
    stageKey: string;
    stageName: string;
    changeCount?: number;
  }>;
  onExport?: () => void;
  onFullView?: () => void;
  className?: string;
}

export function StickyReportPreview({ 
  content, 
  version = 1,
  stageName = "Concept",
  changeCount,
  versions = [],
  onExport,
  onFullView,
  className = ""
}: StickyReportPreviewProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);

  if (isCollapsed) {
    return (
      <div className={`fixed right-4 top-4 z-40 ${className}`}>
        <Button
          variant="default"
          size="sm"
          onClick={() => setIsCollapsed(false)}
          className="shadow-lg"
        >
          <ChevronLeft className="h-4 w-4 mr-2" />
          Toon Rapport Preview
        </Button>
      </div>
    );
  }

  return (
    <div
      className={`sticky top-4 h-[calc(100vh-2rem)] flex flex-col w-full ${className}`}
    >
      <Card className="flex flex-col h-full shadow-lg border-2 border-primary/20">
        <CardHeader className="pb-3 space-y-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-5 w-5" />
              Live Rapport Preview
            </CardTitle>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsExpanded(!isExpanded)}
                className="h-7 w-7 p-0"
              >
                {isExpanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsCollapsed(true)}
                className="h-7 w-7 p-0"
              >
                <ChevronRight className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Version info */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="default" className="text-xs">
                Versie {version}
              </Badge>
              {changeCount !== undefined && changeCount > 0 && (
                <Badge variant="secondary" className="text-xs">
                  +{changeCount} wijz.
                </Badge>
              )}
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            {stageName}
          </div>

          {/* Compact timeline if versions available */}
          {versions.length > 1 && isExpanded && (
            <div className="pt-2 border-t">
              <CompactVersionTimeline 
                versions={versions} 
                currentVersion={version}
              />
            </div>
          )}
        </CardHeader>

        <CardContent className="flex-1 flex flex-col p-0 min-h-0 bg-white dark:bg-gray-900">
          {/* Content preview */}
          <ScrollArea className="flex-1 px-4 bg-white dark:bg-gray-900">
            {content ? (
              <div className="prose prose-xs max-w-none pb-4 pt-2 dark:prose-invert bg-white dark:bg-gray-900">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  children={transformChaptersToHeaders(content)}
                  components={{
                    h1: ({ children }) => (
                      <h1 className="text-base font-bold text-gray-900 dark:text-gray-100 mt-4 mb-2 border-b border-blue-500 pb-1">
                        {children}
                      </h1>
                    ),
                    h2: ({ children }) => (
                      <h2 className="text-sm font-bold text-gray-900 dark:text-gray-100 mt-3 mb-2">
                        {children}
                      </h2>
                    ),
                    h3: ({ children }) => (
                      <h3 className="text-xs font-bold text-gray-900 dark:text-gray-100 mt-2 mb-1">
                        {children}
                      </h3>
                    ),
                    p: ({ children }) => (
                      <p className="text-xs mb-2 text-gray-700 dark:text-gray-300 leading-relaxed">
                        {children}
                      </p>
                    ),
                    ul: ({ children }) => (
                      <ul className="text-xs mb-2 list-disc list-outside ml-4 space-y-0.5">
                        {children}
                      </ul>
                    ),
                    ol: ({ children }) => (
                      <ol className="text-xs mb-2 list-decimal list-outside ml-4 space-y-0.5">
                        {children}
                      </ol>
                    ),
                    li: ({ children }) => (
                      <li className="text-xs text-gray-700 dark:text-gray-300">
                        {children}
                      </li>
                    ),
                    strong: ({ children }) => (
                      <strong className="font-bold">{children}</strong>
                    ),
                    blockquote: ({ children }) => (
                      <blockquote className="border-l-2 border-blue-400 pl-2 italic text-xs text-gray-600 dark:text-gray-400">
                        {children}
                      </blockquote>
                    ),
                    table: ({ children }) => (
                      <div className="overflow-x-auto my-2">
                        <table className="min-w-full text-xs border-collapse border border-gray-300 dark:border-gray-600">
                          {children}
                        </table>
                      </div>
                    ),
                    thead: ({ children }) => (
                      <thead className="bg-gray-100 dark:bg-gray-800">
                        {children}
                      </thead>
                    ),
                    tbody: ({ children }) => (
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {children}
                      </tbody>
                    ),
                    tr: ({ children }) => (
                      <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        {children}
                      </tr>
                    ),
                    th: ({ children }) => (
                      <th className="px-2 py-1 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600">
                        {children}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td className="px-2 py-1 text-xs text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600">
                        {children}
                      </td>
                    ),
                    // Override code blocks to use light styling instead of dark
                    pre: ({ children }) => (
                      <pre className="bg-gray-50 dark:bg-gray-800 p-2 rounded text-xs overflow-x-auto my-2">
                        {children}
                      </pre>
                    ),
                    code: ({ children, className }) => {
                      // Inline code vs code block
                      const isInline = !className;
                      return isInline ? (
                        <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-xs">
                          {children}
                        </code>
                      ) : (
                        <code className="text-xs">{children}</code>
                      );
                    },
                    // Horizontal rule
                    hr: () => (
                      <hr className="my-3 border-gray-200 dark:border-gray-700" />
                    ),
                  }}
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center p-4 text-muted-foreground">
                <AlertCircle className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">Nog geen rapport content beschikbaar</p>
                <p className="text-xs mt-1">Start de workflow om een rapport te genereren</p>
              </div>
            )}
          </ScrollArea>

          {/* Action buttons */}
          <div className="border-t p-3 space-y-2 bg-muted/20">
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs h-8"
              onClick={onFullView}
            >
              <Eye className="h-3 w-3 mr-2" />
              Volledig Scherm
            </Button>
            {onExport && (
              <Button
                variant="secondary"
                size="sm"
                className="w-full text-xs h-8"
                onClick={onExport}
              >
                <Download className="h-3 w-3 mr-2" />
                Exporteer
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Floating indicator for unsaved changes */}
      {changeCount !== undefined && changeCount > 0 && (
        <div className="absolute -top-2 -right-2 z-10">
          <div className="bg-blue-500 text-white text-xs font-bold rounded-full h-6 w-6 flex items-center justify-center shadow-lg animate-pulse">
            {changeCount > 9 ? '9+' : changeCount}
          </div>
        </div>
      )}
    </div>
  );
}

// Full screen modal version
interface FullScreenReportPreviewProps {
  content: string;
  version?: number;
  stageName?: string;
  onClose: () => void;
  onExport?: () => void;
}

export function FullScreenReportPreview({
  content,
  version = 1,
  stageName = "Concept",
  onClose,
  onExport
}: FullScreenReportPreviewProps) {
  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm">
      <div className="container mx-auto h-full flex flex-col py-8">
        <Card className="flex-1 flex flex-col min-h-0">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-6 w-6" />
                  Fiscaal Duidingsrapport - Preview
                </CardTitle>
                <div className="flex items-center gap-2 mt-2">
                  <Badge variant="default">Versie {version}</Badge>
                  <span className="text-sm text-muted-foreground">{stageName}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {onExport && (
                  <Button variant="outline" size="sm" onClick={onExport}>
                    <Download className="h-4 w-4 mr-2" />
                    Exporteer
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={onClose}>
                  <EyeOff className="h-4 w-4 mr-2" />
                  Sluiten
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="flex-1 min-h-0">
            <ScrollArea className="h-full">
              <div className="prose prose-sm max-w-none dark:prose-invert">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  children={transformChaptersToHeaders(content)}
                  components={{
                    h1: ({ children }) => (
                      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mt-6 mb-4 border-b-2 border-blue-600 pb-2">
                        {children}
                      </h1>
                    ),
                    h2: ({ children }) => (
                      <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mt-5 mb-3 border-b border-gray-300 dark:border-gray-600 pb-1">
                        {children}
                      </h2>
                    ),
                    h3: ({ children }) => (
                      <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 mt-4 mb-2">
                        {children}
                      </h3>
                    ),
                    p: ({ children }) => (
                      <p className="mb-4 text-gray-700 dark:text-gray-300 leading-relaxed">
                        {children}
                      </p>
                    ),
                    ul: ({ children }) => (
                      <ul className="mb-4 list-disc list-outside ml-6 space-y-1">
                        {children}
                      </ul>
                    ),
                    ol: ({ children }) => (
                      <ol className="mb-4 list-decimal list-outside ml-6 space-y-1">
                        {children}
                      </ol>
                    ),
                    li: ({ children }) => (
                      <li className="text-gray-700 dark:text-gray-300">
                        {children}
                      </li>
                    ),
                    strong: ({ children }) => (
                      <strong className="font-bold text-gray-900 dark:text-gray-100">
                        {children}
                      </strong>
                    ),
                    blockquote: ({ children }) => (
                      <blockquote className="border-l-4 border-blue-500 pl-4 italic my-4 text-gray-600 dark:text-gray-400">
                        {children}
                      </blockquote>
                    ),
                    table: ({ children }) => (
                      <div className="overflow-x-auto my-4">
                        <table className="min-w-full text-sm border-collapse border border-gray-300 dark:border-gray-600">
                          {children}
                        </table>
                      </div>
                    ),
                    thead: ({ children }) => (
                      <thead className="bg-gray-100 dark:bg-gray-800">
                        {children}
                      </thead>
                    ),
                    tbody: ({ children }) => (
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {children}
                      </tbody>
                    ),
                    tr: ({ children }) => (
                      <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        {children}
                      </tr>
                    ),
                    th: ({ children }) => (
                      <th className="px-3 py-2 text-left text-sm font-semibold text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600">
                        {children}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td className="px-3 py-2 text-sm text-gray-600 dark:text-gray-400 border border-gray-300 dark:border-gray-600">
                        {children}
                      </td>
                    ),
                  }}
                />
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
