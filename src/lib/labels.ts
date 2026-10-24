import type { Certainty, FindingCategory, Recommendation, ReviewStatus, Severity } from '../../shared/types';

export const STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: 'Pending review',
  accepted: 'Accepted',
  needs_correction: 'Needs correction',
  unable_to_determine: 'Unable to determine',
};

export const STATUS_STYLE: Record<ReviewStatus, string> = {
  pending: 'bg-slate-100 text-slate-600 ring-slate-300',
  accepted: 'bg-emerald-50 text-emerald-700 ring-emerald-300',
  needs_correction: 'bg-amber-50 text-amber-800 ring-amber-300',
  unable_to_determine: 'bg-violet-50 text-violet-700 ring-violet-300',
};

export const REC_LABEL: Record<Recommendation, string> = {
  acceptable: 'Acceptable',
  needs_correction: 'Needs correction',
  unable_to_determine: 'Unable to determine',
};

export const REC_STYLE: Record<Recommendation, string> = {
  acceptable: 'text-emerald-700 border-emerald-300',
  needs_correction: 'text-amber-800 border-amber-300',
  unable_to_determine: 'text-violet-700 border-violet-300',
};

export const SEVERITY_STYLE: Record<Severity, string> = {
  high: 'bg-red-50 text-red-700 ring-red-200',
  medium: 'bg-amber-50 text-amber-800 ring-amber-200',
  low: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export const CERTAINTY_LABEL: Record<Certainty, string> = { definite: 'Definite', possible: 'Possible — uncertain' };

export const CATEGORY_LABEL: Record<FindingCategory, string> = {
  contradiction: 'Contradiction',
  unsupported_claim: 'Unsupported claim',
  material_omission: 'Material omission',
  payment_amount_or_date: 'Payment amount / date',
  payment_commitment: 'Payment commitment',
  call_direction: 'Call direction',
  dpa: 'Data protection (DPA)',
  third_party_or_authority: 'Third party / authority',
  vulnerability_or_consent: 'Vulnerability / consent',
  hardship_detail: 'Hardship detail',
  advice_or_compliance: 'Advice / compliance',
  next_steps: 'Next steps',
  privacy_or_redaction: 'Privacy / redaction',
  rule_breach: 'Rule breach',
};

export function formatDate(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
