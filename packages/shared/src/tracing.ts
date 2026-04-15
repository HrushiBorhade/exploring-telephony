/**
 * Trace context propagation through BullMQ jobs.
 *
 * Injects the current OTel trace context into job data at enqueue time,
 * and extracts it at worker time to continue the distributed trace.
 */

/**
 * Inject current trace context into a carrier object.
 * Call this before enqueuing a BullMQ job:
 *   const carrier = injectTraceContext();
 *   await queue.add("job", { ...data, _trace: carrier });
 */
export function injectTraceContext(): Record<string, string> {
  try {
    const { context, propagation } = require("@opentelemetry/api");
    const carrier: Record<string, string> = {};
    propagation.inject(context.active(), carrier);
    return carrier;
  } catch {
    // OTel not loaded — return empty carrier (no-op in dev)
    return {};
  }
}

/**
 * Extract trace context from job data and run a callback within it.
 * Call this at the start of job processing:
 *   extractTraceContext(job.data._trace, () => { ... process job ... });
 */
export function extractTraceContext<T>(
  carrier: Record<string, string> | undefined,
  fn: () => T,
): T {
  if (!carrier || Object.keys(carrier).length === 0) return fn();

  try {
    const { context, propagation } = require("@opentelemetry/api");
    const extractedCtx = propagation.extract(context.active(), carrier);
    return context.with(extractedCtx, fn);
  } catch {
    return fn();
  }
}
