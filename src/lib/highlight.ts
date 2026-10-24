/**
 * Finds a quote inside text ignoring case, curly/straight quote and dash differences, and
 * runs of whitespace. Returns [start, end) in the ORIGINAL text, or null.
 */
export function findQuoteRange(text: string, quote: string): [number, number] | null {
  const fold = (c: string) =>
    c.toLowerCase().replace(/[‘’‛`´]/, "'").replace(/[“”]/, '"').replace(/[–—]/, '-');
  // Build a folded copy with collapsed whitespace and a map back to original indices.
  let folded = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const isSpace = /\s/.test(text[i]);
    if (isSpace && folded.endsWith(' ')) continue;
    folded += isSpace ? ' ' : fold(text[i]);
    map.push(i);
  }
  const q = Array.from(quote.replace(/^\s*(\.\.\.|…)|(\.\.\.|…)\s*$/g, '').trim().replace(/^["']|["']$/g, ''))
    .map((c) => (/\s/.test(c) ? ' ' : fold(c)))
    .join('')
    .replace(/ +/g, ' ');
  if (q.length < 3) return null;
  const at = folded.indexOf(q);
  if (at < 0) return null;
  return [map[at], map[at + q.length - 1] + 1];
}
