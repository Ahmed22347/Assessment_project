import { getGitHubConfig } from '../server/github.js';
import { allowMethod, type ApiRequest, type ApiResponse } from '../server/http.js';

/** Reports which integrations are configured (never the secrets themselves). */
export default function handler(req: ApiRequest, res: ApiResponse) {
  if (!allowMethod(req, res, 'GET')) return;
  const gh = getGitHubConfig();
  res.status(200).json({
    openai: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL),
    model: process.env.OPENAI_MODEL || null,
    github: Boolean(gh),
    branch: gh?.branch ?? null,
  });
}
