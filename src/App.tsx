import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ClipboardCheck, Loader2 } from 'lucide-react';
import suppliedCalls from '../data/candidate-calls.json';
import type { AppCall, CallRecord, ReviewRecord } from '../shared/types';
import { mergeAi } from '../shared/validation';
import { analyzeCall, getHealth, getReviews, type Health } from './lib/api';
import { CallReview } from './components/CallReview';
import { Dashboard } from './components/Dashboard';
import { UploadDialog } from './components/UploadDialog';

const SUPPLIED: AppCall[] = (suppliedCalls as CallRecord[]).map((c) => ({ ...c, source: 'supplied' }));
const byId = (a: AppCall, b: AppCall) => a.id.localeCompare(b.id, 'en', { numeric: true });

function useHashRoute(): [string | null, (id: string | null) => void] {
  const read = () => {
    const m = window.location.hash.match(/^#\/call\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  };
  const [callId, setCallId] = useState<string | null>(read);
  useEffect(() => {
    const onHash = () => setCallId(read());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = useCallback((id: string | null) => {
    window.location.hash = id ? `/call/${encodeURIComponent(id)}` : '/';
    window.scrollTo(0, 0);
  }, []);
  return [callId, navigate];
}

export default function App() {
  const [callId, navigate] = useHashRoute();
  const [uploaded, setUploaded] = useState<AppCall[]>([]);
  const [reviews, setReviews] = useState<Record<string, ReviewRecord>>({});
  const [health, setHealth] = useState<Health | null>(null);
  const [persistence, setPersistence] = useState<'loading' | 'ready' | 'unconfigured' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [analysing, setAnalysing] = useState<Set<string>>(new Set());
  const [analyseErrors, setAnalyseErrors] = useState<Record<string, string>>({});
  const [analyseNotices, setAnalyseNotices] = useState<Record<string, string>>({});
  const [batch, setBatch] = useState({ running: false, done: 0, total: 0, errors: 0 });
  const stopBatch = useRef(false);

  const load = useCallback(async () => {
    setPersistence('loading'); setLoadError(null);
    getHealth().then(setHealth).catch(() => setHealth(null));
    try {
      const data = await getReviews();
      if (!data.configured) { setPersistence('unconfigured'); return; }
      setReviews(Object.fromEntries(data.reviews.map((r) => [r.callId, r])));
      setUploaded(data.uploadedCalls);
      setPersistence('ready');
    } catch (err) {
      setPersistence('error');
      setLoadError((err as Error).message);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const calls = useMemo(() => {
    const supplied = new Set(SUPPLIED.map((c) => c.id));
    return [...SUPPLIED, ...uploaded.filter((c) => !supplied.has(c.id))].sort(byId);
  }, [uploaded]);

  const updateReview = useCallback((r: ReviewRecord) => setReviews((prev) => ({ ...prev, [r.callId]: r })), []);

  const runAnalysis = useCallback(async (call: AppCall): Promise<boolean> => {
    setAnalysing((s) => new Set(s).add(call.id));
    setAnalyseErrors(({ [call.id]: _, ...rest }) => rest);
    setAnalyseNotices(({ [call.id]: _, ...rest }) => rest);
    try {
      const res = await analyzeCall(call);
      setReviews((prev) => ({ ...prev, [call.id]: mergeAi(prev[call.id] ?? null, call.id, res.analysis) }));
      if (!res.persisted) setAnalyseNotices((n) => ({ ...n, [call.id]: `Analysis shown but not saved (${res.persistError}). It will be lost on refresh.` }));
      return true;
    } catch (err) {
      setAnalyseErrors((e) => ({ ...e, [call.id]: `AI analysis failed: ${(err as Error).message}` }));
      return false;
    } finally {
      setAnalysing((s) => { const n = new Set(s); n.delete(call.id); return n; });
    }
  }, []);

  const runBatch = useCallback(async (ids: string[]) => {
    stopBatch.current = false;
    let done = 0, errors = 0;
    setBatch({ running: true, done, total: ids.length, errors });
    for (const id of ids) {
      if (stopBatch.current) break;
      const call = calls.find((c) => c.id === id);
      if (call && !(await runAnalysis(call))) errors++;
      done++;
      setBatch({ running: true, done, total: ids.length, errors });
    }
    setBatch({ running: false, done, total: ids.length, errors });
  }, [calls, runAnalysis]);

  const index = callId ? calls.findIndex((c) => c.id === callId) : -1;
  const current = index >= 0 ? calls[index] : null;
  const canSave = persistence === 'ready';
  const canAnalyse = Boolean(health?.openai);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 h-14 border-b border-navy-900 bg-navy-800 text-white">
        <div className="mx-auto flex h-full max-w-[1600px] items-center gap-3 px-6">
          <button onClick={() => navigate(null)} className="flex items-center gap-2 font-semibold">
            <ClipboardCheck className="h-5 w-5" /> Call Summary QA
          </button>
          <span className="hidden text-sm text-navy-100 sm:inline">Collections · Internal review tool</span>
          <div className="ml-auto flex items-center gap-3 text-xs text-navy-100">
            <span title="Model used for AI analysis">AI: {health?.openai ? health.model : 'not configured'}</span>
            <span>·</span>
            <span>Storage: {persistence === 'ready' ? `GitHub (${health?.branch ?? 'main'})` : persistence === 'loading' ? 'connecting…' : 'unavailable'}</span>
          </div>
        </div>
      </header>

      {persistence !== 'ready' && persistence !== 'loading' && (
        <div className="border-b border-amber-200 bg-amber-50 px-6 py-2 text-sm text-amber-900">
          <div className="mx-auto flex max-w-[1600px] items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {persistence === 'unconfigured'
              ? 'Persistence is not configured, so decisions cannot be saved. Calls can still be browsed and reviewed.'
              : `Could not load saved reviews: ${loadError}. Statuses shown may be incomplete and saving may fail.`}
            {persistence === 'error' && <button onClick={load} className="ml-2 font-medium underline">Retry</button>}
          </div>
        </div>
      )}

      {callId && !current ? (
        <div className="mx-auto max-w-xl px-6 py-16 text-center text-slate-600">
          {persistence === 'loading' ? (
            <Loader2 className="mx-auto h-6 w-6 animate-spin" />
          ) : (
            <>
              <p className="font-medium">Call “{callId}” was not found.</p>
              <button onClick={() => navigate(null)} className="mt-3 text-navy-700 underline">Back to all calls</button>
            </>
          )}
        </div>
      ) : current ? (
        <CallReview
          key={current.id}
          call={current}
          review={reviews[current.id]}
          prevId={calls[index - 1]?.id ?? null}
          nextId={calls[index + 1]?.id ?? null}
          position={`${index + 1} of ${calls.length}`}
          onNavigate={navigate}
          canSave={canSave}
          canAnalyse={canAnalyse}
          analysing={analysing.has(current.id)}
          analyseError={analyseErrors[current.id] ?? null}
          analyseNotice={analyseNotices[current.id] ?? null}
          onAnalyse={() => runAnalysis(current)}
          onSaved={updateReview}
        />
      ) : (
        <>
          {persistence === 'loading' && (
            <div className="mx-auto flex max-w-7xl items-center gap-2 px-6 pt-4 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading saved reviews…</div>
          )}
          <Dashboard
            calls={calls}
            reviews={reviews}
            onOpen={navigate}
            onUpload={() => setShowUpload(true)}
            canUpload={canSave}
            canAnalyse={canAnalyse}
            batch={batch}
            onBatchAnalyse={runBatch}
            onStopBatch={() => { stopBatch.current = true; }}
          />
        </>
      )}

      {showUpload && (
        <UploadDialog
          onClose={() => setShowUpload(false)}
          onImported={(added) => setUploaded((prev) => [...prev.filter((c) => !added.some((a) => a.id === c.id)), ...added])}
        />
      )}
    </div>
  );
}
