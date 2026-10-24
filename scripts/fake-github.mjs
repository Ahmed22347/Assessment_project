// Local stand-in for the GitHub Contents API (GET/PUT /repos/:o/:r/contents/:path) for testing
// persistence without real credentials. Implements SHA checks so conflict handling is exercised.
// Usage: node scripts/fake-github.mjs [port]  then set GITHUB_API_URL=http://localhost:<port>
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function createFakeGitHub({ seed = {}, persistFile = null, failWrites = false } = {}) {
  const files = new Map(Object.entries(seed)); // path -> utf8 content
  if (persistFile && existsSync(persistFile)) for (const [k, v] of Object.entries(JSON.parse(readFileSync(persistFile, 'utf8')))) files.set(k, v);
  const save = () => persistFile && writeFileSync(persistFile, JSON.stringify(Object.fromEntries(files)));
  const sha = (c) => createHash('sha1').update(c).digest('hex');
  const state = { failWrites, commits: [] };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const m = url.pathname.match(/^\/repos\/[^/]+\/[^/]+\/contents\/(.+)$/);
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (!req.headers.authorization?.startsWith('Bearer ')) return send(401, { message: 'Bad credentials' });
    if (!m) return send(404, { message: 'Not Found' });
    const path = decodeURIComponent(m[1]).replace(/\/$/, '');
    if (req.method === 'GET') {
      if (files.has(path)) {
        const c = files.get(path);
        return send(200, { type: 'file', path, name: path.split('/').pop(), sha: sha(c), encoding: 'base64', content: Buffer.from(c).toString('base64') });
      }
      const children = [...files.keys()].filter((p) => p.startsWith(`${path}/`) && !p.slice(path.length + 1).includes('/'));
      if (!children.length) return send(404, { message: 'Not Found' });
      return send(200, children.map((p) => ({ type: 'file', path: p, name: p.split('/').pop(), sha: sha(files.get(p)) })));
    }
    if (req.method === 'PUT') {
      if (state.failWrites) return send(500, { message: 'Simulated GitHub outage' });
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      const existing = files.get(path);
      if (existing !== undefined && !body.sha) return send(422, { message: '"sha" wasn\'t supplied.' });
      if (existing !== undefined && body.sha !== sha(existing)) return send(409, { message: `${path} does not match ${body.sha}` });
      const content = Buffer.from(body.content, 'base64').toString('utf8');
      files.set(path, content);
      state.commits.push({ path, message: body.message, branch: body.branch });
      save();
      return send(existing === undefined ? 201 : 200, { content: { path, sha: sha(content) }, commit: { sha: sha(`${Date.now()}${path}`) } });
    }
    send(405, { message: 'Method not allowed' });
  });
  return { server, files, state };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] || 4010);
  mkdirSync('.fake-github', { recursive: true });
  const { server } = createFakeGitHub({
    seed: { 'data/candidate-calls.json': readFileSync('data/candidate-calls.json', 'utf8') },
    persistFile: '.fake-github/store.json',
  });
  server.listen(port, () => console.log(`Fake GitHub Contents API on http://localhost:${port} (state in .fake-github/store.json)`));
}
