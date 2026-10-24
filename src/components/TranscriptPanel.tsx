import { useEffect, useMemo, useRef } from 'react';
import { parseTranscript } from '../../shared/transcript';
import { HighlightedText } from './HighlightedText';

export interface ActiveEvidence { turnId: string; quote: string; key: string }

const SPEAKER_STYLE: Record<string, string> = {
  Agent: 'border-navy-600 bg-navy-50/50',
  Customer: 'border-emerald-500 bg-white',
  'Transcript note': 'border-slate-300 bg-slate-50 italic text-slate-500',
};
const LABEL_STYLE: Record<string, string> = { Agent: 'text-navy-700', Customer: 'text-emerald-700' };

export function TranscriptPanel({ transcript, active, evidenceTurns }: { transcript: string; active: ActiveEvidence | null; evidenceTurns: Map<string, number[]> }) {
  const turns = useMemo(() => parseTranscript(transcript), [transcript]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    const el = containerRef.current?.querySelector(`[data-turn="${CSS.escape(active.turnId)}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [active]);

  return (
    <div ref={containerRef} className="space-y-2 p-4">
      {turns.map((t) => {
        const isActive = active?.turnId === t.turnId;
        const refs = evidenceTurns.get(t.turnId);
        return (
          <div
            key={t.turnId}
            data-turn={t.turnId}
            className={`rounded-md border-l-4 px-3 py-2 text-sm leading-relaxed transition-shadow ${SPEAKER_STYLE[t.speaker] ?? 'border-violet-400 bg-violet-50/40'} ${isActive ? 'ring-2 ring-amber-400' : ''}`}
          >
            <div className="mb-0.5 flex items-center gap-2 text-xs">
              <span className="font-mono text-slate-400">{t.turnId}</span>
              {t.timestamp && <span className="font-mono text-slate-400">[{t.timestamp}]</span>}
              <span className={`font-semibold ${LABEL_STYLE[t.speaker] ?? 'text-violet-700'}`}>{t.speaker}</span>
              {refs && (
                <span className="ml-auto rounded bg-amber-100 px-1.5 text-[11px] font-medium text-amber-800" title="Cited as evidence by AI finding(s)">
                  Finding {refs.join(', ')}
                </span>
              )}
            </div>
            <p className="whitespace-pre-wrap text-slate-800">
              <HighlightedText text={t.text} quote={isActive ? active.quote : null} />
            </p>
          </div>
        );
      })}
    </div>
  );
}
