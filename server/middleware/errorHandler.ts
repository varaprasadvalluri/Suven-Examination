import { Request, Response, NextFunction, RequestHandler } from 'express';
import { logger } from '../lib/logger';
import { AppError } from '../lib/errors';
import { getTraceId } from '../lib/requestContext';

// Wraps an async route handler so a rejected promise reaches Express's error pipeline
// (next(err)) instead of becoming an unhandled rejection. Route handlers no longer need
// their own generic `catch (err) { res.status(500)... }` — only branches with a specific,
// non-500 response (e.g. a domain error like EXAM_ALREADY_COMPLETED) still need a try/catch.
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Centralized error-handling middleware — must be registered LAST in server.ts, after every
// router. Any error passed to next(err) (including ones asyncHandler forwards) lands here
// exactly once, so every route returns the same {error} JSON shape on an unhandled failure
// instead of each file repeating its own try/catch/log/response boilerplate.
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  const status = err instanceof AppError ? err.status : typeof err?.status === 'number' ? err.status : 500;
  const code = err instanceof AppError ? err.code : 'INTERNAL_ERROR';
  const traceId = getTraceId();

  // 4xx = expected/client-caused (a missing doc, a forbidden write) → warn, not error, so
  // Cloud Logging alerting on ERROR severity doesn't page anyone for a plain 404. 5xx = truly
  // unexpected → error, same as Spring only alerting on unhandled RuntimeExceptions, not
  // every @ExceptionHandler-mapped business exception.
  const logFields = { method: req.method, url: req.originalUrl, status, code, error: err };
  if (status >= 500) {
    logger.error('Unhandled request error', logFields);
  } else {
    logger.warn('Request error', logFields);
  }

  if (res.headersSent) return;
  const details = err instanceof AppError && err.details && typeof err.details === 'object' ? err.details : {};
  res.status(status).json({ error: err?.message || String(err), code, traceId, ...details });
}
