/**
 * A non-empty, human-readable reason for an error. Some clients throw errors
 * with an empty message (Elasticsearch's ConnectionError, ioredis'
 * AggregateError), which would otherwise log as a blank reason.
 */
export function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  if (err.message) return err.message;
  const inner =
    err instanceof AggregateError && err.errors.length
      ? err.errors[0]
      : err.cause instanceof Error
        ? err.cause
        : undefined;
  const code = (err as { code?: unknown }).code;
  return `${err.name}${code ? ` (${String(code)})` : ""}${inner ? `: ${describeError(inner)}` : ""}`;
}
