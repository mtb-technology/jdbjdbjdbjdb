/**
 * Shared severity styling and utilities
 *
 * Centralizes severity-related logic used across multiple components:
 * - ChangeProposalCard
 * - ReviewerFeedbackViewer
 */

import { AlertCircle, AlertTriangle, Info, type LucideIcon } from 'lucide-react';

export type Severity = 'critical' | 'important' | 'suggestion';

export interface SeverityStyles {
  color: string;
  bgColor: string;
  borderColor: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Get comprehensive severity styles
 */
export function getSeverityStyles(severity: Severity): SeverityStyles {
  switch (severity) {
    case 'critical':
      return {
        color: 'text-red-700 dark:text-red-400',
        bgColor: 'bg-red-50 dark:bg-red-900/20',
        borderColor: 'border-red-300 dark:border-red-700',
        label: 'Kritiek',
        icon: AlertCircle
      };
    case 'important':
      return {
        color: 'text-orange-700 dark:text-orange-400',
        bgColor: 'bg-orange-50 dark:bg-orange-900/20',
        borderColor: 'border-orange-300 dark:border-orange-700',
        label: 'Belangrijk',
        icon: AlertTriangle
      };
    case 'suggestion':
      return {
        color: 'text-blue-700 dark:text-blue-400',
        bgColor: 'bg-blue-50 dark:bg-blue-900/20',
        borderColor: 'border-blue-300 dark:border-blue-700',
        label: 'Suggestie',
        icon: Info
      };
    default:
      // Fallback for unknown severity
      return {
        color: 'text-gray-700 dark:text-gray-400',
        bgColor: 'bg-gray-50 dark:bg-gray-900/20',
        borderColor: 'border-gray-300 dark:border-gray-700',
        label: 'Onbekend',
        icon: Info
      };
  }
}

/**
 * Get severity color class (backward compatible)
 */
export function getSeverityColor(severity: Severity): string {
  return getSeverityStyles(severity).color;
}

/**
 * Get severity label (backward compatible)
 */
export function getSeverityLabel(severity: Severity): string {
  return getSeverityStyles(severity).label;
}

/**
 * Get severity icon (backward compatible)
 */
export function getSeverityIcon(severity: Severity): LucideIcon {
  return getSeverityStyles(severity).icon;
}

/**
 * Get severity badge variant for UI Badge component
 */
export function getSeverityBadgeVariant(severity: Severity): 'destructive' | 'default' | 'secondary' {
  switch (severity) {
    case 'critical':
      return 'destructive';
    case 'important':
      return 'default';
    case 'suggestion':
      return 'secondary';
    default:
      return 'secondary';
  }
}

/**
 * Parse severity from string (case-insensitive, with fallback)
 */
export function parseSeverity(value: unknown): Severity {
  if (typeof value !== 'string') return 'suggestion';

  const normalized = value.toLowerCase().trim();

  switch (normalized) {
    case 'critical':
    case 'kritiek':
    case 'hoog':
    case 'high':
      return 'critical';
    case 'important':
    case 'belangrijk':
    case 'medium':
    case 'middel':
      return 'important';
    case 'suggestion':
    case 'suggestie':
    case 'low':
    case 'laag':
      return 'suggestion';
    default:
      return 'suggestion';
  }
}

/**
 * Sort items by severity (critical first, then important, then suggestion)
 */
export function sortBySeverity<T extends { severity: Severity }>(items: T[]): T[] {
  const severityOrder: Record<Severity, number> = {
    critical: 0,
    important: 1,
    suggestion: 2
  };

  return [...items].sort((a, b) => {
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
}

/**
 * Count items by severity
 */
export function countBySeverity<T extends { severity: Severity }>(items: T[]): Record<Severity, number> {
  return items.reduce((acc, item) => {
    acc[item.severity] = (acc[item.severity] || 0) + 1;
    return acc;
  }, {
    critical: 0,
    important: 0,
    suggestion: 0
  } as Record<Severity, number>);
}
