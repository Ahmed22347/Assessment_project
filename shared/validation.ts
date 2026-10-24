import {
  CERTAINTIES, DECISIONS, FINDING_CATEGORIES, RECOMMENDATIONS, SEVERITIES,
  type AiAnalysis, type CallRecord, type ModelAnalysis, type ReviewDecision, type ReviewRecord, type ReviewStatus,
} from './types.js';
import { locateQuote, parseTranscript } from './transcript.js';

export const LIMITS = {
  maxUploadBytes: 1_000_000,
  maxCallsPerUpload: 50,
  maxTranscriptChars: 60_000,
  maxSummaryChars: 5_000,
  maxNotesChars: 5_000,
};

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DURATION_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;
const KNOWN_FIELDS = new Set(['id', 'call_date', 'estimated_duration', 'transcript', 'summary']);

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

export interface UploadValidationResult {
  ok: boolean;
  calls: CallRecord[];
  errors: string[];
  warnings: string[];
}

/**
 * Validates uploaded JSON against the candidate-calls.json structure.
 * Accepts an array of calls (the supplied format), a single call object, or { calls: [...] }.
 */
export function validateUploadedCalls(input: unknown): UploadValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  let list: unknown[];
  if (Array.isArray(input)) list = input;
  else if (isRecord(input) && Array.isArray(input.calls)) list = input.calls;
  else if (isRecord(input) && 'transcript' in input) list = [input];
  else return { ok: false, calls: [], errors: ['Expected a JSON array of calls (same structure as candidate-calls.json), a single call object, or { "calls": [...] }.'], warnings };

  if (list.length === 0) errors.push('The file contains no calls.');
  if (list.length > LIMITS.maxCallsPerUpload) errors.push(`Too many calls: ${list.length} (maximum ${LIMITS.maxCallsPerUpload} per upload).`);

  const calls: CallRecord[] = [];
  const seen = new Set<string>();
  list.slice(0, LIMITS.maxCallsPerUpload).forEach((item, i) => {
    const label = `Call #${i + 1}${isRecord(item) && typeof item.id === 'string' ? ` (${item.id})` : ''}`;
    if (!isRecord(item)) { errors.push(`${label}: must be an object.`); return; }
    const before = errors.length;
    if (!isNonEmptyString(item.transcript)) errors.push(`${label}: "transcript" is required and must be a non-empty string.`);
    else if (item.transcript.length > LIMITS.maxTranscriptChars) errors.push(`${label}: "transcript" exceeds ${LIMITS.maxTranscriptChars} characters.`);
    else if (!parseTranscript(item.transcript).some((t) => /^T\d+$/.test(t.turnId))) {
      errors.push(`${label}: "transcript" must use the turn format "T01 [00:00] Speaker: text", one turn per line.`);
    }
    if (!isNonEmptyString(item.summary)) errors.push(`${label}: "summary" is required and must be a non-empty string.`);
    else if (item.summary.length > LIMITS.maxSummaryChars) errors.push(`${label}: "summary" exceeds ${LIMITS.maxSummaryChars} characters.`);
    if (item.id !== undefined && (typeof item.id !== 'string' || !ID_RE.test(item.id))) errors.push(`${label}: "id" must be 1–64 letters, digits, "-" or "_".`);
    if (item.call_date !== undefined && (typeof item.call_date !== 'string' || !DATE_RE.test(item.call_date))) errors.push(`${label}: "call_date" must be YYYY-MM-DD.`);
    if (item.estimated_duration !== undefined && (typeof item.estimated_duration !== 'string' || !DURATION_RE.test(item.estimated_duration))) errors.push(`${label}: "estimated_duration" must be MM:SS.`);
    const extra = Object.keys(item).filter((k) => !KNOWN_FIELDS.has(k));
    if (extra.length) warnings.push(`${label}: ignored unknown field(s) ${extra.join(', ')}.`);
    if (typeof item.id === 'string') {
      if (seen.has(item.id)) errors.push(`${label}: duplicate id within the file.`);
      seen.add(item.id);
    }
    if (errors.length > before) return;
    calls.push({
      id: typeof item.id === 'string' ? item.id : '',
      ...(typeof item.call_date === 'string' ? { call_date: item.call_date } : {}),
      ...(typeof item.estimated_duration === 'string' ? { estimated_duration: item.estimated_duration } : {}),
      transcript: (item.transcript as string).trim(),
      summary: (item.summary as string).trim(),
    });
  });
  return { ok: errors.length === 0, calls: errors.length ? [] : calls, errors, warnings };
}

