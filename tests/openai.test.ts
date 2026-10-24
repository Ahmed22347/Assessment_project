import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import calls from '../data/candidate-calls.json';
import { analyzeCall, type OpenAIConfig } from '../server/openai';

// Fake Responses API: records the request and replies with whatever `reply` is set to.
let server: Server;
let cfg: OpenAIConfig;
let lastBody: any;
let reply: { status: number; body: unknown };

beforeAll(async () => {
  server = createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    lastBody = JSON.parse(raw);
    res.writeHead(reply.status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reply.body));
  });
  await new Promise<void>((r) => server.listen(0, r));
  cfg = { apiKey: 'k', model: 'gpt-6-luna', timeoutMs: 5000, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
});
afterAll(() => server.close());

const call = calls.find((c) => c.id === 'CALL-020')!;
const message = (text: string) => ({ status: 200, body: { status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text }] }] } });

describe('OpenAI Responses integration', () => {
  it('sends a strict json_schema request with the rubric and returns verified findings', async () => {
    reply = message(JSON.stringify({
      recommendation: 'needs_correction', confidence: 'high', overallExplanation: 'Invented promise.',
      findings: [{ category: 'payment_commitment', severity: 'high', certainty: 'definite', summaryClaim: 'the customer agreed to pay £80 on 23 October',
        transcriptEvidence: [{ turnId: 'T22', quote: "I haven't promised eighty, I've only paid fifty today." }],
        explanation: 'Customer explicitly did not promise £80.', suggestedCorrection: 'Remove the £80 promise.' }],
      suggestedSummary: 'Corrected.',
    }));
    const out = await analyzeCall(call, cfg);
    expect(lastBody.model).toBe('gpt-6-luna');
    expect(lastBody.text.format).toMatchObject({ type: 'json_schema', strict: true });
    expect(lastBody.input[0].content).toContain('Consent gained to record vulnerability'); // rubric embedded
    expect(lastBody.input[1].content).toContain(call.summary);
    expect(out.findings[0].transcriptEvidence[0].verified).toBe(true);
    expect(out.warnings).toEqual([]);
  });

  it('rejects schema-invalid output, refusals, truncation and API errors', async () => {
    reply = message('{"recommendation":"maybe"}');
    await expect(analyzeCall(call, cfg)).rejects.toThrow(/failed validation/);
    reply = { status: 200, body: { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }] } };
    await expect(analyzeCall(call, cfg)).rejects.toThrow(/refused/);
    reply = { status: 200, body: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } } };
    await expect(analyzeCall(call, cfg)).rejects.toThrow(/incomplete/);
    reply = { status: 401, body: { error: { message: 'Incorrect API key' } } };
    await expect(analyzeCall(call, cfg)).rejects.toThrow(/401.*Incorrect API key/);
  });
});
