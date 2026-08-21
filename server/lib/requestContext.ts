// Per-request trace id, propagated implicitly through async calls — the Node equivalent of
// Java's MDC (`MDC.put("traceId", ...)`) / Spring Cloud Sleuth. Registered as the first
// middleware in server.ts so every downstream router, DAO call, and thrown error runs
// inside this context without any function signature changing to carry a traceId parameter
// — logger.ts and errorHandler.ts both just call getTraceId() when they need it.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';

interface RequestContext {
  traceId: string;
}

const als = new AsyncLocalStorage<RequestContext>();

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers['x-request-id'];
  const traceId = (typeof incoming === 'string' && incoming.trim()) || randomUUID();
  res.setHeader('X-Request-Id', traceId);
  als.run({ traceId }, () => next());
}

export function getTraceId(): string | undefined {
  return als.getStore()?.traceId;
}
