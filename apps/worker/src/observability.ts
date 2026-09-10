import * as Sentry from "@sentry/node";

/**
 * Error reporting for a process nobody is watching.
 *
 * The worker runs unattended: it paces sends over hours, sweeps at three in the
 * morning, and its failures are exactly the kind nobody notices — a job that
 * throws is retried three times and then gone, and the only symptom is a
 * campaign that stopped. That is worth a report rather than a log line in a
 * container nobody opens.
 */
export function initObservability(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    console.log("SENTRY_DSN not set; errors will only appear in the log");
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? "development",
    // Traces cost money and this process is not latency-sensitive. Errors are
    // the point; a sample of traces is enough to see a slow provider.
    tracesSampleRate: 0.1,
    // Prospect messages and drafted replies pass through this process. None of
    // that belongs in an error tracker.
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request?.data) delete event.request.data;
      return event;
    },
  });
}

/**
 * Reports a failed job with the context needed to find it again.
 *
 * BullMQ retries and then gives up quietly, so the report has to carry which
 * job and which workspace, or it is an anonymous stack trace.
 */
export function reportJobFailure(
  queue: string,
  jobId: string | undefined,
  error: unknown,
  context?: Record<string, unknown>,
): void {
  console.error(`job failed: ${queue}${jobId ? ` (${jobId})` : ""}`, error);
  Sentry.withScope((scope) => {
    scope.setTag("queue", queue);
    if (jobId) scope.setTag("job_id", jobId);
    if (context) scope.setContext("job", context);
    Sentry.captureException(error);
  });
}

export { Sentry };