/** Deterministic FNV-1a hash used for content-based duplicate detection and stable IDs. */
export function contentHash(call: Pick<CallRecord, 'transcript' | 'summary'>): string {
  let h = 0x811c9dc5;
  const s = `${call.transcript}\u0000${call.summary}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export interface IdAssignment {
  toImport: CallRecord[];
  skipped: { id: string; reason: string }[];
  renamed: { from: string; to: string }[];
}

/**
 * Gives every uploaded call a unique ID. Identical content already present is skipped;
 * a clashing ID with different content gets a stable content-derived ID instead.
 */
export function assignCallIds(incoming: CallRecord[], existing: Map<string, string /* id -> contentHash */>): IdAssignment {
  const result: IdAssignment = { toImport: [], skipped: [], renamed: [] };
  const byHash = new Map([...existing].map(([id, hash]) => [hash, id]));
  const taken = new Set(existing.keys());
  for (const call of incoming) {
    const hash = contentHash(call);
    const dupOf = byHash.get(hash);
    if (dupOf) { result.skipped.push({ id: call.id || dupOf, reason: `Identical to existing call ${dupOf}` }); continue; }
    let id = call.id;
    if (!id || taken.has(id)) {
      let candidate = `UPL-${hash}`;
      for (let n = 2; taken.has(candidate); n++) candidate = `UPL-${hash}-${n}`;
      if (id) result.renamed.push({ from: id, to: candidate });
      id = candidate;
    }
    taken.add(id);
    byHash.set(hash, id);
    result.toImport.push({ ...call, id });
  }
  return result;
}

/** Strict structural validation of the model's output (defence in depth on top of Structured Outputs). */
export function validateModelAnalysis(v: unknown): { ok: true; value: ModelAnalysis } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!isRecord(v)) return fail('Analysis is not an object');
  if (!RECOMMENDATIONS.includes(v.recommendation as never)) return fail('Invalid recommendation');
  if (!['high', 'medium', 'low'].includes(v.confidence as string)) return fail('Invalid confidence');
  if (typeof v.overallExplanation !== 'string') return fail('Missing overallExplanation');
  if (typeof v.suggestedSummary !== 'string') return fail('Missing suggestedSummary');
  if (!Array.isArray(v.findings)) return fail('findings must be an array');
  for (const [i, f] of v.findings.entries()) {
    if (!isRecord(f)) return fail(`Finding ${i} is not an object`);
    if (!FINDING_CATEGORIES.includes(f.category as never)) return fail(`Finding ${i}: invalid category`);
    if (!SEVERITIES.includes(f.severity as never)) return fail(`Finding ${i}: invalid severity`);
    if (!CERTAINTIES.includes(f.certainty as never)) return fail(`Finding ${i}: invalid certainty`);
    for (const k of ['summaryClaim', 'explanation', 'suggestedCorrection'] as const) {
      if (typeof f[k] !== 'string') return fail(`Finding ${i}: ${k} must be a string`);
    }
    if (!Array.isArray(f.transcriptEvidence)) return fail(`Finding ${i}: transcriptEvidence must be an array`);
    for (const e of f.transcriptEvidence) {
      if (!isRecord(e) || typeof e.turnId !== 'string' || typeof e.quote !== 'string') return fail(`Finding ${i}: invalid evidence item`);
    }
  }
  return { ok: true, value: v as unknown as ModelAnalysis };
}

/**
 * Verifies every quotation against the transcript and adds caveats. Never trusts the model's
 * turn IDs blindly: a quote found in another turn is re-pointed; one not found is flagged.
 */
export function verifyAnalysis(analysis: ModelAnalysis, transcript: string, model: string, now = new Date()): AiAnalysis {
  const turns = parseTranscript(transcript);
  const warnings: string[] = [];
  const findings = analysis.findings.map((f, i) => ({
    ...f,
    transcriptEvidence: f.transcriptEvidence.map((e) => {
      const found = locateQuote(turns, e.quote, e.turnId);
      if (!found) warnings.push(`Finding ${i + 1}: quotation not found verbatim in the transcript ("${e.quote.slice(0, 80)}"). Treat this finding with caution.`);
      return { turnId: found ?? e.turnId, quote: e.quote, verified: Boolean(found) };
    }),
  }));
  const material = findings.filter((f) => f.severity !== 'low');
  if (analysis.recommendation === 'acceptable' && material.length) {
    warnings.push(`Recommendation is "acceptable" but ${material.length} medium/high-severity finding(s) were reported; review carefully.`);
  }
  if (analysis.recommendation === 'needs_correction' && findings.length === 0) {
    warnings.push('Recommendation is "needs correction" but no findings were provided.');
  }
  return { ...analysis, findings, model, analysedAt: now.toISOString(), warnings };
}

export function reviewStatus(review: ReviewRecord | undefined | null): ReviewStatus {
  return review?.human?.decision ?? 'pending';
}

export interface SaveReviewInput {
  callId: string;
  decision: ReviewDecision;
  notes: string;
  correctedSummary: string | null;
}

export function validateSaveReview(body: unknown): { ok: true; value: SaveReviewInput } | { ok: false; error: string } {
  if (!isRecord(body)) return { ok: false, error: 'Body must be a JSON object' };
  const { callId, decision, notes, correctedSummary } = body;
  if (typeof callId !== 'string' || !ID_RE.test(callId)) return { ok: false, error: 'Invalid callId' };
  if (!DECISIONS.includes(decision as never)) return { ok: false, error: `decision must be one of ${DECISIONS.join(', ')}` };
  if (notes !== undefined && typeof notes !== 'string') return { ok: false, error: 'notes must be a string' };
  if (typeof notes === 'string' && notes.length > LIMITS.maxNotesChars) return { ok: false, error: 'notes too long' };
  if (correctedSummary !== undefined && correctedSummary !== null && typeof correctedSummary !== 'string') return { ok: false, error: 'correctedSummary must be a string or null' };
  if (typeof correctedSummary === 'string' && correctedSummary.length > LIMITS.maxSummaryChars) return { ok: false, error: 'correctedSummary too long' };
  return {
    ok: true,
    value: {
      callId,
      decision: decision as ReviewDecision,
      notes: (notes as string | undefined)?.trim() ?? '',
      // A corrected summary is only meaningful for "needs correction"; never stored for other decisions.
      correctedSummary: decision === 'needs_correction' && typeof correctedSummary === 'string' && correctedSummary.trim() ? correctedSummary.trim() : null,
    },
  };
}

export function isValidCallId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id);
}

/** Merges a human decision into an existing record without touching AI output. */
export function mergeHuman(existing: ReviewRecord | null, input: SaveReviewInput, now = new Date()): ReviewRecord {
  const ts = now.toISOString();
  return {
    callId: input.callId,
    ai: existing?.ai ?? null,
    human: { decision: input.decision, notes: input.notes, correctedSummary: input.correctedSummary, reviewedAt: ts },
    updatedAt: ts,
  };
}

/** Merges a fresh AI analysis into an existing record without touching the human decision. */
export function mergeAi(existing: ReviewRecord | null, callId: string, ai: AiAnalysis): ReviewRecord {
  return { callId, ai, human: existing?.human ?? null, updatedAt: ai.analysedAt };
}
