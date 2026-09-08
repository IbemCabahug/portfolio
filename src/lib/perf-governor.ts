/**
 * Adaptive Performance Governor (AFRC - Adaptive Frame Rate Controller)
 * Continuously safeguards 60 FPS across low-end machines, Android, and Mac.
 */

export type PerfTier = 'high' | 'low';

export function getPerfTier(): PerfTier {
  if (typeof window === 'undefined') return 'low';
  return (document.documentElement.dataset.perf as PerfTier) || 'low';
}

export function setPerfTier(tier: PerfTier) {
  if (typeof window === 'undefined') return;
  document.documentElement.dataset.perf = tier;
  try {
    localStorage.setItem('perf', tier);
  } catch {}
}

let watchdogActive = false;

/**
 * Initializes a non-intrusive runtime watchdog that monitors frame deltas.
 * If severe jank (frames > 50ms or sustained drop < 35 FPS) is detected,
 * it automatically switches the site into the low-overhead performance tier.
 */
export function initPerformanceGovernor() {
  if (typeof window === 'undefined' || watchdogActive) return;
  watchdogActive = true;

  let consecutiveJank = 0;
  let lastTime = performance.now();
  let frameCount = 0;
  let accumulatedTime = 0;

  function sample(now: number) {
    const delta = now - lastTime;
    lastTime = now;

    if (delta > 50) {
      consecutiveJank++;
    } else {
      consecutiveJank = Math.max(0, consecutiveJank - 1);
    }

    accumulatedTime += delta;
    frameCount++;

    // Every ~1.5 seconds, check rolling FPS
    if (accumulatedTime >= 1500) {
      const avgFps = Math.round((frameCount * 1000) / accumulatedTime);
      if ((avgFps < 35 || consecutiveJank >= 3) && getPerfTier() === 'high') {
        // Auto-downgrade to protect user experience and prevent freeze
        document.documentElement.dataset.perf = 'low';
      }
      accumulatedTime = 0;
      frameCount = 0;
    }

    requestAnimationFrame(sample);
  }

  requestAnimationFrame(sample);
}
