# Call Summary QA

An internal QA tool for checking AI-generated collections call summaries against their source transcripts. Reviewers browse calls, read the summary and the full transcript side by side, and can ask an AI model for an evidence-linked assessment. They then record their own decision, which is persisted to this GitHub repository.

**The transcript is the only source of truth. AI output is advisory, and only a human decision counts as a completed QA review.**

## Architecture

```
src/        React + TypeScript + Tailwind UI (dashboard, review page, upload dialog)
api/        Vercel serverless functions (one file per route)
server/     Server-only code: OpenAI client, GitHub Contents client, HTTP helpers
shared/     Isomorphic code used by UI, API and scripts: types, validation,
            transcript parsing, quote verification, prompt + JSON schema, rule checks
scripts/    check-calls.ts (batch checker), fake-github.mjs, sync-rules.mjs
data/       candidate-calls.json (copy of the supplied data, bundled into the UI)
            uploaded-calls/<id>.json (written at runtime via GitHub API)
reviews/    <callId>.json — one file per call: AI analysis + human decision
exercise_data/  The four supplied files, unmodified
```

| Route | Purpose |
|---|---|
| `GET /api/health` | Which integrations are configured (never the secrets) |
| `GET /api/reviews` | All review records and uploaded calls, read live from GitHub |
| `POST /api/save-review` | Save a human decision `{callId, decision, notes, correctedSummary}` |
| `POST /api/analyze` | `{callId, transcript, summary, call_date?}` → structured AI assessment (also persisted) |
| `POST /api/upload-calls` | Validate and import new calls |

**Key decisions**
- **Supplied calls are bundled into the frontend.** All 20 are browsable immediately, with no API calls and no dependency on OpenAI or GitHub.
- **One review file per call** (`reviews/CALL-019.json`) holds `ai` and `human` sections. Saving a decision never overwrites the AI analysis, and re-analysing never overwrites the decision. Per-call files keep write conflicts rare.
- **GitHub Contents API with optimistic concurrency.** Each write reads the file's current SHA, commits with it, and retries on a 409 or 422 conflict. A missing file is treated as new. Every failure becomes an error response, so the UI only shows "Saved" after GitHub confirms the commit.
- **The rubric is embedded verbatim.** `shared/summaryRules.ts` is generated from `exercise_data/summary-rules.txt` (`npm run sync-rules`), and a test fails if they drift. Serverless functions therefore need no file-system access.
- **OpenAI Responses API with Structured Outputs** (strict JSON schema), plus server-side validation and **quote verification**. Every quoted piece of evidence is checked against the transcript. If a quote is found in a different turn, it is re-pointed there. If it isn't found at all, it is flagged "not found verbatim" in the UI rather than shown as fact. The server also warns when the recommendation contradicts the findings, for example "acceptable" alongside high-severity issues.
- **Findings carry `certainty`** (`definite` or `possible`), so ambiguous evidence is shown as uncertain rather than as a definite error.
- **No router or state library.** Hash routing (`#/call/CALL-019`) and React state keep dependencies minimal: react, react-dom and lucide-react at runtime.
- **Local dev without `vercel dev`.** A small Vite middleware (`vite.config.ts`) serves `api/*.ts` with the same request and response helpers Vercel provides.

## Setup

```bash
npm install
cp .env.example .env.local     # fill in values (see below)
npm run dev                    # http://localhost:5173 — UI + /api routes
npm test                       # unit + integration tests
npm run build                  # production build
```

The app works with no environment variables. Calls are browsable and manual review works, but saving is disabled and a banner explains why.

### Environment variables (server-side only; never prefix with `VITE_`)

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | OpenAI key |
| `OPENAI_MODEL` | Model ID, e.g. `gpt-6-luna`. Not hardcoded anywhere; confirm the exact ID in your OpenAI account |
| `GITHUB_TOKEN` | Fine-grained PAT, **this repository only**, permission **Contents: Read and write** (nothing else) |
| `GITHUB_OWNER` / `GITHUB_REPO` | Repository that stores the data (normally this repo) |
| `GITHUB_BRANCH` | `main` |
| `OPENAI_TIMEOUT_MS`, `OPENAI_BASE_URL`, `GITHUB_API_URL` | Optional overrides (used for local testing) |

### Deploying to Vercel

1. Push this repository to GitHub, on the `main` branch.
2. In Vercel: **Add New → Project → Import** the repository. The framework is detected as Vite; build command `npm run build`, output `dist`.
3. **Settings → Environment Variables:** add every variable above for Production (and Preview if wanted), then redeploy.
4. Open `/api/health` on the deployment. It should report `openai: true` and `github: true`.

Data commits go straight to `main`. `vercel.json` runs `scripts/vercel-ignore.sh` as Vercel's ignored-build step. It skips a rebuild when a commit only touches `reviews/` or `data/uploaded-calls/`, because that data is read live from the GitHub API and doesn't need a redeploy. When there is no parent commit, or git errors, the script builds.

## Batch checking the existing calls

```bash
npm run check-calls -- --dry-run          # free: validates data + deterministic rule hints
npm run check-calls                       # + AI review of all 20 calls (cached in reports/ai/)
npm run check-calls -- --ids CALL-019,CALL-020 --force
npm run check-calls -- --save             # also persist AI results to GitHub so the app shows them
```

