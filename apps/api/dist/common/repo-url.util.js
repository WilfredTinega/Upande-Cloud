"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REPO_URL_MESSAGE = exports.REPO_URL_RE = void 0;
exports.isAllowedRepoUrl = isAllowedRepoUrl;
exports.REPO_URL_RE = /^https?:\/\/[^\s/?#]+\/[^\s]+$/i;
exports.REPO_URL_MESSAGE = 'repoUrl must be an http(s):// git repository URL';
function isAllowedRepoUrl(url) {
    return !!url && exports.REPO_URL_RE.test(url.trim());
}
//# sourceMappingURL=repo-url.util.js.map