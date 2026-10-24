import type { TranscriptTurn } from './types.js';

const TURN_RE = /^(T\d+)\s*(?:\[(\d{1,2}:\d{2}(?::\d{2})?)\])?\s*([^:]{1,40}):\s?(.*)$/;

/** Parses "T05 [00:23] Agent: text" lines. Unparseable lines are attached to the previous turn. */
export function parseTranscript(transcript: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const rawLine of transcript.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = TURN_RE.exec(line);
    if (m) {
      turns.push({ turnId: m[1], timestamp: m[2] ?? null, speaker: m[3].trim(), text: m[4] });
    } else if (turns.length) {
      turns[turns.length - 1].text += `\n${line}`;
    } else {
      turns.push({ turnId: `L${turns.length + 1}`, timestamp: null, speaker: 'Unknown', text: line });
    }
  }
  return turns;
}

/** Normalises text for tolerant quote matching (case, curly quotes, dashes, whitespace). */
export function normaliseForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‛`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strips an optional leading "..." / trailing "..." an LLM may add around excerpts. */
function trimEllipses(q: string): string {
  return q.replace(/^\s*(\.\.\.|…)\s*/, '').replace(/\s*(\.\.\.|…)\s*$/, '');
}

/**
 * Locates a quotation in the transcript. Prefers the cited turn; falls back to any turn.
 * Returns the turn ID where it was found, or null when the quote does not appear verbatim.
 */
export function locateQuote(turns: TranscriptTurn[], quote: string, preferredTurnId?: string): string | null {
  const q = normaliseForMatch(trimEllipses(quote)).replace(/^["']|["']$/g, '');
  if (q.length < 3) return null;
  const preferred = turns.find((t) => t.turnId === preferredTurnId);
  if (preferred && normaliseForMatch(preferred.text).includes(q)) return preferred.turnId;
  const hit = turns.find((t) => normaliseForMatch(t.text).includes(q));
  return hit ? hit.turnId : null;
}