The script runs two layers:
1. **Deterministic rule hints** (`shared/ruleChecks.ts`), with no API cost. They catch mechanical rubric breaches: wrong call direction, arrears or payment-taken amounts, a missing DPA statement, missing "risk of further action", "customer signposted" or advice referral, sentence count, and US spellings. They are hints, not verdicts.
2. **AI review** with `OPENAI_MODEL`. The script prints a table (recommendation, findings by severity, unverified quotes) and writes `reports/check-calls.md`. It also compares the AI against **manually verified reference cases** (`scripts/reference-cases.json`) and reports agreement, so a wrong AI verdict is visible.

## Testing the core workflow

1. On the dashboard, confirm 20 calls are listed, then try search (e.g. "StepChange") and the status filters.
2. Open **CALL-019**. The summary is on the left and the transcript on the right, and each scrolls independently.
3. Choose **Analyse with AI**. Click a quote under any finding: the transcript scrolls to the cited turn and highlights the quote, and the summary claim is highlighted too.
4. Choose a decision, add notes and **Save decision**. You should see "Saved to GitHub … commit abc1234". Refresh the page and the decision is still there.
5. **Upload calls:** an invalid file (e.g. missing `summary`) shows field-level errors. A valid file imports the calls, which you can then analyse and review.

**Local persistence without credentials:** run `npm run fake-github` (a GitHub Contents API stand-in with SHA checks), then set `GITHUB_TOKEN=x GITHUB_OWNER=x GITHUB_REPO=x GITHUB_API_URL=http://127.0.0.1:4010` in `.env.local`.

## What was checked

- `npm test` runs 25 tests:
  - Data validation: all 20 supplied calls are valid and parse into turns.
  - Upload validation and error messages; ID assignment (clash → renamed, identical content → skipped, stable IDs).
  - Quote verification, including detection of a fabricated quote.
  - Recommendation consistency warnings.
  - Merging human and AI data without clobbering either.
  - GitHub client against a fake Contents API: missing files, SHA updates, **retry after a concurrent write**, write failure raised as an error.
  - OpenAI contract: strict json_schema request with the embedded rubric; refusals, truncation, schema-invalid output and HTTP errors all surface as errors.
  - Rule hints against manually verified cases.
- **Browser (headless Chrome, against the fake GitHub API):**
  - Dashboard lists 22 calls (20 supplied + 2 uploaded).
  - Search, filters and the empty state work.
  - Evidence click scrolls to the turn and highlights the quote; an unverified quote is flagged.
  - Overriding the AI recommendation shows a notice.
  - Save, then refresh, keeps the decision.
  - **GitHub outage during save shows "Not saved: …" with no success message.**
  - Invalid and non-JSON uploads show errors; a valid upload can be reviewed, and that review survives a refresh.
  - The layout works at 820px wide.
- **Manual review against the rules** (recorded in `scripts/reference-cases.json`):

  | Call | Verdict | Reason |
  |---|---|---|
  | CALL-001 | Accurate | — |
  | CALL-019 | Error | Outbound call described as inbound; consent phrase missing |
  | CALL-020 | Error | **Invented £80 payment promise**: the customer said three times that it was not a promise; also omits risk of further action |
  | CALL-015 | Error | Omits risk of further action |
  | CALL-016 | Error | States the amount of the payment taken on the call |
  | CALL-003 | Error | States the arrears amount |
  | CALL-011 | Error | Missing "customer signposted" |
  | CALL-014 | Error | Names the employer |

- `npm run build` succeeds. The built bundle and the tracked files were searched for secrets (none found); `.env*` is git-ignored except `.env.example`.
- **Not yet verified:** live calls to OpenAI and GitHub, and the Vercel deployment. No credentials were available while building. Run `npm run check-calls` once `OPENAI_API_KEY` and `OPENAI_MODEL` are set, and check `/api/health` after deploying.

## Assumptions

- The transcript is the source of truth; no external account data is consulted.
- Material accuracy matters more than verbatim matching: harmless paraphrase is not flagged, and an omission counts only if the topic was discussed *and* the rules require it.
- AI analysis is advisory. Humans make the final QA decision, and the AI recommendation and human decision are visually distinct (dashed "AI" badge vs solid reviewer badge).
- The original summary is never modified. A reviewer's corrected summary is stored separately and only for "Needs correction".
- The data has no customer identifier field, so none is shown or invented.
- GitHub JSON persistence suits this prototype but is not a production database: there are no queries or transactions, and listing reads one file per call.
- Data commits go directly to `main` by design.
- All data is synthetic. Real customer data would need authentication, authorisation, audit trails, encryption and data-retention controls.

## Known limitations

- **No authentication or per-user identity.** Anyone with the URL can view and save. Reviewer identity is not recorded.
- **Rate limiting is best-effort.** The analyse endpoint has a per-call in-flight lock and a 20-second cooldown per serverless instance, the UI disables buttons during requests, and re-analysing asks for confirmation. There is no global rate limit.
- **Uploads commit one file per call**, so a 50-call upload makes 50 commits.
- `GET /api/reviews` reads every review file. That's fine for hundreds of calls but would need the Git Trees API or a real database beyond that.
- Concurrent edits by two reviewers to the same call: the last save wins (both commits are kept in git history).
- AI quality depends on the model. Quote verification catches fabricated *quotes*, but not a wrong interpretation of a real quote; that is what human review is for.

## What I would build next

1. Authentication (e.g. Vercel or SSO) with reviewer identity stored on each decision, and an audit trail view built from git history.
2. Show the deterministic rule hints in the review UI next to the AI findings.
3. A diff view between the original and the corrected summary.
4. Run the AI against the reference cases on every prompt or model change (a regression evaluation), and expand the reference set to all 20 calls.
5. Move to a real database once volume or concurrency grows.
