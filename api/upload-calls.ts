import { PATHS, createJsonFile, getJsonFile, readJsonDir, requireGitHubConfig } from '../server/github.js';
import { allowMethod, readJsonBody, sendError, HttpError, type ApiRequest, type ApiResponse } from '../server/http.js';
import type { AppCall, CallRecord } from '../shared/types.js';
import { LIMITS, assignCallIds, contentHash, validateUploadedCalls } from '../shared/validation.js';

/** POST /api/upload-calls — validates and imports new transcript–summary pairs (one file per call). */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!allowMethod(req, res, 'POST')) return;
  try {
    const body = readJsonBody(req, LIMITS.maxUploadBytes);
    const result = validateUploadedCalls(body);
    if (!result.ok) throw new HttpError(400, 'Upload failed validation', { errors: result.errors, warnings: result.warnings });

    const cfg = requireGitHubConfig();
    const [supplied, uploaded] = await Promise.all([
      getJsonFile<CallRecord[]>(cfg, 'data/candidate-calls.json'),
      readJsonDir<AppCall>(cfg, PATHS.uploadedDir),
    ]);
    const existing = new Map<string, string>();
    for (const c of [...(supplied?.data ?? []), ...uploaded]) existing.set(c.id, contentHash(c));

    const { toImport, skipped, renamed } = assignCallIds(result.calls, existing);
    const imported: AppCall[] = [];
    const failed: { id: string; error: string }[] = [];
    const uploadedAt = new Date().toISOString();
    for (const call of toImport) {
      const record: AppCall = { ...call, source: 'uploaded', uploadedAt };
      try {
        await createJsonFile(cfg, PATHS.uploadedCall(call.id), record, `data: import uploaded call ${call.id}`);
        imported.push(record);
      } catch (err) {
        failed.push({ id: call.id, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    }
    res.status(failed.length && !imported.length ? 502 : 200).json({ imported, skipped, renamed, failed, warnings: result.warnings });
  } catch (err) {
    sendError(res, err);
  }
}
