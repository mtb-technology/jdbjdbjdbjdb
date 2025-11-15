/**
 * Command Palette Component
 *
 * Quick access to common actions via keyboard shortcuts
 * Inspired by VS Code, GitHub, and Linear command palettes
 */

import * as React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Search, FileText, Plus, Settings, Home, Archive } from "lucide-react";
import { useKeyboardShortcuts, formatShortcut, type KeyboardShortcut } from "@/hooks/use-keyboard-shortcuts";

export interface Command {
  id: string;
  label: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  action: () => void;
  shortcut?: Omit<KeyboardShortcut, 'action'>; // Shortcut without action (uses command's action)
  keywords?: string[]; // Additional search terms
}

interface CommandPaletteProps {
  /**
   * Available commands
   */
  commands: Command[];

  /**
   * Whether the palette is open
   */
  open: boolean;

  /**
   * Callback when open state changes
   */
  onOpenChange: (open: boolean) => void;

  /**
   * Placeholder text for search input
   * @default "Type a command or search..."
   */
  placeholder?: string;
}

export function CommandPalette({
  commands,
  open,
  onOpenChange,
  placeholder = "Type a command or search..."
}: CommandPaletteProps) {
  const [search, setSearch] = React.useState("");
  const [selectedIndex, setSelectedIndex] = React.useState(0);

  // Filter commands based on search
  const filteredCommands = React.useMemo(() => {
    if (!search) return commands;

    const lowerSearch = search.toLowerCase();

    return commands.filter((cmd) => {
      const searchableText = [
        cmd.label,
        cmd.description || "",
        ...(cmd.keywords || [])
      ].join(" ").toLowerCase();

      return searchableText.includes(lowerSearch);
    });
  }, [commands, search]);

  // Reset state when opened
  React.useEffect(() => {
    if (open) {
      setSearch("");
      setSelectedIndex(0);
    }
  }, [open]);

  // Handle keyboard navigation
  const handleKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setSelectedIndex((prev) =>
          prev < filteredCommands.length - 1 ? prev + 1 : prev
        );
        break;

      case "ArrowUp":
        event.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
        break;

      case "Enter":
        event.preventDefault();
        if (filteredCommands[selectedIndex]) {
          filteredCommands[selectedIndex].action();
          onOpenChange(false);
        }
        break;

      case "Escape":
        event.preventDefault();
        onOpenChange(false);
        break;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl p-0 gap-0 overflow-hidden"
        aria-describedby="command-palette-description"
      >
        <div id="command-palette-description" className="sr-only">
          Command palette for quick navigation and actions
        </div>

        {/* Search Input */}
        <div className="flex items-center border-b px-4 py-3">
          <Search className="h-5 w-5 text-muted-foreground mr-3" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-base"
            autoFocus
          />
        </div>

        {/* Commands List */}
        <div className="max-h-[400px] overflow-y-auto">
          {filteredCommands.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No commands found
            </div>
          ) : (
            <div className="py-2">
              {filteredCommands.map((command, index) => {
                const Icon = command.icon;
                const isSelected = index === selectedIndex;

                return (
                  <button
                    key={command.id}
                    onClick={() => {
                      command.action();
                      onOpenChange(false);
                    }}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={cn(
                      "w-full flex items-center justify-between px-4 py-3 text-left transition-colors",
                      isSelected
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/50"
                    )}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {Icon && (
                        <Icon className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">
                          {command.label}
                        </div>
                        {command.description && (
                          <div className="text-sm text-muted-foreground truncate">
                            {command.description}
                          </div>
                        )}
                      </div>
                    </div>

                    {command.shortcut && (
                      <kbd className="hidden sm:inline-block px-2 py-1 text-xs font-mono bg-muted rounded border">
                        {formatShortcut(command.shortcut as KeyboardShortcut)}
                      </kbd>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="border-t px-4 py-2 text-xs text-muted-foreground flex items-center gap-4">
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-muted rounded border text-[10px]">↑</kbd>
            <kbd className="px-1.5 py-0.5 bg-muted rounded border text-[10px]">↓</kbd>
            to navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-muted rounded border text-[10px]">↵</kbd>
            to select
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-muted rounded border text-[10px]">esc</kbd>
            to close
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Hook to manage command palette state
 */
export function useCommandPalette(commands: Command[]) {
  const [open, setOpen] = React.useState(false);

  // Register Ctrl/Cmd+K to open command palette
  useKeyboardShortcuts([
    {
      key: 'k',
      ctrlOrCmd: true,
      description: 'Open command palette',
      action: () => setOpen(true),
    }
  ]);

  // Register individual command shortcuts
  useKeyboardShortcuts(
    commands
      .filter(cmd => cmd.shortcut)
      .map(cmd => ({
        ...(cmd.shortcut as Partial<KeyboardShortcut>),
        action: cmd.action,
      } as KeyboardShortcut)),
    { enabled: !open } // Disable when palette is open
  );

  return {
    open,
    setOpen,
    CommandPaletteComponent: () => (
      <CommandPalette
        commands={commands}
        open={open}
        onOpenChange={setOpen}
      />
    )
  };
}
