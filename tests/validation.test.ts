import { describe, expect, it } from 'vitest';
import calls from '../data/candidate-calls.json';
import { readFileSync } from 'node:fs';
import { SUMMARY_RULES } from '../shared/summaryRules';
import { locateQuote, parseTranscript } from '../shared/transcript';
import type { ModelAnalysis } from '../shared/types';
import {
  assignCallIds, contentHash, mergeAi, mergeHuman, reviewStatus, validateModelAnalysis,
  validateSaveReview, validateUploadedCalls, verifyAnalysis,
} from '../shared/validation';

const call019 = calls.find((c) => c.id === 'CALL-019')!;

describe('supplied data', () => {
  it('has 20 calls that all pass upload validation and parse into turns', () => {
    expect(calls).toHaveLength(20);
    const r = validateUploadedCalls(calls);
    expect(r.errors).toEqual([]);
    expect(r.calls).toHaveLength(20);
    for (const c of calls) {
      const turns = parseTranscript(c.transcript);
      expect(turns.length).toBeGreaterThan(10);
      expect(turns.every((t) => /^T\d+$/.test(t.turnId) && t.timestamp)).toBe(true);
    }
  });

  it('has unique IDs', () => {
    expect(new Set(calls.map((c) => c.id)).size).toBe(20);
  });

  it('embedded rubric matches the supplied rules file exactly', () => {
    expect(SUMMARY_RULES).toBe(readFileSync('exercise_data/summary-rules.txt', 'utf8'));
  });
});

describe('transcript parsing and quote location', () => {
  it('parses speaker, timestamp and text', () => {
    const [t1] = parseTranscript(call019.transcript);
    expect(t1).toMatchObject({ turnId: 'T01', timestamp: '00:00', speaker: 'Agent' });
  });

  it('finds verbatim quotes tolerant of case, whitespace and curly apostrophes', () => {
    const turns = parseTranscript(call019.transcript);
    expect(locateQuote(turns, 'I’m off sick with depression.', 'T08')).toBe('T08');
    expect(locateQuote(turns, '  i\'M OFF   sick with depression ', 'T02')).toBe('T08'); // re-pointed to the right turn
    expect(locateQuote(turns, 'I agreed to pay £100 on Friday', 'T08')).toBeNull(); // fabricated
  });
});

describe('upload validation', () => {
  it('rejects non-array / missing fields / bad formats with useful messages', () => {
    expect(validateUploadedCalls('nope').ok).toBe(false);
    expect(validateUploadedCalls([]).errors[0]).toMatch(/no calls/);
    const r = validateUploadedCalls([{ id: 'X1', summary: 'S' }, { transcript: 'free text', summary: 's' }, { transcript: 'T01 [00:00] Agent: hi', summary: 's', call_date: '20/10/2026' }]);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/Call #1 \(X1\): "transcript" is required/);
    expect(r.errors.join('\n')).toMatch(/turn format/);
    expect(r.errors.join('\n')).toMatch(/call_date/);
  });

  it('accepts a single object without optional metadata and warns on unknown fields', () => {
    const r = validateUploadedCalls({ transcript: 'T01 [00:00] Agent: Hello.\nT02 [00:03] Customer: Hi.', summary: 'Incomplete call.', extra: 1 });
    expect(r.ok).toBe(true);
    expect(r.calls[0].id).toBe('');
    expect(r.warnings[0]).toMatch(/extra/);
  });

  it('rejects duplicate ids within a file', () => {
    const c = { id: 'A', transcript: 'T01 [00:00] Agent: x', summary: 'y' };
    expect(validateUploadedCalls([c, { ...c, summary: 'z' }]).errors.join()).toMatch(/duplicate id/);
  });
});

describe('ID assignment', () => {
  const existing = new Map(calls.map((c) => [c.id, contentHash(c)]));
  const fresh = { id: 'NEW-1', transcript: 'T01 [00:00] Agent: x', summary: 'y' };

  it('keeps a free id, skips identical content, renames a clashing id', () => {
    const r = assignCallIds([fresh, { ...call019 }, { ...fresh, id: 'CALL-001', summary: 'different' }, { ...fresh, id: '', summary: 'no id' }], existing);
    expect(r.toImport.map((c) => c.id)[0]).toBe('NEW-1');
    expect(r.skipped[0].reason).toMatch(/CALL-019/);
    expect(r.renamed[0]).toMatchObject({ from: 'CALL-001' });
    expect(r.toImport[1].id).toMatch(/^UPL-[0-9a-f]{8}$/);
    expect(r.toImport[2].id).toMatch(/^UPL-/);
    expect(new Set(r.toImport.map((c) => c.id)).size).toBe(3);
  });

  it('is stable: same content gets the same generated id', () => {
    const a = assignCallIds([{ ...fresh, id: '' }], existing).toImport[0].id;
    const b = assignCallIds([{ ...fresh, id: '' }], existing).toImport[0].id;
    expect(a).toBe(b);
  });
});

