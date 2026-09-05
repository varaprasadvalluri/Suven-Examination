#!/usr/bin/env node
// Local OpenTelemetry trace viewer. Zero dependencies, no Docker, no daemon.
//
// Speaks just enough OTLP/HTTP to be the endpoint that server/telemetry.ts already exports to
// when OTEL_EXPORTER=otlp, then draws each finished trace as a waterfall in the terminal —
// the same shape Cloud Trace shows in its console, minus the browser.
//
//   Terminal 1:  npm run trace:viewer
//   Terminal 2:  npm run build && OTEL_TRACES_ENABLED=true OTEL_EXPORTER=otlp npm start
//
// A trace prints once no new span for it has arrived for FLUSH_IDLE_MS. Spans arrive in
// batches and out of order, and a parent always ends after its children, so there is no
// "trace complete" signal to wait for — idle time is the practical substitute.
import http from 'node:http';
import zlib from 'node:zlib';

const PORT = Number(process.env.TRACE_VIEWER_PORT || 4318);
const FLUSH_IDLE_MS = Number(process.env.TRACE_VIEWER_IDLE_MS || 900);
const BAR_WIDTH = 34;
const NAME_WIDTH = 46;

// Honour NO_COLOR, and drop colour when the output is piped to a file.
const useColor = !process.env.NO_COLOR && process.stdout.isTTY;
const paint = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const dim = (t) => paint('2', t);
const bold = (t) => paint('1', t);
const cyan = (t) => paint('36', t);
const green = (t) => paint('32', t);
const yellow = (t) => paint('33', t);
const red = (t) => paint('31', t);

