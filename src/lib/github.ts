/**
 * Build-time GitHub API client for repository telemetry.
 * All data is resolved at build time on the server; zero runtime client calls.
 */

export interface RepoTelemetry {
  owner: string;
  repo: string;
  url: string;
  stars: number;
  forks: number;
  defaultBranch: string;
  pushedAt: string;
  pushedDateFormatted: string;
  pushedRelative: string;
  description?: string;
  topics: string[];
  latestCommit?: {
    sha: string;
    message: string;
    date: string;
    dateFormatted: string;
    url: string;
  };
}

const telemetryCache = new Map<string, RepoTelemetry | null>();

/**
 * Extracts owner and repo from a GitHub repository URL.
 * Handles formats like:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo/
 * - https://github.com/owner/repo.git
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('github.com')) return null;
    const parts = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, '');
    if (!owner || !repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

function formatRelativeTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (diffMs < 0) return 'recently';
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);

    if (diffDays <= 0) {
      if (diffHours <= 0) return 'just now';
      return `${diffHours}h ago`;
    }
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 30) return `${diffDays}d ago`;
    if (diffMonths < 12) return `${diffMonths}mo ago`;
    return `${diffYears}y ago`;
  } catch {
    return '';
  }
}

/**
 * Fetches repository metadata and latest commit telemetry at build time.
 * Includes strict timeout (3.5s) and in-memory cache to guarantee zero build failures.
 */
export async function getProjectTelemetry(sourceUrl?: string): Promise<RepoTelemetry | null> {
  if (!sourceUrl) return null;

  const repoInfo = parseGitHubUrl(sourceUrl);
  if (!repoInfo) return null;

  const cacheKey = `${repoInfo.owner}/${repoInfo.repo}`.toLowerCase();
  if (telemetryCache.has(cacheKey)) {
    return telemetryCache.get(cacheKey) ?? null;
  }

  const headers: Record<string, string> = {
    'User-Agent': 'Nhovem-Portfolio-Build-Telemetry',
    Accept: 'application/vnd.github+json',
  };

  const token = typeof process !== 'undefined' ? process.env.GITHUB_TOKEN : undefined;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const repoRes = await fetch(
      `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}`,
      {
        headers,
        signal: AbortSignal.timeout(3500),
      }
    );

    if (!repoRes.ok) {
      // 404 or 403 rate limit
      telemetryCache.set(cacheKey, null);
      return null;
    }

    const repoData = await repoRes.json();

    // Fetch latest commit
    let latestCommit: RepoTelemetry['latestCommit'] = undefined;
    try {
      const commitRes = await fetch(
        `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/commits?per_page=1`,
        {
          headers,
          signal: AbortSignal.timeout(3500),
        }
      );

      if (commitRes.ok) {
        const commitData = await commitRes.json();
        if (Array.isArray(commitData) && commitData.length > 0) {
          const first = commitData[0];
          const rawDate = first.commit?.committer?.date || first.commit?.author?.date || '';
          const rawMsg = first.commit?.message || '';
          const firstLine = rawMsg.split('\n')[0].trim();
          latestCommit = {
            sha: (first.sha || '').substring(0, 7),
            message: firstLine.length > 70 ? firstLine.substring(0, 67) + '...' : firstLine,
            date: rawDate,
            dateFormatted: formatDate(rawDate),
            url: first.html_url || `${sourceUrl}/commit/${first.sha}`,
          };
        }
      }
    } catch {
      // Latest commit fetch is optional; continue with repo stats if commit fails
    }

    const pushedAt = repoData.pushed_at || repoData.updated_at || '';
    const telemetry: RepoTelemetry = {
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      url: repoData.html_url || sourceUrl,
      stars: typeof repoData.stargazers_count === 'number' ? repoData.stargazers_count : 0,
      forks: typeof repoData.forks_count === 'number' ? repoData.forks_count : 0,
      defaultBranch: repoData.default_branch || 'main',
      pushedAt,
      pushedDateFormatted: formatDate(pushedAt),
      pushedRelative: formatRelativeTime(pushedAt),
      description: repoData.description || undefined,
      topics: Array.isArray(repoData.topics) ? repoData.topics : [],
      latestCommit,
    };

    telemetryCache.set(cacheKey, telemetry);
    return telemetry;
  } catch (error) {
    // Network timeout or offline build
    telemetryCache.set(cacheKey, null);
    return null;
  }
}
