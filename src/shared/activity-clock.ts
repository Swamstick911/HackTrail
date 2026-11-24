export interface ActivityInterval {
  start: number;
  end: number;
  signal: 'keyboard' | 'mouse';
}

export class ActivityClock {
  private cursor: number;
  private lastInput = -Infinity;
  private focused = false;
  private signal: ActivityInterval['signal'] = 'keyboard';

  constructor(
    now: number,
    private idleAfterMs = 120_000,
    private maxGapMs = 30_000,
  ) {
    this.cursor = now;
  }

  input(now: number, signal: ActivityInterval['signal']): ActivityInterval | null {
    if (!this.focused) return null;
    let interval: ActivityInterval | null = null;
    if (
      now < this.cursor ||
      now - this.cursor > this.maxGapMs ||
      now - this.lastInput > this.idleAfterMs
    ) {
      interval = this.tick(now);
    }
    this.lastInput = now;
    this.signal = signal;
    return interval;
  }

  focus(now: number, focused: boolean) {
    const interval = this.tick(now);
    this.focused = focused;
    this.cursor = now;
    if (!focused) this.lastInput = -Infinity;
    return interval;
  }

  active(now: number) {
    return this.focused && now >= this.lastInput && now - this.lastInput < this.idleAfterMs;
  }

  tick(now: number): ActivityInterval | null {
    const start = this.cursor;
    this.cursor = now;
    if (now <= start || now - start > this.maxGapMs || !this.focused) {
      if (now < start || now - start > this.maxGapMs) this.lastInput = -Infinity;
      return null;
    }
    const end = Math.min(now, this.lastInput + this.idleAfterMs);
    return end > start ? { start, end, signal: this.signal } : null;
  }
}
