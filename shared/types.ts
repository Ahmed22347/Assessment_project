/** A call record exactly as it appears in candidate-calls.json. */
export interface CallRecord {
  id: string;
  call_date?: string;
  estimated_duration?: string;
  transcript: string;
  summary: string;
}

export interface AppCall extends CallRecord {
  source: 'supplied' | 'uploaded';
  uploadedAt?: string;
}

export interface TranscriptTurn {
  turnId: string;
  timestamp: string | null;
  speaker: string;
  text: string;
}

export const RECOMMENDATIONS = ['acceptable', 'needs_correction', 'unable_to_determine'] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export const DECISIONS = ['accepted', 'needs_correction', 'unable_to_determine'] as const;
export type ReviewDecision = (typeof DECISIONS)[number];

export type ReviewStatus = 'pending' | ReviewDecision;

export const FINDING_CATEGORIES = [
  'contradiction',
  'unsupported_claim',
  'material_omission',
  'payment_amount_or_date',
  'payment_commitment',
  'call_direction',
  'dpa',
  'third_party_or_authority',
  'vulnerability_or_consent',
  'hardship_detail',
  'advice_or_compliance',
  'next_steps',
  'privacy_or_redaction',
  'rule_breach',
] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

export const SEVERITIES = ['high', 'medium', 'low'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CERTAINTIES = ['definite', 'possible'] as const;
export type Certainty = (typeof CERTAINTIES)[number];

export interface EvidenceQuote {
  turnId: string;
  quote: string;
  /** Set server-side: true only if the quote was found verbatim (normalised) in the transcript. */
  verified?: boolean;
}

export interface Finding {
  category: FindingCategory;
  severity: Severity;
  certainty: Certainty;
  summaryClaim: string;
  transcriptEvidence: EvidenceQuote[];
  explanation: string;
  suggestedCorrection: string;
}

/** Shape returned by the model (validated server-side). */
export interface ModelAnalysis {
  recommendation: Recommendation;
  confidence: 'high' | 'medium' | 'low';
  overallExplanation: string;
  findings: Finding[];
  suggestedSummary: string;
}

export interface AiAnalysis extends ModelAnalysis {
  model: string;
  analysedAt: string;
  /** Server-generated caveats, e.g. unverifiable quotations. */
  warnings: string[];
}

export interface HumanReview {
  decision: ReviewDecision;
  notes: string;
  correctedSummary: string | null;
  reviewedAt: string;
}

/** One file per call in reviews/<callId>.json */
export interface ReviewRecord {
  callId: string;
  ai: AiAnalysis | null;
  human: HumanReview | null;
  updatedAt: string;
}
