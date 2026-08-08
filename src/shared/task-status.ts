import type { OnboardingTask } from "./domain";

export function isOutstandingTaskStatus(status: OnboardingTask["status"]) {
  return status === "not_started" || status === "in_progress" || status === "overdue";
}

export function isResolvedTaskStatus(status: OnboardingTask["status"]) {
  return status === "complete" || status === "waived";
}
