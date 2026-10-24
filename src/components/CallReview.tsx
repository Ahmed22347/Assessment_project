import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Bot, ChevronLeft, ChevronRight, FileText, Info, Loader2, MessagesSquare, RefreshCw, Sparkles } from 'lucide-react';
import type { AppCall, ReviewRecord } from '../../shared/types';
import { reviewStatus } from '../../shared/validation';
import { formatDate, formatDateTime, REC_LABEL } from '../lib/labels';
import { AiBadge, StatusBadge } from './Badges';
import { FindingCard } from './FindingCard';
import { HighlightedText } from './HighlightedText';
import { ReviewerPanel } from './ReviewerPanel';
import { TranscriptPanel, type ActiveEvidence } from './TranscriptPanel';

interface Props {
  call: AppCall;
  review: ReviewRecord | undefined;
  prevId: string | null;
  nextId: string | null;
  position: string;
  onNavigate: (id: string | null) => void;
  canSave: boolean;
  canAnalyse: boolean;
  analysing: boolean;
  analyseError: string | null;
  analyseNotice: string | null;
  onAnalyse: () => void;
  onSaved: (r: ReviewRecord) => void;
}

export function CallReview(p: Props) {
  const { call, review } = p;
  const ai = review?.ai ?? null;
  const [selected, setSelected] = useState<number | null>(null);
  const [active, setActive] = useState<ActiveEvidence | null>(null);
  const [dirty, setDirty] = useState(false);
  const onDirtyChange = useCallback((d: boolean) => setDirty(d), []);

  const evidenceTurns = useMemo(() => {
    const m = new Map<string, number[]>();
    ai?.findings.forEach((f, i) => f.transcriptEvidence.forEach((e) => {
      const list = m.get(e.turnId) ?? [];
      if (!list.includes(i + 1)) list.push(i + 1);
      m.set(e.turnId, list);
    }));
    return m;
  }, [ai]);

  const selectedClaim = selected !== null ? ai?.findings[selected - 1]?.summaryClaim : null;

  const go = (id: string | null) => {
    if (dirty && !confirm('You have unsaved review changes. Leave this call without saving?')) return;
    setSelected(null); setActive(null);
    p.onNavigate(id);
  };

  return (
    <div className="flex flex-col lg:h-[calc(100vh-3.5rem)]">
      {/* Call header */}
      <div className="border-b border-slate-200 bg-white px-6 py-3">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2">
          <button onClick={() => go(null)} className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-navy-700">
            <ArrowLeft className="h-4 w-4" /> All calls
          </button>
          <h1 className="text-lg font-semibold text-slate-900">{call.id}</h1>
          <span className="text-sm text-slate-500">{formatDate(call.call_date)}{call.estimated_duration ? ` · ${call.estimated_duration}` : ''}{call.source === 'uploaded' ? ' · Uploaded' : ''}</span>
          <div className="flex items-center gap-2">
            <AiBadge recommendation={ai?.recommendation} />
            <StatusBadge status={reviewStatus(review)} />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <span className="mr-2 text-xs text-slate-500">{p.position}</span>
            <button onClick={() => go(p.prevId)} disabled={!p.prevId} aria-label="Previous call" className="rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
            <button onClick={() => go(p.nextId)} disabled={!p.nextId} aria-label="Next call" className="rounded-md border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-[1600px] flex-1 grid-cols-1 gap-4 p-4 lg:min-h-0 lg:grid-cols-2">
        {/* Left: summary, AI assessment, reviewer decision */}
        <div className="space-y-4 lg:min-h-0 lg:overflow-y-auto lg:pr-1">
          <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
              <FileText className="h-4 w-4 text-navy-700" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Generated summary</h2>
              <span className="ml-auto text-xs text-slate-400">Original — not modified</span>
            </header>
            <p className="whitespace-pre-wrap p-4 text-[15px] leading-relaxed text-slate-800">
              <HighlightedText text={call.summary} quote={selectedClaim} />
            </p>
            {review?.human?.correctedSummary && (
              <div className="border-t border-slate-200 bg-amber-50/40 px-4 py-3">
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-amber-800">Reviewer's corrected summary (saved)</div>
                <p className="whitespace-pre-wrap text-sm text-slate-800">{review.human.correctedSummary}</p>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-dashed border-slate-300 bg-slate-50/80 shadow-sm">
            <header className="flex flex-wrap items-center gap-2 border-b border-dashed border-slate-300 px-4 py-3">
              <Bot className="h-4 w-4 text-navy-700" />
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">AI assessment</h2>
              <span className="text-xs text-slate-500">Advisory only</span>
              <button
                onClick={() => {
                  if (ai && !confirm('This call already has an AI analysis. Run a new (paid) analysis and replace it?')) return;
                  p.onAnalyse();
                }}
                disabled={!p.canAnalyse || p.analysing}
                title={p.canAnalyse ? undefined : 'AI analysis is not configured on the server'}
                className="ml-auto inline-flex items-center gap-2 rounded-md bg-navy-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-navy-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {p.analysing ? <Loader2 className="h-4 w-4 animate-spin" /> : ai ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                {p.analysing ? 'Analysing…' : ai ? 'Re-analyse' : 'Analyse with AI'}
              </button>
            </header>
            <div className="space-y-3 p-4">
              {p.analyseError && <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{p.analyseError}</div>}
              {p.analyseNotice && <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><Info className="mt-0.5 h-4 w-4 shrink-0" />{p.analyseNotice}</div>}
              {p.analysing && <p className="text-sm text-slate-500">Checking the summary against the transcript and summary rules. This usually takes 10–60 seconds.</p>}
              {!ai && !p.analysing && (
                <p className="text-sm text-slate-500">
                  {p.canAnalyse ? 'No AI analysis yet. You can review manually, or run an analysis to get evidence-linked findings.' : 'AI analysis is unavailable (not configured). Manual review works as normal.'}
                </p>
              )}
              {ai && (
                <>
                  <div className="rounded-md bg-white p-3 text-sm ring-1 ring-slate-200">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-900">Recommendation: {REC_LABEL[ai.recommendation]}</span>
                      <span className="text-xs text-slate-500">Confidence: {ai.confidence}</span>
                    </div>
                    <p className="mt-1 text-slate-700">{ai.overallExplanation}</p>
                    <p className="mt-2 text-xs text-slate-400">{ai.model} · {formatDateTime(ai.analysedAt)} · {ai.findings.length} finding(s)</p>
                  </div>
                  {ai.warnings.length > 0 && (
                    <ul className="space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      {ai.warnings.map((w) => <li key={w} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{w}</li>)}
                    </ul>
                  )}
                  {ai.findings.map((f, i) => (
                    <FindingCard
                      key={i}
                      index={i + 1}
                      finding={f}
                      selected={selected === i + 1}
                      activeKey={active?.key ?? null}
                      onSelect={() => {
                        setSelected(i + 1);
                        const first = f.transcriptEvidence[0];
                        if (first && !active?.key.startsWith(`${i + 1}-`)) setActive({ turnId: first.turnId, quote: first.quote, key: `${i + 1}-0` });
                      }}
                      onEvidence={setActive}
                    />
                  ))}
                  {ai.suggestedSummary && (
                    <div className="rounded-md bg-white p-3 text-sm ring-1 ring-slate-200">
                      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">AI-suggested corrected summary</div>
                      <p className="whitespace-pre-wrap text-slate-800">{ai.suggestedSummary}</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>

          <ReviewerPanel call={call} review={review} canSave={p.canSave} onSaved={p.onSaved} onDirtyChange={onDirtyChange} />
        </div>

        {/* Right: transcript, independently scrollable */}
        <section className="flex h-[80vh] flex-col rounded-lg border border-slate-200 bg-white shadow-sm lg:h-auto lg:min-h-0">
          <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
            <MessagesSquare className="h-4 w-4 text-navy-700" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Original transcript</h2>
            <span className="ml-auto text-xs text-slate-400">Source of truth</span>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <TranscriptPanel transcript={call.transcript} active={active} evidenceTurns={evidenceTurns} />
          </div>
        </section>
      </div>
    </div>
  );
}
