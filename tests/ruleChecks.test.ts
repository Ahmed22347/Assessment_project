import { describe, expect, it } from 'vitest';
import calls from '../data/candidate-calls.json';
import { checkSummaryRules, inferDirection } from '../shared/ruleChecks';

const get = (id: string) => calls.find((c) => c.id === id)!;
const rules = (id: string) => checkSummaryRules(get(id)).map((h) => h.rule);

describe('deterministic rule hints (manually verified cases)', () => {
  it('infers call direction from the opening turn', () => {
    expect(inferDirection(get('CALL-019').transcript).direction).toBe('outbound');
    expect(inferDirection(get('CALL-001').transcript).direction).toBe('inbound');
  });
  it('flags known rubric breaches', () => {
    expect(rules('CALL-019')).toEqual(expect.arrayContaining(['call_direction', 'consent']));
    expect(rules('CALL-003')).toContain('arrears_amount');
    expect(rules('CALL-016')).toContain('payment_made_amount');
    expect(rules('CALL-015')).toContain('risk_of_further_action');
    expect(rules('CALL-011')).toContain('signposting');
  });
  it('does not flag an accurate summary or a non-vulnerability "record" question', () => {
    expect(rules('CALL-001')).toEqual([]);
    expect(rules('CALL-014')).not.toContain('consent');
  });
});
