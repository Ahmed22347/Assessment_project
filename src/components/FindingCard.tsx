import { AlertTriangle, Quote, ShieldQuestion } from 'lucide-react';
import type { Finding } from '../../shared/types';
import { CATEGORY_LABEL, CERTAINTY_LABEL, SEVERITY_STYLE } from '../lib/labels';
import type { ActiveEvidence } from './TranscriptPanel';

interface Props {
  index: number;
  finding: Finding;
  selected: boolean;
  activeKey: string | null;
  onSelect: () => void;
  onEvidence: (e: ActiveEvidence) => void;
}

export function FindingCard({ index, finding: f, selected, activeKey, onSelect, onEvidence }: Props) {
  return (
    <article
      className={`rounded-md border bg-white p-3 text-sm ${selected ? 'border-navy-600 ring-1 ring-navy-600' : 'border-slate-200'}`}
      onClick={onSelect}
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-slate-400">#{index}</span>
        <span className="font-semibold text-slate-900">{CATEGORY_LABEL[f.category]}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset ${SEVERITY_STYLE[f.severity]}`}>{f.severity}</span>
        <span className={`inline-flex items-center gap-1 text-xs ${f.certainty === 'possible' ? 'text-violet-700' : 'text-slate-500'}`}>
          {f.certainty === 'possible' && <ShieldQuestion className="h-3.5 w-3.5" />}
          {CERTAINTY_LABEL[f.certainty]}
        </span>
      </header>

      <p className="mt-2 text-slate-700">{f.explanation}</p>

      {f.summaryClaim && (
        <div className="mt-2">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Summary claim</div>
          <p className="mt-0.5 rounded bg-red-50/60 px-2 py-1 text-slate-800">“{f.summaryClaim}”</p>
        </div>
      )}

      {f.transcriptEvidence.length > 0 && (
        <div className="mt-2">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Transcript evidence</div>
          <ul className="mt-0.5 space-y-1">
            {f.transcriptEvidence.map((e, i) => {
              const key = `${index}-${i}`;
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={(ev) => { ev.stopPropagation(); onSelect(); onEvidence({ turnId: e.turnId, quote: e.quote, key }); }}
                    className={`flex w-full items-start gap-2 rounded px-2 py-1 text-left hover:bg-amber-50 ${activeKey === key ? 'bg-amber-50' : 'bg-slate-50'}`}
                    title="Show in transcript"
                  >
                    <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <span className="flex-1">
                      <span className="mr-1 font-mono text-xs text-navy-600">{e.turnId}</span>
                      <span className="text-slate-800">{e.quote}</span>
                      {e.verified === false && (
                        <span className="mt-0.5 flex items-center gap-1 text-xs font-medium text-red-700">
                          <AlertTriangle className="h-3 w-3" /> Quote not found verbatim in transcript — verify manually
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {f.suggestedCorrection && (
        <div className="mt-2">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Suggested correction</div>
          <p className="mt-0.5 rounded bg-emerald-50/60 px-2 py-1 text-slate-800">{f.suggestedCorrection}</p>
        </div>
      )}
    </article>
  );
}
