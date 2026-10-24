import { parseTranscript } from './transcript.js';
import type { CallRecord } from './types.js';

/**
 * Cheap deterministic checks for mechanical rubric breaches. They are HINTS for a reviewer,
 * not verdicts: they cannot judge meaning, and they complement (not replace) the AI review.
 */
export interface RuleHint { rule: string; message: string; turnId?: string }

const US_SPELLINGS = ['authorized', 'authorization', 'center', 'program', 'organization', 'color', 'behavior', 'apologize', 'recognize', 'prioritize', 'canceled', 'favor'];
const ADVICE_BODIES = ['StepChange', 'Citizens Advice', 'MoneyHelper', 'Money Helper', 'National Debtline', 'Samaritans'];

export function inferDirection(transcript: string): { direction: 'inbound' | 'outbound' | 'unknown'; turnId?: string } {
  const turns = parseTranscript(transcript).filter((t) => t.speaker !== 'Transcript note');
  const first = turns[0];
  if (!first) return { direction: 'unknown' };
  if (first.speaker === 'Agent') {
    if (/\b(could|can|may) I (please )?speak (to|with)\b|\bam I speaking (to|with)\b|\bis that (mr|mrs|ms|miss)\b/i.test(first.text)) return { direction: 'outbound', turnId: first.turnId };
    if (/how can I help|how may I help|you're speaking (to|with)|you're through to/i.test(first.text)) return { direction: 'inbound', turnId: first.turnId };
  } else if (/\b(I'm|I am) (calling|ringing)\b/i.test(first.text)) {
    return { direction: 'inbound', turnId: first.turnId };
  }
  return { direction: 'unknown' };
}

export function sentenceCount(summary: string): number {
  return summary.split(/(?<=[.!?])\s+(?=[A-Z])/).filter((s) => s.trim()).length;
}

export function checkSummaryRules(call: Pick<CallRecord, 'transcript' | 'summary'>): RuleHint[] {
  const { summary, transcript } = call;
  const hints: RuleHint[] = [];
  const turns = parseTranscript(transcript);
  const agentText = turns.filter((t) => t.speaker === 'Agent').map((t) => t.text).join('\n');
  const terminal = /^(Incomplete call\.|Voicemail (left|reached))/i.test(summary.trim());
  const internal = /internal (agent consultation|handover|discussion)/i.test(summary);

  if (!terminal && !internal && !/^(DPA completed|No DPA stated with agent)/i.test(summary.trim())) {
    hints.push({ rule: 'dpa', message: 'Summary should open with "DPA completed" or "no DPA stated with agent".' });
  }

  const dir = inferDirection(transcript);
  const saysInbound = /\bcustomer (called|rang|contacted) the company\b/i.test(summary);
  const saysOutbound = /\bcompany (called|rang|contacted)\b/i.test(summary);
  if (dir.direction === 'outbound' && saysInbound) hints.push({ rule: 'call_direction', message: 'Agent opened by asking for a named person (outbound), but summary says the customer called the company.', turnId: dir.turnId });
  if (dir.direction === 'inbound' && saysOutbound) hints.push({ rule: 'call_direction', message: 'Call looks inbound (service greeting), but summary says the company called.', turnId: dir.turnId });

  if (/\b(arrears|balance|outstanding)\b[^.]{0,25}£\s?\d|£\s?[\d,.]+\s+(of\s+)?(arrears|balance)/i.test(summary)) {
    hints.push({ rule: 'arrears_amount', message: 'Rubric forbids stating arrears/balance amounts.' });
  }
  if (/payment of £\s?[\d,.]+ (was )?(made|taken)|£\s?[\d,.]+ payment (was )?(made|taken)/i.test(summary)) {
    hints.push({ rule: 'payment_made_amount', message: 'Rubric forbids amounts for payments taken during the call ("Payment made").' });
  }

  const n = sentenceCount(summary);
  if (!terminal && (n < 2 || n > 5)) hints.push({ rule: 'format', message: `Summary has ${n} sentence(s); rubric asks for 2–5.` });
  if (/^\s*([-•*]|\d+\.)\s/m.test(summary)) hints.push({ rule: 'format', message: 'Rubric forbids bullet points.' });

  const us = US_SPELLINGS.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(summary));
  if (us.length) hints.push({ rule: 'british_english', message: `US spelling(s): ${us.join(', ')}.` });

  if (/further action/i.test(agentText) && !/risk of further action/i.test(summary)) {
    hints.push({ rule: 'risk_of_further_action', message: 'Agent mentioned further action; summary lacks "risk of further action".', turnId: turns.find((t) => t.speaker === 'Agent' && /further action/i.test(t.text))?.turnId });
  }
  if (/further action/i.test(summary) && !/further action/i.test(agentText)) {
    hints.push({ rule: 'risk_of_further_action', message: 'Summary mentions further action, but the agent never said it.' });
  }

  const websiteTurn = turns.find((t) => t.speaker === 'Agent' && /\bwebsite\b|signpost/i.test(t.text));
  if (websiteTurn && !/customer signposted/i.test(summary)) hints.push({ rule: 'signposting', message: 'Agent pointed to the website/signposting; summary lacks "customer signposted".', turnId: websiteTurn.turnId });

  for (const body of ADVICE_BODIES) {
    const t = turns.find((x) => x.speaker === 'Agent' && x.text.toLowerCase().includes(body.toLowerCase()));
    if (t && !summary.toLowerCase().replace(/\s/g, '').includes(body.toLowerCase().replace(/\s/g, ''))) {
      hints.push({ rule: 'advice_referral', message: `Agent referred to ${body}; summary does not mention it.`, turnId: t.turnId });
    }
  }

  const consentTurn = turns.find((t) => t.speaker === 'Agent' && /\b(note|record)\b.*\?/i.test(t.text) && /health|depress|anxi|vulnerab|condition|illness|disab|mental|bereave|injur|sick|carer/i.test(t.text));
  if (consentTurn && !/consent gained to record vulnerability/i.test(summary)) {
    hints.push({ rule: 'consent', message: 'Agent asked permission to record circumstances; check whether "Consent gained to record vulnerability" is required.', turnId: consentTurn.turnId });
  }
  return hints;
}
