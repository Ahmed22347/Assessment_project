import { useState } from 'react';
import { AlertTriangle, CheckCircle2, FileJson, Loader2, X } from 'lucide-react';
import { LIMITS, validateUploadedCalls } from '../../shared/validation';
import type { AppCall } from '../../shared/types';
import { ApiError, uploadCalls, type UploadResponse } from '../lib/api';

export function UploadDialog({ onClose, onImported }: { onClose: () => void; onImported: (calls: AppCall[]) => void }) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResponse | null>(null);

  async function onFile(file: File | undefined) {
    setErrors([]); setResult(null);
    if (!file) return;
    if (file.size > LIMITS.maxUploadBytes) { setErrors([`File is ${(file.size / 1e6).toFixed(1)} MB; the limit is ${LIMITS.maxUploadBytes / 1e6} MB.`]); return; }
    setFileName(file.name);
    setText(await file.text());
  }

  async function submit() {
    setErrors([]); setWarnings([]); setResult(null);
    if (new Blob([text]).size > LIMITS.maxUploadBytes) return setErrors([`Upload exceeds ${LIMITS.maxUploadBytes / 1e6} MB.`]);
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch (e) { return setErrors([`Not valid JSON: ${(e as Error).message}`]); }
    // Same validator the server runs, for instant feedback.
    const check = validateUploadedCalls(parsed);
    setWarnings(check.warnings);
    if (!check.ok) return setErrors(check.errors);
    setBusy(true);
    try {
      const res = await uploadCalls(parsed);
      setResult(res);
      if (res.imported.length) onImported(res.imported);
    } catch (err) {
      const e = err as ApiError;
      setErrors(e.details?.errors?.length ? e.details.errors : [e.message]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="upload-title">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 id="upload-title" className="text-lg font-semibold text-slate-900">Upload calls</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4 overflow-y-auto px-5 py-4 text-sm">
          <p className="text-slate-600">
            Upload a JSON file in the same structure as <code className="rounded bg-slate-100 px-1">candidate-calls.json</code>: an array of objects with
            <code className="mx-1 rounded bg-slate-100 px-1">transcript</code> and <code className="mx-1 rounded bg-slate-100 px-1">summary</code> (required), and optional
            <code className="mx-1 rounded bg-slate-100 px-1">id</code>, <code className="mx-1 rounded bg-slate-100 px-1">call_date</code> (YYYY-MM-DD) and
            <code className="mx-1 rounded bg-slate-100 px-1">estimated_duration</code> (MM:SS). Transcript lines use <code className="rounded bg-slate-100 px-1">T01 [00:00] Speaker: text</code>.
            Missing or clashing IDs are assigned automatically.
          </p>
          <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-slate-300 px-4 py-3 hover:bg-slate-50">
            <FileJson className="h-5 w-5 text-navy-600" />
            <span className="text-slate-700">{fileName ?? 'Choose a .json file'}</span>
            <input type="file" accept=".json,application/json" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
          </label>
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setFileName(null); }}
            placeholder="…or paste JSON here"
            aria-label="Calls JSON"
            className="h-40 w-full rounded-md border border-slate-300 p-3 font-mono text-xs focus:border-navy-600 focus:outline-none focus:ring-1 focus:ring-navy-600"
          />
          {errors.length > 0 && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-red-800" role="alert">
              <div className="mb-1 flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" /> Upload not accepted</div>
              <ul className="list-disc space-y-0.5 pl-5">{errors.slice(0, 12).map((e) => <li key={e}>{e}</li>)}</ul>
              {errors.length > 12 && <p className="mt-1">…and {errors.length - 12} more.</p>}
            </div>
          )}
          {warnings.length > 0 && !errors.length && (
            <ul className="list-disc pl-5 text-amber-800">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          )}
          {result && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900" role="status">
              <div className="mb-1 flex items-center gap-2 font-medium"><CheckCircle2 className="h-4 w-4" /> Imported {result.imported.length} call(s)</div>
              <ul className="list-disc space-y-0.5 pl-5">
                {result.imported.map((c) => <li key={c.id}>{c.id}</li>)}
                {result.renamed.map((r) => <li key={r.from}>ID {r.from} already existed — imported as {r.to}</li>)}
                {result.skipped.map((s) => <li key={s.id}>Skipped {s.id}: {s.reason}</li>)}
                {result.failed.map((f) => <li key={f.id} className="text-red-700">Failed to save {f.id}: {f.error}</li>)}
              </ul>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <button onClick={onClose} className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">{result ? 'Done' : 'Cancel'}</button>
          <button onClick={submit} disabled={busy || !text.trim()} className="inline-flex items-center gap-2 rounded-md bg-navy-700 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Validate and import
          </button>
        </div>
      </div>
    </div>
  );
}
