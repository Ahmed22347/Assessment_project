/**
 * Checks the existing transcript–summary pairs.
 *
 *   npm run check-calls -- --dry-run              # data validation + deterministic rule hints only (no API cost)
 *   npm run check-calls                           # + AI review of every call with OPENAI_MODEL (cached in reports/ai/)
 *   npm run check-calls -- --ids CALL-001,CALL-019 --force --concurrency 2
 *   npm run check-calls -- --save                 # also persist AI results to GitHub (reviews/<id>.json) so the app shows them
 *
 * Output: console table + reports/check-calls.md. AI results are advisory, not QA decisions.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { analyzeCall, getOpenAIConfig } from '../server/openai.js';
import { PATHS, getGitHubConfig, updateJsonFile } from '../server/github.js';
import { checkSummaryRules } from '../shared/ruleChecks.js';
import type { AiAnalysis, CallRecord, ReviewRecord } from '../shared/types.js';
import { mergeAi, validateUploadedCalls } from '../shared/validation.js';

for (const f of ['.env', '.env.local']) if (existsSync(f)) process.loadEnvFile(f);

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const dryRun = flag('dry-run');
const force = flag('force');
const save = flag('save');
const concurrency = Math.max(1, Math.min(5, Number(opt('concurrency') ?? 3)));
const file = opt('file') ?? 'data/candidate-calls.json';

const raw = JSON.parse(readFileSync(file, 'utf8'));
const validation = validateUploadedCalls(raw);
if (!validation.ok) {
  console.error(`✖ ${file} failed validation:\n  ${validation.errors.join('\n  ')}`);
  process.exit(1);
}
const wanted = opt('ids')?.split(',').map((s) => s.trim());
const calls: CallRecord[] = validation.calls.filter((c) => !wanted || wanted.includes(c.id)).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
console.log(`✔ ${file}: ${validation.calls.length} calls valid; checking ${calls.length}.${validation.warnings.length ? `\n  ${validation.warnings.join('\n  ')}` : ''}`);

interface Row { call: CallRecord; hints: ReturnType<typeof checkSummaryRules>; ai?: AiAnalysis; error?: string; cached?: boolean; saved?: boolean }
const rows: Row[] = calls.map((call) => ({ call, hints: checkSummaryRules(call) }));

if (!dryRun) {
  let cfg;
  try { cfg = getOpenAIConfig(); } catch (e) { console.error(`✖ ${(e as Error).message} Use --dry-run to skip AI review.`); process.exit(1); }
  const gh = save ? getGitHubConfig() : null;
  if (save && !gh) { console.error('✖ --save requires GITHUB_TOKEN, GITHUB_OWNER and GITHUB_REPO.'); process.exit(1); }
  mkdirSync('reports/ai', { recursive: true });
  console.log(`Running AI review with model "${cfg.model}" (concurrency ${concurrency})…`);
  const queue = [...rows];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      const cachePath = `reports/ai/${row.call.id}.json`;
      try {
        if (!force && existsSync(cachePath)) {
          row.ai = JSON.parse(readFileSync(cachePath, 'utf8'));
          row.cached = true;
        } else {
          row.ai = await analyzeCall(row.call, cfg);
          writeFileSync(cachePath, JSON.stringify(row.ai, null, 2));
        }
        if (gh && row.ai) {
          const ai = row.ai;
          await updateJsonFile<ReviewRecord>(gh, PATHS.review(row.call.id), (cur) => mergeAi(cur, row!.call.id, ai), `data: save AI analysis for ${row.call.id} (${ai.recommendation})`);
          row.saved = true;
        }
        process.stdout.write(`  ${row.call.id}: ${row.ai?.recommendation}${row.cached ? ' (cached)' : ''}${row.saved ? ' → saved' : ''}\n`);
      } catch (e) {
        row.error = (e as Error).message;
        process.stdout.write(`  ${row.call.id}: ERROR ${row.error}\n`);
      }
    }
  }));
}

// ---- Report ----
const unverified = (ai?: AiAnalysis) => ai?.findings.flatMap((f) => f.transcriptEvidence).filter((e) => !e.verified).length ?? 0;
console.log('\nCall        Rule hints  AI recommendation      Findings (H/M/L)  Unverified quotes');
for (const r of rows) {
  const sev = (s: string) => r.ai?.findings.filter((f) => f.severity === s).length ?? 0;
  console.log(
    `${r.call.id.padEnd(12)}${String(r.hints.length).padEnd(12)}${(r.error ? 'ERROR' : r.ai?.recommendation ?? '—').padEnd(23)}${(r.ai ? `${r.ai.findings.length} (${sev('high')}/${sev('medium')}/${sev('low')})` : '—').padEnd(18)}${r.ai ? unverified(r.ai) : '—'}`,
  );
}
if (!dryRun) {
  const tally = (rec: string) => rows.filter((r) => r.ai?.recommendation === rec).length;
  console.log(`\nAI: ${tally('acceptable')} acceptable, ${tally('needs_correction')} needs correction, ${tally('unable_to_determine')} unable to determine, ${rows.filter((r) => r.error).length} errors. Total unverified quotes: ${rows.reduce((n, r) => n + unverified(r.ai), 0)}.`);
}

// Agreement with manually verified reference cases (categories are a soft check: the AI may label an issue differently).
const reference = JSON.parse(readFileSync('scripts/reference-cases.json', 'utf8')) as Record<string, { expected: string; categories?: string[]; why: string }>;
const refRows = rows.filter((r) => r.ai && reference[r.call.id]);
if (refRows.length) {
  console.log('\nReference cases (manual verdict vs AI):');
  let agree = 0;
  for (const r of refRows) {
    const ref = reference[r.call.id];
    const ok = r.ai!.recommendation === ref.expected;
    if (ok) agree++;
    const missing = (ref.categories ?? []).filter((c) => !r.ai!.findings.some((f) => f.category === c));
    console.log(`  ${ok ? '✔' : '✖'} ${r.call.id}: expected ${ref.expected}, AI ${r.ai!.recommendation}${missing.length ? ` (expected categories not found: ${missing.join(', ')})` : ''}`);
  }
  console.log(`  Agreement: ${agree}/${refRows.length}`);
}

const md: string[] = [`# Call summary check — ${new Date().toISOString()}`, '', `Source: \`${file}\`. Rule hints are deterministic heuristics; AI results${dryRun ? ' were not run' : ` used model \`${process.env.OPENAI_MODEL}\``}. Both are advisory — a human reviewer makes the QA decision.`, ''];
for (const r of rows) {
  md.push(`## ${r.call.id}`, '', `> ${r.call.summary}`, '');
  if (r.hints.length) { md.push('**Rule hints**', ''); for (const h of r.hints) md.push(`- \`${h.rule}\`${h.turnId ? ` (${h.turnId})` : ''}: ${h.message}`); md.push(''); }
  if (r.error) md.push(`**AI error:** ${r.error}`, '');
  if (r.ai) {
    md.push(`**AI: ${r.ai.recommendation}** (confidence ${r.ai.confidence}) — ${r.ai.overallExplanation}`, '');
    for (const [i, f] of r.ai.findings.entries()) {
      md.push(`${i + 1}. **${f.category}** · ${f.severity} · ${f.certainty} — ${f.explanation}`);
      if (f.summaryClaim) md.push(`   - Summary: “${f.summaryClaim}”`);
      for (const e of f.transcriptEvidence) md.push(`   - ${e.turnId}: “${e.quote}”${e.verified ? '' : ' ⚠ NOT FOUND IN TRANSCRIPT'}`);
      if (f.suggestedCorrection) md.push(`   - Correction: ${f.suggestedCorrection}`);
    }
    for (const w of r.ai.warnings) md.push(`- ⚠ ${w}`);
    if (r.ai.suggestedSummary) md.push('', `Suggested summary: ${r.ai.suggestedSummary}`);
    md.push('');
  }
}
mkdirSync('reports', { recursive: true });
writeFileSync('reports/check-calls.md', md.join('\n'));
console.log('\nReport written to reports/check-calls.md');
