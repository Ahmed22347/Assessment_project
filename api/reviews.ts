import { PATHS, getGitHubConfig, readJsonDir } from '../server/github.js';
import { allowMethod, sendError, type ApiRequest, type ApiResponse } from '../server/http.js';
import type { AppCall, ReviewRecord } from '../shared/types.js';

/** GET /api/reviews — all persisted review records and uploaded calls, read live from GitHub. */
export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (!allowMethod(req, res, 'GET')) return;
  const cfg = getGitHubConfig();
  if (!cfg) return res.status(200).json({ configured: false, reviews: [], uploadedCalls: [] });
  try {
    const [reviews, uploadedCalls] = await Promise.all([
      readJsonDir<ReviewRecord>(cfg, PATHS.reviewsDir),
      readJsonDir<AppCall>(cfg, PATHS.uploadedDir),
    ]);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      configured: true,
      reviews: reviews.filter((r) => r && typeof r.callId === 'string'),
      uploadedCalls: uploadedCalls.filter((c) => c && typeof c.id === 'string').map((c) => ({ ...c, source: 'uploaded' })),
    });
  } catch (err) {
    sendError(res, err);
  }
}
