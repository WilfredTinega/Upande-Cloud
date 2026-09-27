import { FormEvent, useEffect, useState } from "react";
import { adminApi, GithubConfigSource, GithubSettings, NetworkSettings } from "../lib/api";
import { PageHeader } from "../components/PageHeader";
import { Skeleton } from "../components/Skeleton";

interface AgentTokenRow {
  id: string;
  name: string;
  lastUsedAt: string | null;
  createdAt: string;
}

function AgentTokensSection() {
  const [tokens, setTokens] = useState<AgentTokenRow[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [mcpConfig, setMcpConfig] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    adminApi.listAgentTokens().then(({ tokens: t }) => setTokens(t)).catch(() => {});
  }
  useEffect(load, []);

  async function generate() {
    setBusy(true);
    setErr(null);
    setNewToken(null);
    try {
      const res = await adminApi.createAgentToken(name.trim() || "mcp-agent");
      setNewToken(res.token);
      setName("");
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create token");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    try {
      await adminApi.revokeAgentToken(id);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to revoke");
    }
  }

  async function downloadMcpConfig() {
    setErr(null);
    try {
      const cfg = await adminApi.generateMcpConfig();
      const text = JSON.stringify(cfg, null, 2);
      setMcpConfig(text);
      // Trigger a file download of .mcp.json
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = ".mcp.json";
      a.click();
      URL.revokeObjectURL(url);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to generate config");
    }
  }

  return (
    <div>
      <p className="text-sm text-brand-500 dark:text-brand-400 mb-6">
        Tokens for the MCP agent. They don't expire and are shown only once.
      </p>

      {err && (
        <p className="text-sm text-red-600 dark:text-red-400 mb-3 bg-red-50 dark:bg-red-950/30 rounded px-3 py-2 border border-red-200 dark:border-red-800">
          {err}
        </p>
      )}

      {newToken && (
        <div className="mb-4 p-4 rounded-lg border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20">
          <p className="text-xs font-semibold text-green-800 dark:text-green-300 mb-2">
            New token — copy it now, it will not be shown again.
          </p>
          <code className="block font-mono text-xs bg-white dark:bg-brand-900 border border-green-200 dark:border-green-700 rounded px-3 py-2 text-brand-900 dark:text-brand-100 break-all">
            {newToken}
          </code>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="token name (e.g. mcp-agent)"
          className="flex-1 px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
        />
        <button
          onClick={generate}
          disabled={busy}
          className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
        >
          {busy ? "..." : "Generate token"}
        </button>
        <button
          onClick={downloadMcpConfig}
          className="px-4 py-2 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 text-sm font-medium hover:bg-brand-100 dark:hover:bg-brand-700 transition-colors"
          title="Mints a fresh token and downloads a ready-to-use .mcp.json"
        >
          Download MCP config
        </button>
      </div>

      {tokens.length > 0 && (
        <div className="rounded-lg border border-brand-200 dark:border-brand-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-brand-50 dark:bg-brand-800 border-b border-brand-200 dark:border-brand-700">
                <th className="text-left px-4 py-2 font-medium text-brand-600 dark:text-brand-400">Name</th>
                <th className="text-left px-4 py-2 font-medium text-brand-600 dark:text-brand-400">Last used</th>
                <th className="text-left px-4 py-2 font-medium text-brand-600 dark:text-brand-400"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-100 dark:divide-brand-800">
              {tokens.map((t) => (
                <tr key={t.id} className="bg-white dark:bg-brand-900">
                  <td className="px-4 py-2 text-brand-800 dark:text-brand-200">{t.name}</td>
                  <td className="px-4 py-2 text-brand-500 dark:text-brand-400">
                    {t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : "never"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => revoke(t.id)}
                      className="text-xs px-3 py-1 rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mcpConfig && (
        <div className="mt-4">
          <p className="text-xs text-brand-500 dark:text-brand-400 mb-1">
            Downloaded .mcp.json (also shown here). Place it where your MCP client reads its config.
          </p>
          <pre className="text-xs bg-white dark:bg-brand-900 border border-brand-200 dark:border-brand-700 rounded p-3 overflow-x-auto hide-scrollbar text-brand-800 dark:text-brand-200">
            {mcpConfig}
          </pre>
        </div>
      )}
    </div>
  );
}

function McpConnectionSection() {
  const [agentApiUrl, setAgentApiUrl] = useState("");
  const [agentToken, setAgentToken] = useState("");
  const [agentId, setAgentId] = useState("");
  const [tokenSet, setTokenSet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function load() {
    adminApi
      .getSettings()
      .then((s) => {
        setAgentApiUrl(s.agentApiUrl);
        setTokenSet(s.agentTokenSet);
        setAgentId(s.agentId ?? "");
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load settings"))
      .finally(() => setLoading(false));
  }

  useEffect(load, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      // Only send the token if the operator typed a new one (keeps the existing one otherwise).
      const payload: { agentApiUrl?: string; agentToken?: string; agentId?: string } = {
        agentApiUrl,
        agentId,
      };
      if (agentToken.trim()) payload.agentToken = agentToken.trim();
      const s = await adminApi.updateSettings(payload);
      setTokenSet(s.agentTokenSet);
      setAgentId(s.agentId ?? "");
      setAgentToken("");
      setNotice("Settings saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div role="status" aria-label="Loading">
        <Skeleton className="h-4 w-96 max-w-full mb-6" />
        <div className="rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 p-6 flex flex-col gap-5">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-brand-500 dark:text-brand-400 mb-6">
        How the MCP agent connects to the Upande API. The token is hidden after saving.
      </p>

      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 p-6 flex flex-col gap-5"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="apiUrl" className="text-sm font-medium text-brand-700 dark:text-brand-300">
            Base URL
          </label>
          <input
            id="apiUrl"
            type="url"
            value={agentApiUrl}
            onChange={(e) => setAgentApiUrl(e.target.value)}
            placeholder="http://localhost:4000"
            className="px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="token" className="text-sm font-medium text-brand-700 dark:text-brand-300">
            Agent token{" "}
            <span className="font-normal text-brand-400 dark:text-brand-500">
              {tokenSet ? "(configured — leave blank to keep)" : "(not set)"}
            </span>
          </label>
          <input
            id="token"
            type="password"
            value={agentToken}
            onChange={(e) => setAgentToken(e.target.value)}
            placeholder={tokenSet ? "••••••••••••" : "Paste the agent token"}
            autoComplete="off"
            className="px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="agentId" className="text-sm font-medium text-brand-700 dark:text-brand-300">
            Agent ID
          </label>
          <input
            id="agentId"
            type="text"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            placeholder="ag:..."
            autoComplete="off"
            className="px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors"
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded px-3 py-2 border border-red-200 dark:border-red-800">
            {error}
          </p>
        )}
        {notice && (
          <p className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded px-3 py-2 border border-green-200 dark:border-green-800">
            {notice}
          </p>
        )}

        <div>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : "Save settings"}
          </button>
        </div>
      </form>
    </div>
  );
}

const INPUT_CLASS =
  "px-3 py-2 rounded border border-brand-300 dark:border-brand-600 bg-white dark:bg-brand-800 text-brand-900 dark:text-brand-50 text-sm placeholder-brand-400 dark:placeholder-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500 transition-colors";
const SECONDARY_BTN =
  "px-4 py-2 rounded border border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-300 text-sm font-medium hover:bg-brand-100 dark:hover:bg-brand-700 disabled:opacity-50 transition-colors";

const SOURCE_LABEL: Record<GithubConfigSource, string> = {
  database: "set here",
  environment: "from API environment",
  none: "not set",
};

/** Read-only value with a copy button (for pasting into github.com). */
function CopyField({ id, label, value }: { id: string; label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (e.g. non-secure context) — user can select the text */
    }
  }
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-brand-700 dark:text-brand-300">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          type="text"
          readOnly
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          className={`flex-1 min-w-0 font-mono ${INPUT_CLASS}`}
        />
        <button type="button" onClick={copy} className={SECONDARY_BTN}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function GithubOAuthSection() {
  const [settings, setSettings] = useState<GithubSettings | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [stateSecret, setStateSecret] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  function apply(s: GithubSettings) {
    setSettings(s);
    // Only prefill the id when it's stored here — an env value is shown as a hint.
    setClientId(s.clientIdSource === "database" ? s.clientId : "");
  }

  useEffect(() => {
    adminApi
      .getGithubSettings()
      .then(apply)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load settings"))
      .finally(() => setLoading(false));
  }, []);

  async function save(payload: Parameters<typeof adminApi.updateGithubSettings>[0], msg: string) {
    setError(null);
    setNotice(null);
    setTestResult(null);
    setSaving(true);
    try {
      apply(await adminApi.updateGithubSettings(payload));
      setClientSecret("");
      setStateSecret("");
      setNotice(msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const payload: Parameters<typeof adminApi.updateGithubSettings>[0] = { clientId: clientId.trim() };
    if (clientSecret.trim()) payload.clientSecret = clientSecret.trim();
    if (stateSecret.trim()) payload.stateSecret = stateSecret.trim();
    void save(payload, "GitHub settings saved. Changes apply immediately.");
  }

  function clearStored() {
    void save(
      { clientId: "", clearClientSecret: true, clearStateSecret: true },
      "Stored GitHub settings cleared — falling back to the API environment.",
    );
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await adminApi.testGithubSettings());
    } catch (err) {
      setTestResult({ ok: false, message: err instanceof Error ? err.message : "Test failed" });
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return (
      <div role="status" aria-label="Loading">
        <Skeleton className="h-4 w-96 max-w-full mb-6" />
        <div className="rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 p-6 flex flex-col gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded px-3 py-2 border border-red-200 dark:border-red-800">
        {error ?? "Failed to load settings"}
      </p>
    );
  }

  const hasStored =
    settings.clientIdSource === "database" ||
    settings.clientSecretSource === "database" ||
    settings.stateSecretSource === "database";

  return (
    <div>
      <p className="text-sm text-brand-500 dark:text-brand-400 mb-4">
        The GitHub OAuth App used for "Sign in with GitHub" and for connecting repositories.
        Values saved here override the API environment and take effect immediately.
      </p>

      <div className="mb-6 flex items-center gap-2 text-sm">
        <span
          className={`inline-block h-2 w-2 rounded-full ${settings.configured ? "bg-green-500" : "bg-brand-300 dark:bg-brand-600"}`}
        />
        <span className="font-medium text-brand-800 dark:text-brand-200">
          {settings.configured ? "Configured" : "Not configured"}
        </span>
        {!settings.configured && (
          <span className="text-brand-500 dark:text-brand-400">
            — GitHub buttons are hidden on the dashboard.
          </span>
        )}
      </div>

      <div className="rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 p-6 flex flex-col gap-5 mb-6">
        <div>
          <p className="text-sm font-semibold text-brand-800 dark:text-brand-100">1. Register an OAuth App on GitHub</p>
          <p className="text-sm text-brand-500 dark:text-brand-400 mt-1">
            Open{" "}
            <a
              href="https://github.com/settings/applications/new"
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-brand-700 dark:text-brand-200 hover:text-brand-900 dark:hover:text-brand-50"
            >
              github.com/settings/applications/new
            </a>{" "}
            (or your organization's Settings → Developer settings → OAuth Apps) and enter:
          </p>
        </div>
        <CopyField id="ghHomepage" label="Homepage URL" value={settings.homepageUrl} />
        <CopyField id="ghCallback" label="Authorization callback URL" value={settings.callbackUrl} />
        <p className="text-xs text-brand-400 dark:text-brand-500 -mt-2">
          Then click "Generate a new client secret" and paste the client ID and secret below.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 p-6 flex flex-col gap-5"
      >
        <p className="text-sm font-semibold text-brand-800 dark:text-brand-100">2. Credentials</p>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ghClientId" className="text-sm font-medium text-brand-700 dark:text-brand-300">
            Client ID{" "}
            <span className="font-normal text-brand-400 dark:text-brand-500">
              ({SOURCE_LABEL[settings.clientIdSource]})
            </span>
          </label>
          <input
            id="ghClientId"
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder={settings.clientIdSource === "environment" ? settings.clientId : "Ov23li..."}
            autoComplete="off"
            className={INPUT_CLASS}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ghClientSecret" className="text-sm font-medium text-brand-700 dark:text-brand-300">
            Client secret{" "}
            <span className="font-normal text-brand-400 dark:text-brand-500">
              ({SOURCE_LABEL[settings.clientSecretSource]}
              {settings.clientSecretSet ? " — leave blank to keep" : ""})
            </span>
          </label>
          <input
            id="ghClientSecret"
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={settings.clientSecretSet ? "••••••••••••" : "Paste the client secret"}
            autoComplete="new-password"
            className={INPUT_CLASS}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="ghStateSecret" className="text-sm font-medium text-brand-700 dark:text-brand-300">
            State secret{" "}
            <span className="font-normal text-brand-400 dark:text-brand-500">
              (optional —{" "}
              {settings.stateSecretSource === "none"
                ? "defaults to the JWT secret"
                : `${SOURCE_LABEL[settings.stateSecretSource]}, leave blank to keep`}
              )
            </span>
          </label>
          <input
            id="ghStateSecret"
            type="password"
            value={stateSecret}
            onChange={(e) => setStateSecret(e.target.value)}
            placeholder="Random string used to sign the OAuth state"
            autoComplete="new-password"
            className={INPUT_CLASS}
          />
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded px-3 py-2 border border-red-200 dark:border-red-800">
            {error}
          </p>
        )}
        {notice && (
          <p className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded px-3 py-2 border border-green-200 dark:border-green-800">
            {notice}
          </p>
        )}
        {testResult && (
          <p
            className={`text-sm rounded px-3 py-2 border ${
              testResult.ok
                ? "text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                : "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"
            }`}
          >
            {testResult.message}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : "Save settings"}
          </button>
          <button
            type="button"
            onClick={test}
            disabled={testing || !settings.configured}
            className={SECONDARY_BTN}
            title={settings.configured ? "Check the saved client ID and secret with GitHub" : "Save a client ID and secret first"}
          >
            {testing ? "Testing..." : "Test"}
          </button>
          {hasStored && (
            <button
              type="button"
              onClick={clearStored}
              disabled={saving}
              className="px-4 py-2 rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 transition-colors"
              title="Remove the values stored here and fall back to the API environment"
            >
              Clear stored values
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
// Loose IPv6 check (hex groups and "::"); the API validates strictly.
const IPV6_RE = /^(?=.*:)[0-9a-fA-F:.]{2,45}$/;

function NetworkingSection() {
  const [settings, setSettings] = useState<NetworkSettings | null>(null);
  const [ipv4, setIpv4] = useState("");
  const [ipv6, setIpv6] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [detectNote, setDetectNote] = useState<{ ok: boolean; lines: string[] } | null>(null);

  function apply(s: NetworkSettings) {
    setSettings(s);
    // Prefill only values stored here; env values are shown as hints.
    setIpv4(s.publicIpv4Source === "database" ? s.publicIpv4 : "");
    setIpv6(s.publicIpv6Source === "database" ? s.publicIpv6 : "");
  }

  useEffect(() => {
    adminApi
      .getNetworkSettings()
      .then(apply)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load settings"))
      .finally(() => setLoading(false));
  }, []);

  async function save(payload: { publicIpv4?: string; publicIpv6?: string }, msg: string) {
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      apply(await adminApi.updateNetworkSettings(payload));
      setNotice(msg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const v4 = ipv4.trim();
    const v6 = ipv6.trim();
    if (v4 && !IPV4_RE.test(v4)) {
      setError(`"${v4}" is not a valid IPv4 address.`);
      return;
    }
    if (v6 && !IPV6_RE.test(v6)) {
      setError(`"${v6}" is not a valid IPv6 address.`);
      return;
    }
    void save({ publicIpv4: v4, publicIpv6: v6 }, "Networking settings saved. New custom-domain records use them immediately.");
  }

  function clearStored() {
    void save({ publicIpv4: "", publicIpv6: "" }, "Stored addresses cleared — falling back to PUBLIC_IP from the API environment.");
  }

  async function detect() {
    setDetecting(true);
    setDetectNote(null);
    try {
      const res = await adminApi.detectPublicIp();
      const lines: string[] = [];
      if (res.ipv4) {
        setIpv4(res.ipv4);
        lines.push(`Detected IPv4 ${res.ipv4}.`);
      }
      if (res.ipv6) {
        setIpv6(res.ipv6);
        lines.push(`Detected IPv6 ${res.ipv6}.`);
      }
      lines.push(...res.errors);
      if (res.ipv4 || res.ipv6) lines.push("Review the fields and click Save to use them.");
      setDetectNote({ ok: Boolean(res.ipv4 || res.ipv6), lines });
    } catch (err) {
      setDetectNote({ ok: false, lines: [err instanceof Error ? err.message : "Detection failed"] });
    } finally {
      setDetecting(false);
    }
  }

  if (loading) {
    return (
      <div role="status" aria-label="Loading">
        <Skeleton className="h-4 w-96 max-w-full mb-6" />
        <div className="rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 p-6 flex flex-col gap-5">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded px-3 py-2 border border-red-200 dark:border-red-800">
        {error ?? "Failed to load settings"}
      </p>
    );
  }

  const hasStored = settings.publicIpv4Source === "database" || settings.publicIpv6Source === "database";

  return (
    <div>
      <p className="text-sm text-brand-500 dark:text-brand-400 mb-4">
        The server's public IP address. Custom domains at a zone apex get an A record (AAAA for IPv6) pointing
        here, and the dashboard shows it in the DNS instructions. Values saved here override{" "}
        <code className="font-mono text-xs">PUBLIC_IP</code> from the API environment and take effect immediately.
      </p>

      <div className="mb-6 flex items-center gap-2 text-sm">
        <span
          className={`inline-block h-2 w-2 rounded-full ${settings.effectiveIp ? "bg-green-500" : "bg-brand-300 dark:bg-brand-600"}`}
        />
        <span className="font-medium text-brand-800 dark:text-brand-200">
          {settings.effectiveIp ? (
            <>
              Domains point to <code className="font-mono">{settings.effectiveIp}</code>
            </>
          ) : (
            "Not configured"
          )}
        </span>
        {!settings.effectiveIp && (
          <span className="text-brand-500 dark:text-brand-400">— apex domains can't be set up automatically.</span>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-brand-200 dark:border-brand-700 bg-white dark:bg-brand-900 p-6 flex flex-col gap-5"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="netIpv4" className="text-sm font-medium text-brand-700 dark:text-brand-300">
            Public IPv4{" "}
            <span className="font-normal text-brand-400 dark:text-brand-500">
              ({SOURCE_LABEL[settings.publicIpv4Source]}
              {settings.publicIpv4Source === "environment" ? `: ${settings.publicIpv4}` : ""})
            </span>
          </label>
          <input
            id="netIpv4"
            type="text"
            inputMode="decimal"
            value={ipv4}
            onChange={(e) => setIpv4(e.target.value)}
            placeholder={settings.publicIpv4Source === "environment" ? settings.publicIpv4 : "203.0.113.10"}
            autoComplete="off"
            className={`font-mono ${INPUT_CLASS}`}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="netIpv6" className="text-sm font-medium text-brand-700 dark:text-brand-300">
            Public IPv6{" "}
            <span className="font-normal text-brand-400 dark:text-brand-500">
              (optional — {SOURCE_LABEL[settings.publicIpv6Source]}
              {settings.publicIpv6Source === "environment" ? `: ${settings.publicIpv6}` : ""})
            </span>
          </label>
          <input
            id="netIpv6"
            type="text"
            value={ipv6}
            onChange={(e) => setIpv6(e.target.value)}
            placeholder={settings.publicIpv6Source === "environment" ? settings.publicIpv6 : "2001:db8::10"}
            autoComplete="off"
            className={`font-mono ${INPUT_CLASS}`}
          />
          <p className="text-xs text-brand-400 dark:text-brand-500">
            Used for AAAA records only when no IPv4 address is set.
          </p>
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 rounded px-3 py-2 border border-red-200 dark:border-red-800">
            {error}
          </p>
        )}
        {notice && (
          <p className="text-sm text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded px-3 py-2 border border-green-200 dark:border-green-800">
            {notice}
          </p>
        )}
        {detectNote && (
          <div
            className={`text-sm rounded px-3 py-2 border ${
              detectNote.ok
                ? "text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-800/40 border-brand-200 dark:border-brand-700"
                : "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"
            }`}
          >
            {detectNote.lines.map((l, i) => (
              <p key={i}>{l}</p>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded bg-brand-700 dark:bg-brand-200 text-white dark:text-brand-900 text-sm font-semibold hover:bg-brand-800 dark:hover:bg-brand-100 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : "Save settings"}
          </button>
          <button
            type="button"
            onClick={detect}
            disabled={detecting}
            className={SECONDARY_BTN}
            title="Ask a public IP echo service (ipify.org) which address the API server's traffic comes from"
          >
            {detecting ? "Detecting..." : "Detect"}
          </button>
          {hasStored && (
            <button
              type="button"
              onClick={clearStored}
              disabled={saving}
              className="px-4 py-2 rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 text-sm font-medium hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 transition-colors"
              title="Remove the values stored here and fall back to PUBLIC_IP"
            >
              Clear stored values
            </button>
          )}
        </div>
        <p className="text-xs text-brand-400 dark:text-brand-500 -mt-2">
          Detect asks ipify.org from the API server and only fills the fields. Behind NAT, a proxy or a load
          balancer the detected address may not be the one domains should point at.
        </p>
      </form>
    </div>
  );
}

type SettingsTab = "mcp" | "agent" | "github" | "network";

export function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>("mcp");

  const tabs: { id: SettingsTab; label: string }[] = [
    { id: "mcp", label: "MCP" },
    { id: "agent", label: "Agent" },
    { id: "github", label: "GitHub OAuth" },
    { id: "network", label: "Networking" },
  ];

  return (
    <div>
      <PageHeader title="Settings" />

      <div className="mt-6 border-b border-brand-200 dark:border-brand-700">
        <nav className="flex gap-1 -mb-px">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? "border-brand-700 dark:border-brand-200 text-brand-800 dark:text-brand-100"
                  : "border-transparent text-brand-500 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-6 max-w-xl">
        {tab === "mcp" ? (
          <McpConnectionSection />
        ) : tab === "github" ? (
          <GithubOAuthSection />
        ) : tab === "network" ? (
          <NetworkingSection />
        ) : (
          <AgentTokensSection />
        )}
      </div>
    </div>
  );
}
