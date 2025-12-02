/**
 * DevToolsPanel Component
 *
 * Developer tools section for viewing raw LLM input and prompt templates.
 * Extracted from WorkflowStageCard.tsx lines 511-589.
 */

import { memo, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Code2,
  ChevronRight,
  ChevronDown,
  Copy,
  Check,
  Wand2,
} from "lucide-react";
import { normalizePromptToString } from "@/lib/promptUtils";
import type { DevToolsPanelProps } from "@/types/workflowStageCard.types";

/**
 * Raw LLM Input section
 */
interface RawInputSectionProps {
  stagePrompt: string;
  isCollapsed: boolean;
  onToggle: () => void;
  onCopy: (text: string) => void;
  copied: boolean;
}

const RawInputSection = memo(function RawInputSection({
  stagePrompt,
  isCollapsed,
  onToggle,
  onCopy,
  copied,
}: RawInputSectionProps) {
  const normalizedPrompt = normalizePromptToString(stagePrompt);

  return (
    <div className="border border-jdb-blue-primary/30 rounded-lg bg-blue-50/50 dark:bg-blue-950/20 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-blue-100/50 dark:hover:bg-blue-950/30 transition-colors"
      >
        <span className="font-medium text-xs flex items-center gap-2 text-jdb-blue-primary">
          <Code2 className="w-3 h-3" />
          Raw LLM Input
        </span>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs bg-white">
            {stagePrompt.length.toLocaleString()} chars
          </Badge>
          {isCollapsed ? (
            <ChevronRight className="w-3 h-3 text-jdb-blue-primary" />
          ) : (
            <ChevronDown className="w-3 h-3 text-jdb-blue-primary" />
          )}
        </div>
      </button>
      {!isCollapsed && (
        <div className="px-3 py-3 bg-white dark:bg-jdb-panel border-t border-jdb-blue-primary/30">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs text-jdb-text-subtle">Exacte prompt naar LLM</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onCopy(normalizedPrompt)}
              className="h-6 w-6 p-0"
            >
              {copied ? (
                <Check className="w-3 h-3" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </Button>
          </div>
          <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded border border-gray-300 dark:border-gray-700 font-mono text-xs overflow-auto max-h-64">
            <pre
              className="whitespace-pre-wrap break-words text-gray-800 dark:text-gray-200"
              style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
            >
              {normalizedPrompt}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
});

/**
 * Prompt Template section
 */
interface PromptTemplateSectionProps {
  stagePrompt: string;
  isCollapsed: boolean;
  onToggle: () => void;
}

const PromptTemplateSection = memo(function PromptTemplateSection({
  stagePrompt,
  isCollapsed,
  onToggle,
}: PromptTemplateSectionProps) {
  const normalizedPrompt = normalizePromptToString(stagePrompt);

  return (
    <div className="border border-jdb-border rounded-lg">
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-jdb-bg dark:hover:bg-jdb-border/10 transition-colors"
      >
        <span className="font-medium text-xs flex items-center gap-2 text-jdb-text-heading">
          <Wand2 className="w-3 h-3" />
          Prompt Template
        </span>
        {isCollapsed ? (
          <ChevronRight className="w-3 h-3 text-jdb-text-subtle" />
        ) : (
          <ChevronDown className="w-3 h-3 text-jdb-text-subtle" />
        )}
      </button>
      {!isCollapsed && (
        <div className="px-3 py-3 bg-jdb-bg/50 dark:bg-jdb-border/5 border-t border-jdb-border">
          <div className="bg-white dark:bg-jdb-panel p-3 rounded border border-jdb-border font-mono text-xs overflow-auto max-h-64">
            <pre
              className="whitespace-pre-wrap break-all text-jdb-text-body"
              style={{ wordBreak: "break-all", overflowWrap: "anywhere" }}
            >
              {normalizedPrompt}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
});

export const DevToolsPanel = memo(function DevToolsPanel({
  stagePrompt,
  isRawInputCollapsed,
  isPromptCollapsed,
  onToggleRawInput,
  onTogglePrompt,
  onCopy,
  copied,
}: DevToolsPanelProps) {
  const [showDevTools, setShowDevTools] = useState(false);

  const handleToggleDevTools = useCallback(() => {
    setShowDevTools((prev) => !prev);
  }, []);

  return (
    <div className="border border-dashed border-jdb-border/50 rounded-lg overflow-hidden">
      <button
        onClick={handleToggleDevTools}
        className="w-full px-4 py-2 flex items-center justify-between hover:bg-jdb-bg/30 transition-colors text-jdb-text-subtle"
      >
        <span className="text-xs flex items-center gap-2">
          <Code2 className="w-3 h-3" />
          Developer Tools
        </span>
        {showDevTools ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
      </button>

      {showDevTools && (
        <div className="space-y-3 p-4 border-t border-dashed border-jdb-border/50">
          <RawInputSection
            stagePrompt={stagePrompt}
            isCollapsed={isRawInputCollapsed}
            onToggle={onToggleRawInput}
            onCopy={onCopy}
            copied={copied}
          />
          <PromptTemplateSection
            stagePrompt={stagePrompt}
            isCollapsed={isPromptCollapsed}
            onToggle={onTogglePrompt}
          />
        </div>
      )}
    </div>
  );
});
