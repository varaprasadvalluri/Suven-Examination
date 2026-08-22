import express from 'express';
import { asyncHandler } from '../middleware/errorHandler';
import { clientErrorReportLimiter } from '../middleware/rateLimit';
import { logger } from '../lib/logger';
import { getTraceId } from '../lib/requestContext';

const router = express.Router();

// Diagnostics sink for client-side crashes (React render crashes, mapped fetch/auth
// exceptions) — see src/lib/customErrors.ts's reportClientCrash(). No requireSession: a
// crash can happen before login (e.g. on LoginPage itself), so this must accept
// unauthenticated calls. Own small JSON body limit (not the global 2mb one) since a crash
// report is a message + stack + small context object, never a large payload.
router.post(
  '/api/client-errors',
  clientErrorReportLimiter,
  express.json({ limit: '20kb' }),
  asyncHandler(async (req, res) => {
    const { message, stack, code, action, traceId, url, userAgent } = req.body || {};

    // warn, not error: reaching this endpoint means the client already caught the
    // exception (ErrorBoundary / window listener) — it's diagnostic, not an unhandled
    // server failure. Field is named clientMessage, not message — logger.ts's context
    // spread would otherwise silently overwrite this entry's own top-level "message".
    logger.warn('Client-reported error', {
      clientMessage: message,
      stack,
      code,
      action,
      url,
      userAgent,
      clientTraceId: traceId,
      reqTraceId: getTraceId()
    });

    res.status(202).json({ received: true });
  })
);

export default router;
