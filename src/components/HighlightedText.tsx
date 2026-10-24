import { findQuoteRange } from '../lib/highlight';

/** Renders plain text (React-escaped, never as HTML) with an optional highlighted quotation. */
export function HighlightedText({ text, quote }: { text: string; quote?: string | null }) {
  const range = quote ? findQuoteRange(text, quote) : null;
  if (!range) return <>{text}</>;
  return (
    <>
      {text.slice(0, range[0])}
      <mark className="evidence">{text.slice(range[0], range[1])}</mark>
      {text.slice(range[1])}
    </>
  );
}
