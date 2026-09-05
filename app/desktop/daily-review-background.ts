import type { DailyReviewActiveRun, DailyReviewPreparationTrigger } from "../../src/daily-review-schedule";

interface ActiveBackgroundReview {
  state: DailyReviewActiveRun;
  completion: Promise<void>;
}

export interface StartDailyReviewInput {
  logicalDate: string;
  trigger: DailyReviewPreparationTrigger;
  now?: Date;
  run(): Promise<void>;
  onStateChange?(): void | Promise<void>;
}

export interface StartDailyReviewResult {
  started: boolean;
  completion: Promise<void>;
}

export class DailyReviewBackgroundCoordinator {
  private active: ActiveBackgroundReview | undefined;
  private readonly scheduledAttempts = new Set<string>();

  get activeRun(): DailyReviewActiveRun | undefined {
    return this.active?.state;
  }

  hasScheduledAttempt(logicalDate: string): boolean {
    return this.scheduledAttempts.has(logicalDate);
  }

  start(input: StartDailyReviewInput): StartDailyReviewResult {
    if (this.active) return { started: false, completion: this.active.completion };
    const state: DailyReviewActiveRun = {
      logicalDate: input.logicalDate,
      status: "preparing",
      trigger: input.trigger,
      startedAt: (input.now ?? new Date()).toISOString()
    };
    if (input.trigger === "scheduled") this.scheduledAttempts.add(input.logicalDate);
    const completion = Promise.resolve()
      .then(input.run)
      .catch(() => undefined)
      .finally(async () => {
        this.active = undefined;
        await input.onStateChange?.();
      });
    this.active = { state, completion };
    void input.onStateChange?.();
    return { started: true, completion };
  }
}
