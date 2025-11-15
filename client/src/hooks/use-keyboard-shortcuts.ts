/**
 * Keyboard Shortcuts Hook
 *
 * Provides global keyboard shortcut management
 * Supports modifiers (Ctrl/Cmd, Alt, Shift) and key combinations
 */

import { useEffect, useCallback, useRef } from 'react';

export interface KeyboardShortcut {
  /**
   * Key to press (e.g., 'k', 'n', '/', 'Escape')
   */
  key: string;

  /**
   * Require Ctrl (Windows/Linux) or Cmd (Mac)
   */
  ctrlOrCmd?: boolean;

  /**
   * Require Shift key
   */
  shift?: boolean;

  /**
   * Require Alt key
   */
  alt?: boolean;

  /**
   * Callback when shortcut is triggered
   */
  action: (event: KeyboardEvent) => void;

  /**
   * Description for help/command palette
   */
  description: string;

  /**
   * Prevent default browser behavior
   * @default true
   */
  preventDefault?: boolean;

  /**
   * Stop event propagation
   * @default true
   */
  stopPropagation?: boolean;

  /**
   * Only trigger when these elements are NOT focused
   * @default ['INPUT', 'TEXTAREA', 'SELECT']
   */
  excludeElements?: string[];
}

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

/**
 * Check if keyboard shortcut matches the event
 */
function matchesShortcut(event: KeyboardEvent, shortcut: KeyboardShortcut): boolean {
  // Check key match (case-insensitive)
  if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) {
    return false;
  }

  // Check modifiers
  const ctrlOrCmd = isMac ? event.metaKey : event.ctrlKey;

  if (shortcut.ctrlOrCmd && !ctrlOrCmd) return false;
  if (!shortcut.ctrlOrCmd && ctrlOrCmd) return false;

  if (shortcut.shift && !event.shiftKey) return false;
  if (!shortcut.shift && event.shiftKey) return false;

  if (shortcut.alt && !event.altKey) return false;
  if (!shortcut.alt && event.altKey) return false;

  return true;
}

/**
 * Format shortcut for display
 */
export function formatShortcut(shortcut: KeyboardShortcut): string {
  const parts: string[] = [];

  if (shortcut.ctrlOrCmd) {
    parts.push(isMac ? '⌘' : 'Ctrl');
  }

  if (shortcut.shift) {
    parts.push('⇧');
  }

  if (shortcut.alt) {
    parts.push(isMac ? '⌥' : 'Alt');
  }

  // Format key nicely
  const keyName = shortcut.key === ' ' ? 'Space' : shortcut.key.toUpperCase();
  parts.push(keyName);

  return parts.join(isMac ? '' : '+');
}

/**
 * Hook to register keyboard shortcuts
 */
export function useKeyboardShortcuts(
  shortcuts: KeyboardShortcut[],
  options?: {
    /**
     * Whether shortcuts are enabled
     * @default true
     */
    enabled?: boolean;
  }
) {
  const shortcutsRef = useRef(shortcuts);
  const enabledRef = useRef(options?.enabled ?? true);

  // Update refs when props change
  useEffect(() => {
    shortcutsRef.current = shortcuts;
    enabledRef.current = options?.enabled ?? true;
  }, [shortcuts, options?.enabled]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!enabledRef.current) return;

    const target = event.target as HTMLElement;
    const tagName = target.tagName;

    for (const shortcut of shortcutsRef.current) {
      // Check if we should exclude this element
      const excludeElements = shortcut.excludeElements ?? ['INPUT', 'TEXTAREA', 'SELECT'];
      if (excludeElements.includes(tagName)) {
        continue;
      }

      // Check if shortcut matches
      if (matchesShortcut(event, shortcut)) {
        if (shortcut.preventDefault !== false) {
          event.preventDefault();
        }

        if (shortcut.stopPropagation !== false) {
          event.stopPropagation();
        }

        shortcut.action(event);
        break; // Only trigger first matching shortcut
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  return {
    formatShortcut,
    isMac,
  };
}

/**
 * Hook to register a single keyboard shortcut
 */
export function useKeyboardShortcut(
  shortcut: KeyboardShortcut,
  dependencies: React.DependencyList = []
) {
  return useKeyboardShortcuts([shortcut], {
    enabled: dependencies.every(Boolean),
  });
}
