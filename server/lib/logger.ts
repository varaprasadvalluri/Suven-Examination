// Structured JSON logger — no new npm dependency. Cloud Run/Cloud Logging natively parses a
// single-line JSON object written to stdout/stderr as a structured log entry: `severity`
// becomes the entry's log level (filterable in Cloud Logging), everything else becomes
// queryable jsonPayload fields. That's the actual production-observability gap this app had
// (console.error/warn scattered with no structure, no request context, unfilterable by
// severity in Cloud Logging) — not a missing external service like Sentry, which would be a
// reasonable later addition but isn't what's missing here.
//
// Usage: logger.info('message', { attemptId, studentId }) / logger.warn(...) / logger.error(...)
// The `message` is always a short human string; put identifiers/context in the second arg so
// they show up as structured fields instead of being interpolated into unparseable text.
//
// This is the pattern for new/touched code going forward — not a mass migration of every
// existing console.* call in the codebase (see server/lib/logger.ts's sibling comment in the
// project's quality-pass notes for why that's an intentional follow-up, not done in one pass).

import { getTraceId } from './requestContext';

type LogContext = Record<string, unknown>;

function write(severity: 'INFO' | 'WARNING' | 'ERROR', message: string, context?: LogContext) {
  const entry: Record<string, unknown> = { severity, message, timestamp: new Date().toISOString() };
  const traceId = getTraceId();
  if (traceId) entry.traceId = traceId;
  if (context) {
    for (const [key, value] of Object.entries(context)) {
      // Error objects don't serialize usefully via plain JSON.stringify (message/stack are
      // non-enumerable) — expand them explicitly so they actually show up in the log entry.
      entry[key] = value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value;
    }
  }
  const line = JSON.stringify(entry);
  if (severity === 'ERROR') {
    console.error(line);
  } else if (severity === 'WARNING') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (message: string, context?: LogContext) => write('INFO', message, context),
  warn: (message: string, context?: LogContext) => write('WARNING', message, context),
  error: (message: string, context?: LogContext) => write('ERROR', message, context)
};
