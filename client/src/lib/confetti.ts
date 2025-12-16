/**
 * Confetti celebration utilities
 */

import confetti from 'canvas-confetti';

/**
 * Case export celebration - optimized for export success
 */
export function celebrateExport(format: 'html' | 'json') {
  const colors = format === 'html'
    ? ['#3b82f6', '#8b5cf6', '#06b6d4'] // Blue/purple for HTML
    : ['#10b981', '#059669', '#34d399']; // Green for JSON

  confetti({
    particleCount: 100,
    spread: 70,
    origin: { y: 0.6 },
    colors,
    startVelocity: 30,
    gravity: 0.8,
    ticks: 150,
  });
}
