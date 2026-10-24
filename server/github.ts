import { HttpError } from './http.js';

/**
 * Thin GitHub Contents API client used as a JSON document store.
 * Writes go straight to the configured branch (main) using the file's current SHA.
 */
export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  apiUrl: string;
}

export function getGitHubConfig(env = process.env): GitHubConfig | null {
  const { GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO } = env;
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) return null;
  return {
    token: GITHUB_TOKEN,
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    branch: env.GITHUB_BRANCH || 'main',
    apiUrl: (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, ''),
  };
}

export function requireGitHubConfig(): GitHubConfig {
  const cfg = getGitHubConfig();
  if (!cfg) throw new HttpError(503, 'Persistence is not configured (GITHUB_TOKEN, GITHUB_OWNER and GITHUB_REPO are required).');
  return cfg;
}

const TIMEOUT_MS = 15_000;

async function gh(cfg: GitHubConfig, path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${cfg.apiUrl}/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}/contents/${path}`;
  try {
    return await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'call-summary-qa',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new HttpError(502, `GitHub request failed: ${(err as Error).name === 'TimeoutError' ? 'timed out' : 'network error'}`);
  }
}

async function ghError(res: Response, action: string): Promise<HttpError> {
  let msg = '';
  try { msg = ((await res.json()) as { message?: string }).message ?? ''; } catch { /* ignore */ }
  const status = res.status === 401 || res.status === 403 ? 502 : res.status >= 500 ? 502 : res.status;
  return new HttpError(status, `GitHub ${action} failed (${res.status}${msg ? `: ${msg}` : ''})`);
}

export interface JsonFile<T> { data: T; sha: string }

export async function getJsonFile<T>(cfg: GitHubConfig, path: string): Promise<JsonFile<T> | null> {
  const res = await gh(cfg, `${path}?ref=${encodeURIComponent(cfg.branch)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw await ghError(res, `read of ${path}`);
  const body = (await res.json()) as { content?: string; sha: string; encoding?: string };
  if (typeof body.content !== 'string') throw new HttpError(502, `GitHub returned no content for ${path}`);
  try {
    return { data: JSON.parse(Buffer.from(body.content, 'base64').toString('utf8')) as T, sha: body.sha };
  } catch {
    throw new HttpError(502, `Stored file ${path} is not valid JSON`);
  }
}

/** Lists *.json files in a directory; a missing directory is treated as empty. */
export async function listJsonFiles(cfg: GitHubConfig, dir: string): Promise<string[]> {
  const res = await gh(cfg, `${dir}?ref=${encodeURIComponent(cfg.branch)}`);
  if (res.status === 404) return [];
  if (!res.ok) throw await ghError(res, `listing of ${dir}`);
  const items = (await res.json()) as { type: string; name: string; path: string }[];
  if (!Array.isArray(items)) return [];
  return items.filter((i) => i.type === 'file' && i.name.endsWith('.json')).map((i) => i.path);
}

export async function readJsonDir<T>(cfg: GitHubConfig, dir: string): Promise<T[]> {
  const paths = await listJsonFiles(cfg, dir);
  const out: T[] = [];
  // Small batches keep us well inside GitHub's secondary rate limits.
  for (let i = 0; i < paths.length; i += 10) {
    const files = await Promise.all(paths.slice(i, i + 10).map((p) => getJsonFile<T>(cfg, p)));
    for (const f of files) if (f) out.push(f.data);
  }
  return out;
}

async function putJsonFile(cfg: GitHubConfig, path: string, data: unknown, message: string, sha?: string): Promise<Response> {
  const content = Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8').toString('base64');
  return gh(cfg, path, { method: 'PUT', body: JSON.stringify({ message, content, branch: cfg.branch, ...(sha ? { sha } : {}) }) });
}

/**
 * Read-modify-write with optimistic concurrency: fetch the current SHA, apply `update`,
 * commit with that SHA, and retry if someone else committed in between (409/422).
 */
export async function updateJsonFile<T>(
  cfg: GitHubConfig,
  path: string,
  update: (current: T | null) => T,
  message: string,
  maxAttempts = 3,
): Promise<{ data: T; commitSha: string | null }> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const current = await getJsonFile<T>(cfg, path);
    const next = update(current?.data ?? null);
    const res = await putJsonFile(cfg, path, next, message, current?.sha);
    if (res.ok) {
      const body = (await res.json().catch(() => ({}))) as { commit?: { sha?: string } };
      return { data: next, commitSha: body.commit?.sha ?? null };
    }
    // 409: SHA no longer current. 422: file appeared since we read it (no SHA sent) or SHA mismatch.
    const conflict = res.status === 409 || res.status === 422;
    if (!conflict || attempt === maxAttempts) {
      if (conflict) throw new HttpError(409, `Save conflicted with another update to ${path}. Please retry.`);
      throw await ghError(res, `write of ${path}`);
    }
  }
  throw new HttpError(409, `Save conflicted with another update to ${path}. Please retry.`);
}

/** Creates a file only if it does not already exist (used for uploaded calls). */
export async function createJsonFile(cfg: GitHubConfig, path: string, data: unknown, message: string): Promise<void> {
  const res = await putJsonFile(cfg, path, data, message);
  if (res.ok) return;
  if (res.status === 422 || res.status === 409) throw new HttpError(409, `${path} already exists`);
  throw await ghError(res, `write of ${path}`);
}

export const PATHS = {
  review: (callId: string) => `reviews/${callId}.json`,
  reviewsDir: 'reviews',
  uploadedCall: (callId: string) => `data/uploaded-calls/${callId}.json`,
  uploadedDir: 'data/uploaded-calls',
};
