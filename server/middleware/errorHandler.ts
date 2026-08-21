import { Request, Response, NextFunction, RequestHandler } from 'express';
import { logger } from '../lib/logger';

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
  logger.error('Unhandled request error', { method: req.method, url: req.originalUrl, error: err });
  if (res.headersSent) return;
  const status = typeof err?.status === 'number' ? err.status : 500;
  res.status(status).json({ error: err?.message || String(err) });
}
