// OpenTelemetry bootstrap. MUST be the first import in server.ts, above express and every
// other module: the auto-instrumentations patch module exports at load time, so anything
// already imported when sdk.start() runs is invisible to them and silently produces no spans.
//
// Loads its own env first — server.ts imports ./server/loadEnv further down its import list,
// which is too late for the exporter's credentials in local dev. dotenv.config() twice is a
// no-op, so importing it here costs nothing.
import './loadEnv';

import cluster from 'cluster';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { TraceExporter } from '@google-cloud/opentelemetry-cloud-trace-exporter';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ConsoleSpanExporter, SimpleSpanProcessor, type SpanExporter } from '@opentelemetry/sdk-trace-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import {
  AlwaysOnSampler,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  type Sampler,
  type SamplingResult
} from '@opentelemetry/sdk-trace-node';
import type { Attributes, Context, Link, SpanKind } from '@opentelemetry/api';

// Tracing is on in production, and opt-in everywhere else. Without this a local `npm run dev`
// would try to authenticate to Cloud Trace on every request and log a credentials error per
// span batch — noise that teaches everyone to ignore telemetry errors.
const ENABLED = process.env.NODE_ENV === 'production' || process.env.OTEL_TRACES_ENABLED === 'true';

// Where spans go. Cloud Trace in production; the other two exist so a trace can be read on a
// laptop before anything reaches GCP.
//
//   gcp      (default) Google Cloud Trace. Needs credentials.
//   console  Prints each span to stdout as it ends. No infrastructure, no credentials.
//   otlp     POSTs OTLP/HTTP to OTEL_EXPORTER_OTLP_ENDPOINT (default localhost:4318) — point
//            it at any collector or local trace UI that speaks OTLP.
type ExporterKind = 'gcp' | 'console' | 'otlp';
const EXPORTER = (process.env.OTEL_EXPORTER || 'gcp') as ExporterKind;

function buildExporter(): SpanExporter {
  if (EXPORTER === 'console') return new ConsoleSpanExporter();
  if (EXPORTER === 'otlp') {
    return new OTLPTraceExporter({
      url: `${(process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318').replace(/\/+$/, '')}/v1/traces`
    });
  }
  return new TraceExporter();
}

// A flat sampling ratio is the wrong instrument for this workload. A 90-minute exam sends
// roughly 180 autosave writes per student against exactly ONE submission, so autosaves are
// ~94% of all traffic: a uniform 5% keeps nine autosaves for every submission it drops.
// Decide by what the span actually is instead.
const ALWAYS_SAMPLE = [
  /attempt\.submit/,
  /grading\.attempt/,
  /exam-entry/,
  /writeQueue\.flush/,
  /internal\/grading-tasks/,
  /client-errors/
];

const RARELY_SAMPLE = [/attempt\.autosave/, /api\/db\/write/];

const RARE_RATIO = Number(process.env.OTEL_SAMPLE_RATIO_AUTOSAVE ?? 0.01);
const NORMAL_RATIO = Number(process.env.OTEL_SAMPLE_RATIO_DEFAULT ?? 0.1);

class RouteSampler implements Sampler {
  private readonly rare = new TraceIdRatioBasedSampler(RARE_RATIO);
  private readonly normal = new TraceIdRatioBasedSampler(NORMAL_RATIO);
  private readonly always = new AlwaysOnSampler();

  shouldSample(
    context: Context,
    traceId: string,
    spanName: string,
    spanKind: SpanKind,
    attributes: Attributes,
    links: Link[]
  ): SamplingResult {
    // http.route is only set once express has matched the route, which happens AFTER this
    // decision — so the request path is what to match on in practice. url.path is the stable
    // semantic convention; http.target is the older name, kept for any instrumentation still
    // emitting it. Getting this key wrong is silent: every route falls through to the default
    // ratio and the always-sample list quietly does nothing.
    const subject = String(attributes['http.route'] ?? attributes['url.path'] ?? attributes['http.target'] ?? spanName);

    // Typed as the Sampler interface on purpose: the concrete sampler classes each declare
    // only the parameters they actually read (TraceIdRatioBasedSampler takes two), so without
    // this the call below is checked against the narrowest of them.
    const delegate: Sampler = ALWAYS_SAMPLE.some((pattern) => pattern.test(subject) || pattern.test(spanName))
      ? this.always
      : RARELY_SAMPLE.some((pattern) => pattern.test(subject))
        ? this.rare
        : this.normal;

    return delegate.shouldSample(context, traceId, spanName, spanKind, attributes, links);
  }

  toString(): string {
    return `RouteSampler{autosave=${RARE_RATIO},default=${NORMAL_RATIO}}`;
  }
}

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'suven-examination',
    // Cloud Run injects K_REVISION/K_SERVICE. Having the revision on every span is what makes
    // "did the error start with the 11:02 deploy?" a one-filter question.
    [ATTR_SERVICE_VERSION]: process.env.K_REVISION || 'local',
    'deployment.environment': process.env.NODE_ENV || 'development'
  }),
  // The console exporter is only useful if spans appear as they end — the default batching
  // holds them for seconds, which reads like nothing is happening. Batch everywhere else.
  ...(EXPORTER === 'console'
    ? { spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())] }
    : { traceExporter: buildExporter() }),
  // ParentBased: once the browser (or an upstream service) has decided a trace is sampled,
  // every downstream span in it is kept. Without this you get half a waterfall — the exact
  // half you didn't need.
  // Locally, show everything: the point of the console exporter is to watch what happens, and
  // a 10% ratio means most requests print nothing at all, which reads as "it isn't working".
  sampler: EXPORTER === 'console' ? new AlwaysOnSampler() : new ParentBasedSampler({ root: new RouteSampler() }),
  instrumentations: [
    getNodeAutoInstrumentations({
      // Liveness and readiness probes run every few seconds on every instance. At 100
      // instances that is pure volume with no diagnostic value.
      '@opentelemetry/instrumentation-http': {
        ignoreIncomingRequestHook: (request) => !!request.url?.includes('/health/')
      },
      // Spans for every file read the SPA static handler performs. Off.
      '@opentelemetry/instrumentation-fs': { enabled: false }
    })
  ]
});

// The cluster primary forks workers and serves nothing (see the cluster block in server.ts),
// so starting an exporter there would hold an idle connection per instance and export
// nothing but its own startup. Same condition as server.ts's primary branch.
const isClusterPrimary = process.env.NODE_ENV === 'production' && cluster.isPrimary;

if (ENABLED && !isClusterPrimary) {
  sdk.start();

  // Cloud Run sends SIGTERM before it stops routing traffic, and lifecycle.ts already drains
  // the write queue on that signal. Spans need the same courtesy: without a flush, the last
  // few seconds before a shutdown — which is exactly when a crash-related span exists — never
  // leave the container.
  process.on('SIGTERM', () => {
    void sdk.shutdown();
  });
}

export { sdk };
