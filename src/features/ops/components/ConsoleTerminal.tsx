import React from 'react';
import { Terminal } from 'lucide-react';

export interface ConsoleTerminalProps {
  /** Heading shown beside the terminal icon, e.g. "Migration Stream Console Output". */
  title: string;
  logs: string[];
  /** Shown while `logs` is empty — tells the operator what to press to produce output. */
  emptyMessage: string;
  /** Tailwind text colour for the terminal icon; each tool has its own accent. */
  accentClassName?: string;
}

// Log lines are plain strings, so severity is inferred from their content. Ordered
// deliberately: an error mentioning "completed" is still an error.
function toneFor(log: string): string {
  if (log.includes('[ERROR]') || log.includes('⚠️')) return 'text-rose-400 font-semibold';
  if (log.includes('success') || log.includes('successfully') || log.includes('completed')) return 'text-emerald-400 font-semibold';
  if (log.includes('[INFO]')) return 'text-indigo-400';
  return 'text-slate-300';
}

/**
 * The black terminal panel used by the operator tools.
 *
 * Existed twice in DatabaseMigrator (migration and seeding), identical but for the accent
 * colour, the heading and the empty-state text. The part worth having in one place is the
 * severity colouring: two copies of a substring check is two chances for an error line to
 * stop rendering red.
 *
 * ScalePerformanceHub has a visually similar terminal that is deliberately NOT built on this.
 * Its logs are structured records carrying an explicit `type` and a timestamp, so it does not
 * need to infer severity from substrings at all — folding it in here would replace a typed
 * signal with a weaker one.
 */
export const ConsoleTerminal: React.FC<ConsoleTerminalProps> = ({ title, logs, emptyMessage, accentClassName = 'text-indigo-400' }) => (
  <div className="border border-slate-900 bg-slate-950 rounded-[24px] p-6 text-slate-200 font-mono text-xs overflow-hidden shadow-2xl relative">
    <div className="absolute top-3 right-4 flex gap-1.5" aria-hidden="true">
      <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
      <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
    </div>
    <div className="flex items-center gap-2 border-b border-slate-800 pb-3 mb-4">
      <Terminal size={14} className={accentClassName} aria-hidden="true" />
      <span className="text-[11px] md:text-[10px] font-black uppercase text-slate-500 tracking-wider">{title}</span>
    </div>
    {/* Operator output arrives asynchronously; announce it politely rather than silently. */}
    <div role="log" aria-live="polite" aria-label={title} className="space-y-2 max-h-[240px] overflow-y-auto scroller-hide">
      {logs.length === 0 ? (
        <p className="text-slate-600 italic text-[12px] md:text-[11px] py-4 text-center">{emptyMessage}</p>
      ) : (
        logs.map((log, index) => (
          <div key={index} className="leading-relaxed whitespace-pre-wrap text-[12px] md:text-[11px]">
            <span className={toneFor(log)}>{log}</span>
          </div>
        ))
      )}
    </div>
  </div>
);
