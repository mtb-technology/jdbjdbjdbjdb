/**
 * Confetti celebration utilities
 *
 * Provides delightful success animations for key user achievements
 */

import confetti from 'canvas-confetti';

/**
 * Trigger confetti celebration
 * @param options - Confetti configuration options
 */
export function celebrateSuccess(options?: {
  /**
   * Duration of the confetti animation (ms)
   * @default 3000
   */
  duration?: number;

  /**
   * Intensity of the confetti
   * 'light' | 'medium' | 'heavy'
   * @default 'medium'
   */
  intensity?: 'light' | 'medium' | 'heavy';

  /**
   * Origin point for confetti (0-1)
   * @default { x: 0.5, y: 0.5 }
   */
  origin?: { x: number; y: number };
}) {
  const {
    duration = 3000,
    intensity = 'medium',
    origin = { x: 0.5, y: 0.5 }
  } = options || {};

  const particleCount = {
    light: 50,
    medium: 100,
    heavy: 200
  }[intensity];

  const spread = {
    light: 60,
    medium: 90,
    heavy: 120
  }[intensity];

  const startVelocity = {
    light: 25,
    medium: 35,
    heavy: 45
  }[intensity];

  const end = Date.now() + duration;

  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'];

  function frame() {
    confetti({
      particleCount: particleCount / 10, // Spread over multiple frames
      angle: 60,
      spread,
      origin,
      colors,
      startVelocity,
      gravity: 1,
      drift: 0,
      ticks: 200,
      scalar: 1,
    });

    confetti({
      particleCount: particleCount / 10,
      angle: 120,
      spread,
      origin,
      colors,
      startVelocity,
      gravity: 1,
      drift: 0,
      ticks: 200,
      scalar: 1,
    });

    if (Date.now() < end) {
      requestAnimationFrame(frame);
    }
  }

  frame();
}

/**
 * Fireworks effect - spectacular success
 */
export function celebrateWithFireworks(options?: {
  duration?: number;
}) {
  const duration = options?.duration || 3000;
  const end = Date.now() + duration;

  function randomInRange(min: number, max: number) {
    return Math.random() * (max - min) + min;
  }

  (function frame() {
    confetti({
      particleCount: 3,
      angle: 60,
      spread: 55,
      origin: { x: 0 },
      colors: ['#3b82f6', '#10b981', '#f59e0b'],
    });

    confetti({
      particleCount: 3,
      angle: 120,
      spread: 55,
      origin: { x: 1 },
      colors: ['#ef4444', '#8b5cf6', '#06b6d4'],
    });

    if (Date.now() < end) {
      requestAnimationFrame(frame);
    }
  })();
}

/**
 * Quick burst - small celebration
 */
export function celebrateQuick() {
  confetti({
    particleCount: 50,
    spread: 70,
    origin: { y: 0.6 },
    colors: ['#3b82f6', '#10b981', '#f59e0b'],
  });
}

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

/**
 * Case completion celebration - full workflow completion
 */
export function celebrateCaseCompletion() {
  // Multiple bursts for significant achievement
  const defaults = {
    startVelocity: 30,
    spread: 360,
    ticks: 60,
    zIndex: 0,
    colors: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6']
  };

  function shoot() {
    confetti({
      ...defaults,
      particleCount: 40,
      scalar: 1.2,
      shapes: ['star']
    });

    confetti({
      ...defaults,
      particleCount: 10,
      scalar: 0.75,
      shapes: ['circle']
    });
  }

  setTimeout(shoot, 0);
  setTimeout(shoot, 100);
  setTimeout(shoot, 200);
}

/**
 * Batch processing celebration - multiple cases completed
 */
export function celebrateBatchComplete(count: number) {
  const intensity = count > 10 ? 'heavy' : count > 5 ? 'medium' : 'light';

  celebrateSuccess({
    intensity,
    duration: Math.min(count * 300, 5000), // Scale with count, max 5s
  });
}
