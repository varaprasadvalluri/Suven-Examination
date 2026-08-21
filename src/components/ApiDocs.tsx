import React, { useEffect, useState } from 'react';
import SwaggerUI from 'swagger-ui-react';
import 'swagger-ui-react/swagger-ui.css';
import { authHeaders } from '../lib/sessionStore';
import { Loader2, AlertCircle } from 'lucide-react';

// Real OpenAPI/Swagger docs, generated server-side from `@openapi` JSDoc blocks on the route
// handlers (server/swagger.ts + server/routes/**/*.ts) — auto-generated, so it can't drift
// out of sync with the actual endpoints the way a hand-maintained doc page could. Fetched
// (not statically embedded) so it always reflects the currently running server, and fetched
// with the same authenticated fetch pattern (Bearer session header) every other v1 API call
// in this app uses, since the server route that serves the spec is admin-gated.
export const ApiDocs: React.FC = () => {
  const [spec, setSpec] = useState<object | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api-docs.json', { headers: authHeaders() })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load API spec (status ${res.status})`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setSpec(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load API spec');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 px-4 text-center">
        <AlertCircle className="h-8 w-8 text-rose-500" />
        <p className="text-sm font-semibold text-slate-700">{error}</p>
      </div>
    );
  }

  if (!spec) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Loading API spec...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto p-2 sm:p-4">
      <SwaggerUI spec={spec} />
    </div>
  );
};
