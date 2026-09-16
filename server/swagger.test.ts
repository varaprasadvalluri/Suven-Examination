import { describe, it, expect } from 'vitest';
import { openApiSpec } from './swagger';

/**
 * The spec is built by scanning route files with a filesystem glob. A glob that matches
 * nothing does not throw — swagger-jsdoc returns a structurally valid document with no
 * paths — so moving the route files silently produced a blank API-docs page that typecheck,
 * lint, tests and build all passed. These assertions are the thing that would have caught it.
 */
describe('openApiSpec', () => {
  const spec = openApiSpec as { paths?: Record<string, unknown>; info?: { title?: string } };

  it('documents a substantial number of routes', () => {
    const paths = Object.keys(spec.paths || {});
    // 46 at the time of writing; the floor guards against the glob silently going stale
    // without needing an update every time a route is added.
    expect(paths.length).toBeGreaterThan(30);
  });

  it('includes the endpoints the exam flow depends on', () => {
    const paths = Object.keys(spec.paths || {});
    for (const expected of ['/api/v1/attempts/{attemptId}/submit', '/api/internal/grade-attempt']) {
      expect(paths).toContain(expected);
    }
  });

  it('carries the security scheme the docs page authenticates with', () => {
    expect((spec as any).components?.securitySchemes?.bearerAuth).toBeDefined();
  });
});
