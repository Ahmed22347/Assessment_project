import { PATHS, requireGitHubConfig, updateJsonFile } from '../server/github.js';
import { allowMethod, readJsonBody, sendError, HttpError, type ApiRequest, type ApiResponse } from '../server/http.js';
import type { ReviewRecord } from '../shared/types.js';
import { mergeHuman, validateSaveReview } from '../shared/validation.js';

/** POST /api/save-review — records the human QA decision; AI output in the same file is preserved. */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!allowMethod(req, res, 'POST')) return;
  try {
    const parsed = validateSaveReview(readJsonBody(req, 50_000));
    if (!parsed.ok) throw new HttpError(400, parsed.error);
    const input = parsed.value;
    const cfg = requireGitHubConfig();
    const { data, commitSha } = await updateJsonFile<ReviewRecord>(
      cfg,
      PATHS.review(input.callId),
      (current) => mergeHuman(current, input),
      `data: save QA review for ${input.callId} (${input.decision})`,
    );
    res.status(200).json({ review: data, commitSha });
  } catch (err) {
    sendError(res, err);
  }
}
