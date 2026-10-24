import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
// @ts-expect-error plain JS helper
import { createFakeGitHub } from '../scripts/fake-github.mjs';
import { getJsonFile, readJsonDir, updateJsonFile, type GitHubConfig } from '../server/github';
import { HttpError } from '../server/http';

let fake: ReturnType<typeof createFakeGitHub>;
let cfg: GitHubConfig;

beforeAll(async () => {
  fake = createFakeGitHub();
  await new Promise<void>((r) => fake.server.listen(0, r));
  const { port } = fake.server.address() as AddressInfo;
  cfg = { token: 't', owner: 'o', repo: 'r', branch: 'main', apiUrl: `http://127.0.0.1:${port}` };
});
afterAll(() => fake.server.close());

describe('GitHub Contents persistence', () => {
  it('treats missing files and directories as empty', async () => {
    expect(await getJsonFile(cfg, 'reviews/NONE.json')).toBeNull();
    expect(await readJsonDir(cfg, 'reviews')).toEqual([]);
  });

  it('creates, then updates using the current SHA, committing to main', async () => {
    await updateJsonFile(cfg, 'reviews/A.json', () => ({ v: 1 }), 'data: one');
    await updateJsonFile<{ v: number }>(cfg, 'reviews/A.json', (cur) => ({ v: (cur?.v ?? 0) + 1 }), 'data: two');
    expect((await getJsonFile<{ v: number }>(cfg, 'reviews/A.json'))?.data).toEqual({ v: 2 });
    expect(fake.state.commits.map((c: { branch: string }) => c.branch)).toEqual(['main', 'main']);
    expect(await readJsonDir(cfg, 'reviews')).toEqual([{ v: 2 }]);
  });

  it('retries after a concurrent write instead of overwriting it', async () => {
    let first = true;
    await updateJsonFile<{ v: number; tags?: string[] }>(cfg, 'reviews/A.json', (cur) => {
      if (first) { first = false; fake.files.set('reviews/A.json', JSON.stringify({ v: 99 })); } // someone else commits mid-flight
      return { ...(cur ?? { v: 0 }), tags: ['mine'] };
    }, 'data: concurrent');
    expect((await getJsonFile(cfg, 'reviews/A.json'))?.data).toEqual({ v: 99, tags: ['mine'] });
  });

  it('surfaces write failures as errors (no false success)', async () => {
    fake.state.failWrites = true;
    await expect(updateJsonFile(cfg, 'reviews/B.json', () => ({}), 'x')).rejects.toBeInstanceOf(HttpError);
    fake.state.failWrites = false;
  });

  it('reports bad credentials as an error', async () => {
    const res = await fetch(`${cfg.apiUrl}/repos/o/r/contents/x`);
    expect(res.status).toBe(401);
  });
});
