// Per-request trace id, propagated implicitly through async calls — the Node equivalent of
// Java's MDC (`MDC.put("traceId", ...)`) / Spring Cloud Sleuth. Registered as the first
// middleware in server.ts so every downstream router, DAO call, and thrown error runs
// inside this context without any function signature changing to carry a traceId parameter
// — logger.ts and errorHandler.ts both just call getTraceId() when they need it.
import { trace } from '@opentelemetry/api';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';

interface RequestContext {
  traceId: string;
}

const als = new AsyncLocalStorage<RequestContext>();

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction) {
  // Prefer the real OpenTelemetry trace id when tracing is on, so the id in the logs, the id
  // in the X-Request-Id response header, and the id in Cloud Trace are all the same string —
  // one thing to paste into one search box. Falls back to the previous behaviour (an incoming
  // header, else a fresh UUID) when tracing is disabled, e.g. in local dev.
  const activeTraceId = trace.getActiveSpan()?.spanContext().traceId;
  const incoming = req.headers['x-request-id'];
  const traceId = activeTraceId || (typeof incoming === 'string' && incoming.trim()) || randomUUID();
  res.setHeader('X-Request-Id', traceId);
  als.run({ traceId }, () => next());
}

export function getTraceId(): string | undefined {
  return als.getStore()?.traceId;
}
