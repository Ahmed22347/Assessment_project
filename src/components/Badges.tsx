import { Bot, UserCheck } from 'lucide-react';
import type { Recommendation, ReviewStatus } from '../../shared/types';
import { REC_LABEL, REC_STYLE, STATUS_LABEL, STATUS_STYLE } from '../lib/labels';

/** Human decision: solid pill with a person icon. */
export function StatusBadge({ status }: { status: ReviewStatus }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLE[status]}`}>
      {status !== 'pending' && <UserCheck className="h-3.5 w-3.5" aria-hidden />}
      {STATUS_LABEL[status]}
    </span>
  );
}

/** AI recommendation: dashed outline with a bot icon, so it never looks like a human decision. */
export function AiBadge({ recommendation }: { recommendation: Recommendation | null | undefined }) {
  if (!recommendation) return <span className="text-xs text-slate-400">Not analysed</span>;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-dashed bg-white px-2.5 py-0.5 text-xs font-medium ${REC_STYLE[recommendation]}`}>
      <Bot className="h-3.5 w-3.5" aria-hidden />
      AI: {REC_LABEL[recommendation]}
    </span>
  );
}
