import { FormEvent, useEffect, useState } from "react";
import { appsApi, githubApi, githubAuthApi, type GithubRepo } from "../lib/api";
import { FrameworkDetectCard } from "../components/FrameworkDetectCard";
import type { FrameworkDetection } from "../types";
import { useToast } from "../context/ToastContext";
import type { App, AppSource, AppType } from "../types";
import { Select } from "../components/Select";
import { Skeleton } from "../components/Skeleton";

type GitMode = "github" | "url";

// Outline icons (24x24, stroke) for the site-type option cards.
const SITE_TYPE_ICONS: Record<AppType, string> = {
  static: "M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z",
  node: "M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z",
  fullstack: "M6.429 9.75 2.25 12l4.179 2.25m0-4.5 5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L21.75 12l-4.179 2.25m0 0 4.179 2.25L12 21.75 2.25 16.5l4.179-2.25m11.142 0-5.571 3-5.571-3",
  nodered: "M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5",
};

interface CreateAppFormProps {
  // Called with the created app so the host (modal) can navigate / close.
  onCreated: (app: App) => void;
  onCancel: () => void;
}

export function CreateAppForm({ onCreated, onCancel }: CreateAppFormProps) {
  const toast = useToast();

  const [name, setName] = useState("");
  const [type, setType] = useState<AppType>("static");
  const [source, setSource] = useState<AppSource>("git");
  const [gitMode, setGitMode] = useState<GitMode>("github");
  const [repoUrl, setRepoUrl] = useState("");
  // Blank until a branch is fetched/selected — we never assume "main".
  const [branch, setBranch] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Framework detection of the chosen repo/branch (before the first deploy).
  const [detection, setDetection] = useState<FrameworkDetection | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<string | null>(null);
  // The user picked a site type themselves → detection no longer overrides it.
  const [typeTouched, setTypeTouched] = useState(false);

  // Uploaded source folder (Upload source mode). webkitdirectory yields a
  // FileList of every file in the chosen folder, each with webkitRelativePath.
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);

  // GitHub connection state
  const [ghConnected, setGhConnected] = useState(false);
  // GitHub OAuth App set up on this server (admin → Settings → GitHub OAuth,
  // or GITHUB_CLIENT_ID/SECRET). null = still checking.
  const [ghEnabled, setGhEnabled] = useState<boolean | null>(null);
  const [ghLogin, setGhLogin] = useState<string | null>(null);
  const [ghLoading, setGhLoading] = useState(true);
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);
  const [selectedRepo, setSelectedRepo] = useState<GithubRepo | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Branches fetched from GitHub for the selected repo.
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState<string | null>(null);

  // Branches fetched via ls-remote for a pasted Repository URL.
  const [urlBranches, setUrlBranches] = useState<string[]>([]);
  const [urlBranchesLoading, setUrlBranchesLoading] = useState(false);
  const [urlBranchesError, setUrlBranchesError] = useState<string | null>(null);

  // Without a GitHub OAuth App the connect flow can't work — use the URL mode.
  useEffect(() => {
    githubAuthApi
      .config()
      .then(({ enabled }) => {
        setGhEnabled(enabled);
        if (!enabled) setGitMode("url");
      })
      .catch(() => setGhEnabled(true));
  }, []);

  // Check GitHub connection status on mount.
  useEffect(() => {
    githubApi
      .status()
      .then((s) => {
        setGhConnected(s.connected);
        setGhLogin(s.login ?? null);
      })
      .catch(() => setGhConnected(false))
      .finally(() => setGhLoading(false));
  }, []);

  // Load repos once connected and on GitHub mode.
  useEffect(() => {
    if (!ghConnected || source !== "git" || gitMode !== "github") return;
    setReposLoading(true);
    setReposError(null);
    githubApi
      .listRepos()
      .then(({ repos: list }) => setRepos(list))
      .catch((err: unknown) =>
        setReposError(err instanceof Error ? err.message : "Failed to load repos"),
      )
      .finally(() => setReposLoading(false));
  }, [ghConnected, source, gitMode]);

  async function handleConnectGithub() {
    setConnecting(true);
    try {
      const { url } = await githubApi.authorize();
      // Full-page redirect to GitHub consent; GitHub redirects back to the API
      // callback, which redirects here with ?github=connected.
      window.location.href = url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to start GitHub connect");
      setConnecting(false);
    }
  }

  async function fetchUrlBranches(url: string) {
    setUrlBranchesLoading(true);
    setUrlBranchesError(null);
    try {
      const { branches: list } = await githubApi.listRemoteBranches(url);
      setUrlBranches(list);
      if (list.length === 0) {
        setUrlBranchesError("No branches found");
        return;
      }
      // Preselect default-ish branch (or keep current if still valid).
      setBranch((prev) => (list.includes(prev) ? prev : list[0]));
    } catch (err) {
      setUrlBranches([]);
      setUrlBranchesError(err instanceof Error ? err.message : "Failed to fetch branches");
    } finally {
      setUrlBranchesLoading(false);
    }
  }

  // Auto-fetch branches shortly after the user finishes typing a repo URL, so
  // they don't have to click anything. Debounced to avoid a request on every
  // keystroke.
  useEffect(() => {
    if (source !== "git" || gitMode !== "url") return;
    const url = repoUrl.trim();
    // Only fire for plausible git URLs (http(s):// or git@…), else wait.
    if (!/^(https?:\/\/|git@).+/.test(url)) return;
    const handle = setTimeout(() => {
      void fetchUrlBranches(url);
    }, 600);
    return () => clearTimeout(handle);
    // fetchUrlBranches is stable enough for this debounce; depend on the inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoUrl, source, gitMode]);

  // Detect the framework once a repo + branch is chosen (debounced).
  const detectUrl =
    source !== "git" || type === "nodered"
      ? ""
      : gitMode === "github"
        ? (selectedRepo?.htmlUrl ?? "")
        : /^https?:\/\/.+/.test(repoUrl.trim())
          ? repoUrl.trim()
          : "";
  useEffect(() => {
    setDetection(null);
    setDetectError(null);
    if (!detectUrl || !branch) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      setDetecting(true);
      appsApi
        .detectFramework(detectUrl, branch)
        .then(({ detection: d }) => {
          if (cancelled) return;
          setDetection(d);
          if (!typeTouched) setType(d.type);
        })
        .catch((err: unknown) => {
          if (!cancelled) setDetectError(err instanceof Error ? err.message : "Couldn't detect the framework");
        })
        .finally(() => !cancelled && setDetecting(false));
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
    // typeTouched is read at resolve time only; re-detect on source changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectUrl, branch]);

  function handleSelectRepo(repo: GithubRepo) {
    setSelectedRepo(repo);
    if (!name) setName(repo.name);
    setBranch(repo.defaultBranch || "main");
  }

  // Fetch the selected repo's branches so the user can pick which one to deploy.
  useEffect(() => {
    if (!selectedRepo || gitMode !== "github") {
      setBranches([]);
      return;
    }
    let cancelled = false;
    setBranchesLoading(true);
    setBranchesError(null);
    githubApi
      .listBranches(selectedRepo.fullName)
      .then(({ branches: list, defaultBranch }) => {
        if (cancelled) return;
        setBranches(list);
        // Preselect the default branch (or keep current if still valid).
        setBranch((prev) => (list.includes(prev) ? prev : defaultBranch || list[0] || "main"));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setBranches([]);
        setBranchesError(err instanceof Error ? err.message : "Failed to load branches");
      })
      .finally(() => {
        if (!cancelled) setBranchesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRepo, gitMode]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const appType = type;
      let payload: Parameters<typeof appsApi.create>[0];
      if (appType === "nodered") {
        // Node-RED has no source repo — it runs the official image. Source is
        // irrelevant, but the API expects a valid value, so send "git".
        payload = { name, source: "git", type: appType };
      } else if (source === "upload") {
        if (uploadFiles.length === 0) {
          throw new Error("Choose a folder to upload");
        }
        payload = { name, source, type: appType };
      } else if (gitMode === "github") {
        if (!selectedRepo) {
          throw new Error("Select a GitHub repository");
        }
        const repoGit = `${selectedRepo.htmlUrl}.git`;
        const repoBranch = branch || selectedRepo.defaultBranch || "main";
        payload = {
          name,
          source: "git",
          type: appType,
          repoUrl: repoGit,
          branch: repoBranch,
          githubRepoFullName: selectedRepo.fullName,
        };
      } else {
        payload = {
          name,
          source: "git",
          type: appType,
          repoUrl: repoUrl || undefined,
          branch: branch || undefined,
        };
      }
      // Detected output dir (the platform default is dist) for static builds.
      if (
        detection &&
        source === "git" &&
        appType === "static" &&
        detection.type === "static" &&
        detection.outputDir &&
        detection.outputDir !== "dist"
      ) {
        payload = { ...payload, outputDir: detection.outputDir };
      }
      const { app, noderedAdminPassword } = await appsApi.create(payload);

      // For uploads, push the chosen folder right after creating the app. The
      // code builds on the first manual Deploy from the app's detail page.
      if (source === "upload" && appType !== "nodered") {
        const { files } = await appsApi.uploadSource(app.id, uploadFiles);
        toast.success(`App "${app.name}" created — ${files} files uploaded. Deploy when ready.`);
      } else if (appType === "nodered" && noderedAdminPassword) {
        // Show the one-time seeded admin password — it is only stored hashed and
        // cannot be recovered. The user can add more accounts from the app page.
        toast.success(
          `Node-RED app "${app.name}" created. Admin login — user: admin, password: ${noderedAdminPassword} (save this; it won't be shown again). Deploy to install.`,
        );
      } else {
        toast.success(`App "${app.name}" created.`);
      }
      onCreated(app);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create app");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:focus:ring-brand-400 transition-colors";

  return (
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="text-sm font-medium text-brand-700 dark:text-brand-300">
              App name <span className="text-red-500">*</span>
            </label>
            <input
              id="name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="my-app"
            />
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-brand-700 dark:text-brand-300">Site type</span>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  { value: "static", label: "Static" },
                  { value: "node", label: "Dynamic" },
                  { value: "fullstack", label: "Full stack" },
                  { value: "nodered", label: "Node-RED" },
                ] as const
              ).map((opt) => {
                const selected = type === opt.value;
                return (
                  <label
                    key={opt.value}
                    className={[
                      "relative flex items-center gap-3 rounded-xl border p-3 cursor-pointer transition-all",
                      "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-lime-500/60",
                      selected
                        ? "border-lime-500 dark:border-lime-400 bg-lime-50 dark:bg-lime-400/10 shadow-sm"
                        : "border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 hover:border-brand-300 dark:hover:border-brand-600 hover:shadow-sm",
                    ].join(" ")}
                  >
                    <input
                      type="radio"
                      name="type"
                      value={opt.value}
                      checked={selected}
                      onChange={() => {
                        setType(opt.value);
                        setTypeTouched(true);
                      }}
                      className="sr-only"
                    />
                    <span
                      className={[
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors",
                        selected
                          ? "bg-lime-500 text-white dark:bg-lime-400 dark:text-brand-900"
                          : "bg-brand-100 text-brand-500 dark:bg-brand-800 dark:text-brand-400",
                      ].join(" ")}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="h-5 w-5"
                        aria-hidden="true"
                      >
                        <path d={SITE_TYPE_ICONS[opt.value]} />
                      </svg>
                    </span>
                    <span
                      className={[
                        "text-sm font-medium",
                        selected
                          ? "text-brand-900 dark:text-brand-50"
                          : "text-brand-700 dark:text-brand-200",
                      ].join(" ")}
                    >
                      {opt.label}
                    </span>
                    {selected && (
                      <svg
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="absolute right-3 h-5 w-5 text-lime-500 dark:text-lime-400"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </label>
                );
              })}
            </div>
          </div>

          {type === "nodered" && (
            <div className="rounded-lg border border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-800 p-4">
              <p className="text-sm text-brand-600 dark:text-brand-300">
                Node-RED has no source to configure — it runs the official image. On create, a
                default <span className="font-medium">admin</span> editor account is generated
                and its password shown once. After it installs, manage editor accounts (add more
                users, set read-only access, change passwords) from the app page.
              </p>
            </div>
          )}

          {type !== "nodered" && (
          <>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-brand-700 dark:text-brand-300">Source</span>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-brand-100 dark:bg-brand-800 p-1">
              {(
                [
                  { value: "git", label: "Git repository" },
                  { value: "upload", label: "Upload" },
                ] as const
              ).map((opt) => (
                <label
                  key={opt.value}
                  className={[
                    "flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium cursor-pointer transition-all",
                    "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-lime-500/60",
                    source === opt.value
                      ? "bg-white dark:bg-brand-900 text-lime-600 dark:text-lime-400 ring-1 ring-lime-500 dark:ring-lime-400 shadow-sm"
                      : "text-brand-600 dark:text-brand-400 hover:text-brand-800 dark:hover:text-brand-200",
                  ].join(" ")}
                >
                  <input
                    type="radio"
                    name="source"
                    value={opt.value}
                    checked={source === opt.value}
                    onChange={() => setSource(opt.value)}
                    className="sr-only"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {source === "git" && (
            <>
              {/* Git mode toggle: connect GitHub vs paste URL */}
              <div className="flex gap-2 p-1 rounded-lg bg-brand-100 dark:bg-brand-800 w-fit">
                <button
                  type="button"
                  onClick={() => setGitMode("github")}
                  className={[
                    "px-3 py-1.5 rounded text-xs font-medium transition-colors",
                    gitMode === "github"
                      ? "bg-white dark:bg-brand-900 text-lime-600 dark:text-lime-400 ring-1 ring-lime-500 dark:ring-lime-400 shadow-sm"
                      : "text-brand-600 dark:text-brand-400",
                  ].join(" ")}
                >
                  Connect GitHub
                </button>
                <button
                  type="button"
                  onClick={() => setGitMode("url")}
                  className={[
                    "px-3 py-1.5 rounded text-xs font-medium transition-colors",
                    gitMode === "url"
                      ? "bg-white dark:bg-brand-900 text-lime-600 dark:text-lime-400 ring-1 ring-lime-500 dark:ring-lime-400 shadow-sm"
                      : "text-brand-600 dark:text-brand-400",
                  ].join(" ")}
                >
                  Repository URL
                </button>
              </div>

              {gitMode === "github" && (
                <div className="flex flex-col gap-3">
                  {ghLoading ? (
                    <div role="status" aria-label="Checking GitHub connection" className="flex flex-col gap-3">
                      <Skeleton className="h-4 w-48" />
                      <div className="grid gap-4 sm:grid-cols-[7fr_3fr]">
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                      </div>
                    </div>
                  ) : !ghConnected && ghEnabled === false ? (
                    <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 flex flex-col items-start gap-3">
                      <p className="text-sm text-amber-800 dark:text-amber-300">
                        GitHub isn&apos;t set up on this server yet.
                      </p>
                      <button
                        type="button"
                        onClick={() => setGitMode("url")}
                        className="px-4 py-2 rounded bg-brand-800 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-900 dark:hover:bg-brand-100 transition-colors"
                      >
                        Use repository URL
                      </button>
                    </div>
                  ) : !ghConnected ? (
                    <div className="rounded-lg border border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-800 p-4 flex flex-col items-start gap-3">
                      <p className="text-sm text-brand-600 dark:text-brand-300">
                        Connect your GitHub account to pick a repository and enable
                        push-to-deploy.
                      </p>
                      <button
                        type="button"
                        onClick={handleConnectGithub}
                        disabled={connecting}
                        className="px-4 py-2 rounded bg-brand-800 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-900 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
                      >
                        {connecting ? "Redirecting..." : "Connect GitHub"}
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-brand-600 dark:text-brand-400">
                          Connected as{" "}
                          <span className="font-semibold text-brand-800 dark:text-brand-200">
                            {ghLogin}
                          </span>
                        </span>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-[7fr_3fr]">
                        <div className="flex flex-col gap-1.5">
                          <label
                            htmlFor="repo"
                            className="text-sm font-medium text-brand-700 dark:text-brand-300"
                          >
                            Repository <span className="text-red-500">*</span>
                          </label>
                          {reposLoading ? (
                            <Skeleton className="h-10 w-full" />
                          ) : reposError ? (
                            <p className="text-sm text-red-600 dark:text-red-400">{reposError}</p>
                          ) : (
                            <Select
                              id="repo"
                              value={selectedRepo?.id ?? ""}
                              onChange={(e) => {
                                const repo = repos.find((r) => String(r.id) === e.target.value);
                                if (repo) handleSelectRepo(repo);
                              }}
                              className={inputClass}
                            >
                              <option value="" disabled>
                                Select a repository
                              </option>
                              {repos.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.fullName}
                                  {r.private ? " (private)" : ""}
                                </option>
                              ))}
                            </Select>
                          )}
                        </div>

                        {selectedRepo && (
                          <div className="flex flex-col gap-1.5">
                            <label
                              htmlFor="gh-branch"
                              className="text-sm font-medium text-brand-700 dark:text-brand-300"
                            >
                              Branch
                            </label>
                            {branchesLoading ? (
                              <Skeleton className="h-10 w-full" />
                            ) : branchesError ? (
                              <p className="text-sm text-red-600 dark:text-red-400">
                                {branchesError}
                              </p>
                            ) : (
                              <Select
                                id="gh-branch"
                                value={branch}
                                onChange={(e) => setBranch(e.target.value)}
                                className={inputClass}
                              >
                                {branches.map((b) => (
                                  <option key={b} value={b}>
                                    {b}
                                    {b === selectedRepo.defaultBranch ? " (default)" : ""}
                                  </option>
                                ))}
                              </Select>
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {gitMode === "url" && (
                <div className="grid gap-4 sm:grid-cols-[7fr_3fr]">
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="repoUrl"
                      className="text-sm font-medium text-brand-700 dark:text-brand-300"
                    >
                      Repository URL
                    </label>
                    <input
                      id="repoUrl"
                      type="url"
                      value={repoUrl}
                      onChange={(e) => {
                        setRepoUrl(e.target.value);
                        // URL changed — fetched branches no longer apply. Branches
                        // are auto-fetched (debounced) by the effect above.
                        setUrlBranches([]);
                        setUrlBranchesError(null);
                        setBranch("");
                      }}
                      className={inputClass}
                      placeholder="https://github.com/org/repo"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="branch"
                      className="text-sm font-medium text-brand-700 dark:text-brand-300"
                    >
                      Branch
                    </label>
                    {urlBranches.length > 0 ? (
                      <Select
                        id="branch"
                        value={branch}
                        onChange={(e) => setBranch(e.target.value)}
                        className={inputClass}
                      >
                        {urlBranches.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <input
                        id="branch"
                        type="text"
                        value={branch}
                        onChange={(e) => setBranch(e.target.value)}
                        className={inputClass}
                        placeholder={
                          urlBranchesLoading
                            ? "Fetching branches…"
                            : "Enter a repo URL to load branches"
                        }
                      />
                    )}
                    {urlBranchesError && (
                      <p className="text-sm text-red-600 dark:text-red-400">{urlBranchesError}</p>
                    )}
                  </div>
                </div>
              )}
              <FrameworkDetectCard
                detection={detection}
                loading={detecting}
                error={detectError}
                onApply={detection && type !== detection.type ? () => setType(detection.type) : undefined}
                applyLabel="Use suggested type"
              />
            </>
          )}

          {source === "upload" && (
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="folder"
                className="text-sm font-medium text-brand-700 dark:text-brand-300"
              >
                Code folder <span className="text-red-500">*</span>
              </label>
              <input
                id="folder"
                type="file"
                // Folder picker: all files in the chosen directory are uploaded.
                {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                multiple
                onChange={(e) => setUploadFiles(Array.from(e.target.files ?? []))}
                className="text-sm text-brand-700 dark:text-brand-300 file:mr-3 file:rounded file:border-0 file:bg-brand-700 dark:file:bg-brand-200 file:text-white dark:file:text-brand-900 file:px-3 file:py-1.5 file:text-sm file:font-medium file:cursor-pointer hover:file:bg-brand-800 dark:hover:file:bg-brand-100"
              />
              {uploadFiles.length > 0 && (
                <p className="text-xs text-lime-600 dark:text-lime-400">
                  {uploadFiles.length} file{uploadFiles.length === 1 ? "" : "s"} selected
                </p>
              )}
            </div>
          )}
          </>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? "Creating..." : "Create app"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 text-sm font-medium hover:bg-brand-50 dark:hover:bg-brand-800 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
  );
}
