/**
 * InactivityTimer - Reusable timeout utility for assistants
 *
 * Fires a callback after a period of inactivity.
 * Can be reset (extends the deadline) or cancelled.
 *
 * Usage:
 *   const timer = new InactivityTimer(15, () => hangup());
 *   timer.start();
 *   timer.reset();   // user did something, restart countdown
 *   timer.cancel();  // done, clean up
 */

class InactivityTimer {
  private timeoutSeconds: number;
  private callback: () => void;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(timeoutSeconds: number, callback: () => void) {
    this.timeoutSeconds = timeoutSeconds;
    this.callback = callback;
  }

  start(): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.callback();
    }, this.timeoutSeconds * 1000);
  }

  reset(): void {
    if (this.timer) {
      this.start();
    }
  }

  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }
}

module.exports.InactivityTimer = InactivityTimer;