/** OTLP/JSON encodes attribute values as a one-key wrapper object. Unwrap to a plain value. */
function attrValue(value) {
  if (!value || typeof value !== 'object') return value;
  if ('stringValue' in value) return value.stringValue;
  if ('intValue' in value) return Number(value.intValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('boolValue' in value) return value.boolValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(attrValue);
  return JSON.stringify(value);
}

function attrsToObject(list) {
  const out = {};
  for (const { key, value } of list || []) out[key] = attrValue(value);
  return out;
}

// int64 fields arrive as strings in OTLP/JSON. BigInt keeps nanosecond precision through the
// subtraction; only the (small) relative result is narrowed to a Number.
const nanos = (v) => (typeof v === 'bigint' ? v : BigInt(v ?? 0));
const nsToMs = (ns) => Number(ns) / 1e6;

const traces = new Map(); // traceId -> { spans: [], lastSeen: number }

function ingest(payload) {
  for (const resourceSpan of payload.resourceSpans || []) {
    const resource = attrsToObject(resourceSpan.resource?.attributes);
    for (const scopeSpan of resourceSpan.scopeSpans || []) {
      const scope = scopeSpan.scope?.name || 'unknown';
      for (const raw of scopeSpan.spans || []) {
        const span = {
          traceId: raw.traceId,
          spanId: raw.spanId,
          parentSpanId: raw.parentSpanId || null,
          name: raw.name,
          start: nanos(raw.startTimeUnixNano),
          end: nanos(raw.endTimeUnixNano),
          attributes: attrsToObject(raw.attributes),
          status: raw.status || {},
          links: raw.links || [],
          scope,
          service: resource['service.name'] || 'unknown'
        };
        const entry = traces.get(span.traceId) || { spans: [], lastSeen: 0 };
        entry.spans.push(span);
        entry.lastSeen = Date.now();
        traces.set(span.traceId, entry);
      }
    }
  }
}

/** One line of context per span — the attributes worth reading without opening a UI. */
function summarize(span) {
  const a = span.attributes;
  const bits = [];
  if (a['http.response.status_code']) bits.push(`status=${a['http.response.status_code']}`);
  if (a['db.collection']) bits.push(`collection=${a['db.collection']}`);
  if (a['batch.size']) bits.push(`batch=${a['batch.size']}`);
  if (a['attempt.id']) bits.push(`attempt=${a['attempt.id']}`);
  if (a['task.retry_count']) bits.push(`retry=${a['task.retry_count']}`);
  if (span.links.length) bits.push(`links=${span.links.length}`);
  if (span.status?.code === 2) bits.push(`ERROR${span.status.message ? ': ' + span.status.message : ''}`);
  return bits.join(' ');
}

function render(traceId, spans) {
  spans.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const traceStart = spans[0].start;
  const traceEnd = spans.reduce((max, s) => (s.end > max ? s.end : max), spans[0].end);
  const totalMs = Math.max(nsToMs(traceEnd - traceStart), 0.001);

  // Children by parent, so the tree can be walked from its roots. A span whose parent is in
  // another batch (or was never sampled) is treated as a root — printing it detached beats
  // dropping it.
  const byParent = new Map();
  const known = new Set(spans.map((s) => s.spanId));
  for (const span of spans) {
    const key = span.parentSpanId && known.has(span.parentSpanId) ? span.parentSpanId : '__root__';
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(span);
  }

  const errors = spans.filter((s) => s.status?.code === 2).length;
  console.log('');
  console.log(
    `${bold(cyan('trace'))} ${bold(traceId)}  ${dim(`${spans.length} spans · ${totalMs.toFixed(1)}ms · ${spans[0].service}`)}` +
      (errors ? `  ${red(`${errors} error${errors > 1 ? 's' : ''}`)}` : '')
  );
  console.log(dim('─'.repeat(NAME_WIDTH + BAR_WIDTH + 12)));

  const walk = (parentKey, depth) => {
    for (const span of byParent.get(parentKey) || []) {
      const offsetMs = nsToMs(span.start - traceStart);
      const durationMs = Math.max(nsToMs(span.end - span.start), 0);

      const offsetCols = Math.min(BAR_WIDTH - 1, Math.floor((offsetMs / totalMs) * BAR_WIDTH));
      const widthCols = Math.max(1, Math.min(BAR_WIDTH - offsetCols, Math.round((durationMs / totalMs) * BAR_WIDTH)));

      const indent = depth === 0 ? '' : '  '.repeat(depth - 1) + '└ ';
      const label = (indent + span.name).slice(0, NAME_WIDTH).padEnd(NAME_WIDTH);
      const isError = span.status?.code === 2;
      const bar = ' '.repeat(offsetCols) + (isError ? red('█'.repeat(widthCols)) : green('█'.repeat(widthCols)));
      const barPad = ' '.repeat(BAR_WIDTH - offsetCols - widthCols);
      const time = `${durationMs.toFixed(1)}ms`.padStart(8);
      const note = summarize(span);

      console.log(`${label} ${bar}${barPad} ${dim(time)}${note ? '  ' + yellow(note) : ''}`);
      walk(span.spanId, depth + 1);
    }
  };

  walk('__root__', 0);
}

setInterval(() => {
  const now = Date.now();
  for (const [traceId, entry] of traces) {
    if (now - entry.lastSeen < FLUSH_IDLE_MS) continue;
    traces.delete(traceId);
    render(traceId, entry.spans);
  }
}, 250);

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.startsWith('/v1/traces')) {
    res.writeHead(404).end();
    return;
  }

  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    // Always answer OK first. A viewer that 500s makes the exporter retry, which distorts the
    // very timings you started it to look at.
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"partialSuccess":{}}');

    let body = Buffer.concat(chunks);
    try {
      if (req.headers['content-encoding'] === 'gzip') body = zlib.gunzipSync(body);
      const type = req.headers['content-type'] || '';
      if (!type.includes('json')) {
        console.error(
          red(`Received ${type || 'unknown'} — this viewer reads OTLP/JSON only. Unset OTEL_EXPORTER_OTLP_PROTOCOL or set it to http/json.`)
        );
        return;
      }
      ingest(JSON.parse(body.toString('utf8')));
    } catch (err) {
      console.error(red(`Could not parse an OTLP payload: ${err.message}`));
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(bold(cyan('OpenTelemetry trace viewer')));
  console.log(dim(`listening on http://localhost:${PORT}/v1/traces — each trace prints ${FLUSH_IDLE_MS}ms after its last span`));
  console.log(dim('run the server with: OTEL_TRACES_ENABLED=true OTEL_EXPORTER=otlp npm start'));
});

process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});