describe('AI analysis handling', () => {
  const base: ModelAnalysis = {
    recommendation: 'needs_correction',
    confidence: 'high',
    overallExplanation: 'Call direction is wrong.',
    findings: [{
      category: 'call_direction', severity: 'high', certainty: 'definite',
      summaryClaim: 'The customer called the company',
      transcriptEvidence: [{ turnId: 'T01', quote: "Hello, could I speak to Neil Stone, please? I'm calling from vehicle finance collections." }],
      explanation: 'Agent opened the call asking for the customer.', suggestedCorrection: 'The company called and reached the customer.',
    }],
    suggestedSummary: 'DPA completed. The company called and reached the customer...',
  };

  it('accepts a schema-valid analysis and rejects malformed ones', () => {
    expect(validateModelAnalysis(base).ok).toBe(true);
    expect(validateModelAnalysis({ ...base, recommendation: 'yes' }).ok).toBe(false);
    expect(validateModelAnalysis({ ...base, findings: [{ ...base.findings[0], severity: 'critical' }] }).ok).toBe(false);
    expect(validateModelAnalysis({ ...base, findings: [{ ...base.findings[0], transcriptEvidence: [{ quote: 'x' }] }] }).ok).toBe(false);
  });

  it('marks verified and fabricated quotes and warns', () => {
    const fabricated = { ...base, findings: [{ ...base.findings[0], transcriptEvidence: [...base.findings[0].transcriptEvidence, { turnId: 'T09', quote: 'I promise to pay £500 tomorrow' }] }] };
    const out = verifyAnalysis(fabricated, call019.transcript, 'test-model');
    expect(out.findings[0].transcriptEvidence.map((e) => e.verified)).toEqual([true, false]);
    expect(out.warnings.some((w) => /not found verbatim/.test(w))).toBe(true);
    expect(out.model).toBe('test-model');
  });

  it('flags an "acceptable" recommendation that contradicts material findings', () => {
    const out = verifyAnalysis({ ...base, recommendation: 'acceptable' }, call019.transcript, 'm');
    expect(out.warnings.join()).toMatch(/acceptable/);
    const clean = verifyAnalysis({ ...base, recommendation: 'acceptable', findings: [] }, call019.transcript, 'm');
    expect(clean.warnings).toEqual([]);
  });
});

describe('review persistence logic', () => {
  it('validates save input and drops corrected summary unless decision is needs_correction', () => {
    expect(validateSaveReview({ callId: '../etc', decision: 'accepted' }).ok).toBe(false);
    expect(validateSaveReview({ callId: 'CALL-001', decision: 'approve' }).ok).toBe(false);
    const r = validateSaveReview({ callId: 'CALL-001', decision: 'accepted', notes: ' ok ', correctedSummary: 'x' });
    expect(r.ok && r.value).toMatchObject({ notes: 'ok', correctedSummary: null });
    const n = validateSaveReview({ callId: 'CALL-001', decision: 'needs_correction', correctedSummary: 'Fixed.' });
    expect(n.ok && n.value.correctedSummary).toBe('Fixed.');
  });

  it('merging human and AI updates never clobbers the other half', () => {
    const ai = verifyAnalysis({ recommendation: 'acceptable', confidence: 'high', overallExplanation: '', findings: [], suggestedSummary: '' }, call019.transcript, 'm');
    const withAi = mergeAi(null, 'CALL-019', ai);
    const withHuman = mergeHuman(withAi, { callId: 'CALL-019', decision: 'needs_correction', notes: 'n', correctedSummary: 'c' });
    expect(withHuman.ai).toEqual(ai);
    const reAnalysed = mergeAi(withHuman, 'CALL-019', ai);
    expect(reAnalysed.human?.decision).toBe('needs_correction');
    expect(reviewStatus(reAnalysed)).toBe('needs_correction');
    expect(reviewStatus(withAi)).toBe('pending'); // AI alone never sets a QA decision
  });
});
