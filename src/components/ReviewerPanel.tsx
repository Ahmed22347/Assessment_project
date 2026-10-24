import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileWarning, HelpCircle, Loader2, Save, UserCheck } from 'lucide-react';
import type { AppCall, ReviewDecision, ReviewRecord } from '../../shared/types';
import { ApiError, saveReview } from '../lib/api';
import { formatDateTime, REC_LABEL, STATUS_LABEL } from '../lib/labels';

const OPTIONS: { value: ReviewDecision; label: string; icon: React.ReactNode; active: string }[] = [
  { value: 'accepted', label: 'Accept summary', icon: <CheckCircle2 className="h-4 w-4" />, active: 'border-emerald-600 bg-emerald-50 text-emerald-800 ring-1 ring-emerald-600' },
  { value: 'needs_correction', label: 'Needs correction', icon: <FileWarning className="h-4 w-4" />, active: 'border-amber-600 bg-amber-50 text-amber-900 ring-1 ring-amber-600' },
  { value: 'unable_to_determine', label: 'Unable to determine', icon: <HelpCircle className="h-4 w-4" />, active: 'border-violet-600 bg-violet-50 text-violet-800 ring-1 ring-violet-600' },
];

const AI_TO_DECISION = { acceptable: 'accepted', needs_correction: 'needs_correction', unable_to_determine: 'unable_to_determine' } as const;

interface Props {
  call: AppCall;
  review: ReviewRecord | undefined;
  canSave: boolean;
  onSaved: (r: ReviewRecord) => void;
  onDirtyChange: (dirty: boolean) => void;
}

export function ReviewerPanel({ call, review, canSave, onSaved, onDirtyChange }: Props) {
  const saved = review?.human ?? null;
  const ai = review?.ai ?? null;
  const [decision, setDecision] = useState<ReviewDecision | null>(saved?.decision ?? null);
  const [notes, setNotes] = useState(saved?.notes ?? '');
  const [corrected, setCorrected] = useState(saved?.correctedSummary ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Reset the form when switching calls or when a fresh saved record arrives.
  useEffect(() => {
    setDecision(saved?.decision ?? null);
    setNotes(saved?.notes ?? '');
    setCorrected(saved?.correctedSummary ?? '');
    setError(null);
  }, [call.id, saved?.reviewedAt]);

  const dirty = decision !== (saved?.decision ?? null) || notes !== (saved?.notes ?? '') || (decision === 'needs_correction' && corrected !== (saved?.correctedSummary ?? ''));
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  const overridesAi = ai && decision && AI_TO_DECISION[ai.recommendation] !== decision;

  async function save() {
    if (!decision) return;
    setSaving(true); setError(null); setSuccess(null);
    try {
      const res = await saveReview({ callId: call.id, decision, notes, correctedSummary: decision === 'needs_correction' ? corrected : null });
      onSaved(res.review);
      setSuccess(`Saved to GitHub at ${formatDateTime(res.review.updatedAt)}${res.commitSha ? ` · commit ${res.commitSha.slice(0, 7)}` : ''}`);
    } catch (err) {
      setError(`Not saved: ${(err as ApiError).message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
        <UserCheck className="h-4 w-4 text-navy-700" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Reviewer decision</h2>
        {saved && <span className="ml-auto text-xs text-slate-500">Last saved: {STATUS_LABEL[saved.decision]} · {formatDateTime(saved.reviewedAt)}</span>}
      </header>
      <div className="space-y-4 p-4">
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Reviewer decision">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              role="radio"
              aria-checked={decision === o.value}
              onClick={() => { setDecision(o.value); setSuccess(null); }}
              className={`flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${decision === o.value ? o.active : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}
            >
              {o.icon} {o.label}
            </button>
          ))}
        </div>
        {overridesAi && (
          <p className="flex items-center gap-1.5 text-xs text-slate-600">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" /> This decision overrides the AI recommendation ({REC_LABEL[ai.recommendation]}).
          </p>
        )}

        {decision === 'needs_correction' && (
          <div>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="corrected" className="text-sm font-medium text-slate-700">Proposed corrected summary <span className="font-normal text-slate-500">(optional; the original is kept unchanged)</span></label>
              <div className="flex gap-2 text-xs">
                {ai?.suggestedSummary && <button type="button" onClick={() => setCorrected(ai.suggestedSummary)} className="text-navy-700 hover:underline">Use AI suggestion</button>}
                <button type="button" onClick={() => setCorrected(call.summary)} className="text-navy-700 hover:underline">Start from original</button>
              </div>
            </div>
            <textarea
              id="corrected"
              value={corrected}
              onChange={(e) => setCorrected(e.target.value)}
              rows={6}
              className="w-full rounded-md border border-slate-300 p-2 text-sm focus:border-navy-600 focus:outline-none focus:ring-1 focus:ring-navy-600"
            />
          </div>
        )}

        <div>
          <label htmlFor="notes" className="mb-1 block text-sm font-medium text-slate-700">Reviewer notes</label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Reasoning, evidence turn IDs, or anything a colleague should know"
            className="w-full rounded-md border border-slate-300 p-2 text-sm focus:border-navy-600 focus:outline-none focus:ring-1 focus:ring-navy-600"
          />
        </div>

        {error && <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
        {success && !dirty && <div role="status" className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4" />{success}</div>}

        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">{!canSave ? 'Saving is unavailable: persistence is not configured.' : dirty ? 'Unsaved changes' : ''}</span>
          <button
            onClick={save}
            disabled={!canSave || !decision || saving || !dirty}
            className="inline-flex items-center gap-2 rounded-md bg-navy-700 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save decision
          </button>
        </div>
      </div>
    </section>
  );
}
