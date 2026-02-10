/**
 * RetryManager - Shared retry logic for assistants
 *
 * Tracks attempt count and fires callbacks at configurable thresholds.
 *
 * Usage:
 *   const retry = new RetryManager({
 *     maxRetries: 12,
 *     onMaxReached: () => hangup(),
 *     feedbackIntervals: [3, 6, 9],
 *     onFeedback: () => playAudio("try-again"),
 *   });
 *
 *   retry.attempt(); // returns true if still under max
 */

interface RetryManagerOptions {
  maxRetries: number;
  onMaxReached: () => void;
  feedbackIntervals?: number[];
  onFeedback?: () => void;
}

class RetryManager {
  private count: number = 0;
  private maxRetries: number;
  private onMaxReached: () => void;
  private feedbackIntervals: number[];
  private onFeedback: (() => void) | null;

  constructor(options: RetryManagerOptions) {
    this.maxRetries = options.maxRetries;
    this.onMaxReached = options.onMaxReached;
    this.feedbackIntervals = options.feedbackIntervals || [];
    this.onFeedback = options.onFeedback || null;
  }

  /**
   * Record one attempt. Returns false if max reached (and fires onMaxReached).
   */
  attempt(): boolean {
    this.count++;

    if (this.count >= this.maxRetries) {
      this.onMaxReached();
      return false;
    }

    if (this.onFeedback && this.feedbackIntervals.includes(this.count)) {
      this.onFeedback();
    }

    return true;
  }

  getCount(): number {
    return this.count;
  }

  reset(): void {
    this.count = 0;
  }
}

module.exports.RetryManager = RetryManager;
