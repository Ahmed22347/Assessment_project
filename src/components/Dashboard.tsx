import { useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, CircleDashed, ClipboardList, FileWarning, HelpCircle, Inbox, Search, Upload, Sparkles, Square } from 'lucide-react';
import type { AppCall, ReviewRecord, ReviewStatus } from '../../shared/types';
import { reviewStatus } from '../../shared/validation';
import { formatDate, formatDateTime, STATUS_LABEL } from '../lib/labels';
import { AiBadge, StatusBadge } from './Badges';

type Filter = 'all' | ReviewStatus;
const FILTERS: Filter[] = ['all', 'pending', 'accepted', 'needs_correction', 'unable_to_determine'];

interface Props {
  calls: AppCall[];
  reviews: Record<string, ReviewRecord>;
  onOpen: (id: string) => void;
  onUpload: () => void;
  canUpload: boolean;
  canAnalyse: boolean;
  batch: { running: boolean; done: number; total: number; errors: number };
  onBatchAnalyse: (ids: string[]) => void;
  onStopBatch: () => void;
}

function Stat({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-500">{label}</span>
        <span className={tone}>{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-900 tabular-nums">{value}</div>
    </div>
  );
}

export function Dashboard({ calls, reviews, onOpen, onUpload, canUpload, canAnalyse, batch, onBatchAnalyse, onStopBatch }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>(() => {
    try { return (localStorage.getItem('qa.filter') as Filter) || 'all'; } catch { return 'all'; }
  });
  const chooseFilter = (f: Filter) => {
    setFilter(f);
    try { localStorage.setItem('qa.filter', f); } catch { /* preference only */ }
  };

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: calls.length, pending: 0, accepted: 0, needs_correction: 0, unable_to_determine: 0 };
    for (const call of calls) c[reviewStatus(reviews[call.id])]++;
    return c;
  }, [calls, reviews]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return calls.filter((c) => {
      if (filter !== 'all' && reviewStatus(reviews[c.id]) !== filter) return false;
      if (!q) return true;
      const r = reviews[c.id];
      return [c.id, c.call_date, c.summary, c.transcript, r?.human?.notes].some((s) => s?.toLowerCase().includes(q));
    });
  }, [calls, reviews, filter, query]);

  const unanalysed = calls.filter((c) => !reviews[c.id]?.ai).map((c) => c.id);

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Call summary review</h1>
          <p className="mt-1 text-sm text-slate-500">Check AI-generated call summaries against their transcripts. The transcript is the source of truth.</p>
        </div>
        <div className="flex gap-2">
          {batch.running ? (
            <button onClick={onStopBatch} className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Square className="h-4 w-4" /> Stop ({batch.done}/{batch.total})
            </button>
          ) : (
            <button
              disabled={!canAnalyse || unanalysed.length === 0}
              title={!canAnalyse ? 'AI analysis is not configured' : unanalysed.length === 0 ? 'All calls have an AI analysis' : undefined}
              onClick={() => {
                if (confirm(`Run AI analysis on ${unanalysed.length} call(s) that have not been analysed? Each one is a paid API request.`)) onBatchAnalyse(unanalysed);
              }}
              className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" /> Analyse unanalysed ({unanalysed.length})
            </button>
          )}
          <button
            onClick={onUpload}
            disabled={!canUpload}
            title={canUpload ? undefined : 'Persistence is not configured'}
            className="inline-flex items-center gap-2 rounded-md bg-navy-700 px-3 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Upload className="h-4 w-4" /> Upload calls
          </button>
        </div>
      </div>
      {batch.total > 0 && !batch.running && (
        <p className="text-sm text-slate-600">Batch analysis finished: {batch.done - batch.errors} succeeded{batch.errors ? `, ${batch.errors} failed` : ''}.</p>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Stat label="Total calls" value={counts.all} icon={<ClipboardList className="h-5 w-5" />} tone="text-navy-600" />
        <Stat label="Reviewed" value={counts.all - counts.pending} icon={<CheckCircle2 className="h-5 w-5" />} tone="text-navy-600" />
        <Stat label="Accepted" value={counts.accepted} icon={<CheckCircle2 className="h-5 w-5" />} tone="text-emerald-600" />
        <Stat label="Needs correction" value={counts.needs_correction} icon={<FileWarning className="h-5 w-5" />} tone="text-amber-600" />
        <Stat label="Pending review" value={counts.pending} icon={<CircleDashed className="h-5 w-5" />} tone="text-slate-500" />
      </div>

      <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4">
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search call ID, summary, transcript or notes"
              aria-label="Search calls"
              className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm focus:border-navy-600 focus:outline-none focus:ring-1 focus:ring-navy-600"
            />
          </div>
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter by review status">
            {FILTERS.map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                onClick={() => chooseFilter(f)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${filter === f ? 'bg-navy-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {f === 'all' ? 'All' : f === 'pending' ? 'Pending' : STATUS_LABEL[f]} <span className="ml-1 tabular-nums opacity-70">{counts[f]}</span>
              </button>
            ))}
          </div>
        </div>

        {visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-slate-500">
            <Inbox className="h-8 w-8" />
            <p className="font-medium">No calls match</p>
            <p className="text-sm">Try a different search term or status filter.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Call ID</th>
                  <th className="px-4 py-3 font-medium">Call date</th>
                  <th className="px-4 py-3 font-medium">Duration</th>
                  <th className="px-4 py-3 font-medium">Summary</th>
                  <th className="px-4 py-3 font-medium">AI recommendation</th>
                  <th className="px-4 py-3 font-medium">Reviewer decision</th>
                  <th className="px-4 py-3 font-medium sr-only">Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((c) => {
                  const r = reviews[c.id];
                  return (
                    <tr key={c.id} onClick={() => onOpen(c.id)} className="cursor-pointer hover:bg-navy-50/60">
                      <td className="whitespace-nowrap px-4 py-3">
                        <a href={`#/call/${encodeURIComponent(c.id)}`} onClick={(e) => e.stopPropagation()} className="font-medium text-navy-700 hover:underline">{c.id}</a>
                        {c.source === 'uploaded' && <span className="ml-2 rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-700 ring-1 ring-inset ring-sky-200">Uploaded</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatDate(c.call_date)}</td>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-600">{c.estimated_duration ?? '—'}</td>
                      <td className="max-w-md px-4 py-3 text-slate-600"><p className="line-clamp-2">{c.summary}</p></td>
                      <td className="whitespace-nowrap px-4 py-3"><AiBadge recommendation={r?.ai?.recommendation} /></td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <StatusBadge status={reviewStatus(r)} />
                        {r?.human && <div className="mt-1 text-xs text-slate-400">{formatDateTime(r.human.reviewedAt)}</div>}
                      </td>
                      <td className="px-2 py-3 text-slate-400"><ChevronRight className="h-4 w-4" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <HelpCircle className="h-3.5 w-3.5" /> AI recommendations are advisory. Only a reviewer decision counts as a completed QA review.
      </p>
    </div>
  );
}
