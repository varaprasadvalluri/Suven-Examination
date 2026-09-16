import swaggerJsdoc from 'swagger-jsdoc';

// Auto-generated from `@openapi` JSDoc blocks on the route handlers themselves (see
// server/routes/**/*.ts) — the spec stays next to the code it describes instead of drifting
// out of sync in a hand-maintained doc page. Framework-agnostic OpenAPI 3 output, so it
// keeps working as a stable API contract even if the server implementation is swapped out
// later (see the swappable-backend/DB architecture principle tracked for this project).
const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Suven Examination API',
      version: '1.0.0',
      description:
        'REST API for the Suven Examination platform: authentication, school/student onboarding, exam/question management, attempts, and admin operations.'
    },
    servers: [{ url: '/', description: 'Current host' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description:
            'Session token issued by /api/auth/validate, /api/auth/create-profile, /api/gatekeeper/enroll, or /api/gatekeeper/student-login. Sent as `Authorization: Bearer <token>`.'
        }
      }
    },
    security: [{ bearerAuth: [] }]
  },
  // Path is relative to process.cwd(). It must track wherever the HTTP layer actually lives:
  // the hexagonal move relocated the routes out of server/routes/ and this glob silently kept
  // matching nothing, producing a valid-but-empty spec and a blank docs page. swagger-jsdoc
  // does not warn about a glob with no matches, so swagger.test.ts asserts the spec is
  // non-empty instead.
  apis: ['./server/adapters/in/http/routes/**/*.ts']
};

export const openApiSpec = swaggerJsdoc(options);
