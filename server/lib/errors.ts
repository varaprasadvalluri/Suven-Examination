// Typed exception hierarchy — the Spring Boot equivalent is a custom `RuntimeException`
// subclass annotated `@ResponseStatus(HttpStatus.X)`. Throw one of these from any route
// handler wrapped in `asyncHandler` (see errorHandler.ts) and the global error middleware
// (Express's closest analog to `@ControllerAdvice` + `@ExceptionHandler`) maps it to the
// right HTTP status/body automatically — no manual `res.status(x).json(...)` needed.
//
// Spring Boot ↔ here:
//   custom RuntimeException + @ResponseStatus  ↔  AppError subclass below
//   @ControllerAdvice + @ExceptionHandler      ↔  errorHandler (middleware/errorHandler.ts)
//   exception escaping a @Controller method    ↔  rejected promise → asyncHandler → next(err)
//   SLF4J/Logback                              ↔  logger.ts
//   MDC traceId / Sleuth                       ↔  requestContext.ts (AsyncLocalStorage)
//
// `details` carries any extra structured fields the response body should include alongside
// {error, code, traceId} — e.g. an attemptId a specific failure needs to hand back to the
// frontend. Keep it a plain object (or omit it) since errorHandler spreads it into the JSON body.

export abstract class AppError extends Error {
  abstract readonly status: number;
  abstract readonly code: string;

  constructor(
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = new.target.name;
    if (Error.captureStackTrace) Error.captureStackTrace(this, new.target);
  }
}

export class BadRequestError extends AppError {
  readonly status = 400;
  readonly code = 'BAD_REQUEST';
}

export class UnauthorizedError extends AppError {
  readonly status = 401;
  readonly code = 'UNAUTHORIZED';
}

export class ForbiddenError extends AppError {
  readonly status = 403;
  readonly code = 'FORBIDDEN';
}

export class NotFoundError extends AppError {
  readonly status = 404;
  readonly code = 'NOT_FOUND';
}

export class ConflictError extends AppError {
  readonly status = 409;
  readonly code = 'CONFLICT';
}

export class GoneError extends AppError {
  readonly status = 410;
  readonly code = 'GONE';
}

export class UnprocessableEntityError extends AppError {
  readonly status = 422;
  readonly code = 'UNPROCESSABLE_ENTITY';
}

export class TooManyRequestsError extends AppError {
  readonly status = 429;
  readonly code = 'TOO_MANY_REQUESTS';
}

export class InternalServerError extends AppError {
  readonly status = 500;
  readonly code = 'INTERNAL_ERROR';
}
