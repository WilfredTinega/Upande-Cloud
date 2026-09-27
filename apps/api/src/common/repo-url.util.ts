// Git repository URLs accepted for apps: http(s) only. file:// URLs, bare local
// paths, ssh and git:// are rejected — a local path would let a user "deploy"
// (and so read) files from the platform server itself.
export const REPO_URL_RE = /^https?:\/\/[^\s/?#]+\/[^\s]+$/i;

export const REPO_URL_MESSAGE = 'repoUrl must be an http(s):// git repository URL';

export function isAllowedRepoUrl(url: string | null | undefined): boolean {
  return !!url && REPO_URL_RE.test(url.trim());
}
