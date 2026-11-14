/** Jeda retry bertahap: 2 dtk, 5 dtk, lalu 30 dtk seterusnya. */
export const DEFAULT_BACKOFF_STEPS_MS = [2_000, 5_000, 30_000] as const

export function backoffDelay(attempt: number, steps: readonly number[] = DEFAULT_BACKOFF_STEPS_MS): number {
  if (steps.length === 0) return 0
  return steps[Math.min(Math.max(0, Math.floor(attempt)), steps.length - 1)] ?? 0
}

/** Penghitung kegagalan beruntun: `failure()` memberi jeda berikutnya, `reset()` setelah pulih. */
export class BackoffTracker {
  private attempts = 0

  constructor(private readonly steps: readonly number[] = DEFAULT_BACKOFF_STEPS_MS) {}

  failure(): number {
    return backoffDelay(this.attempts++, this.steps)
  }

  reset(): void {
    this.attempts = 0
  }
}
