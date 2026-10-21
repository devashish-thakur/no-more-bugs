// Waivers. The agent can only *request* one; granting needs the user.
//
//   .nomorebugs/local/requests.json   pending requests (local)
//   .nomorebugs/waivers.jsonl         granted and revoked waivers (committed, union-merged)
//
// A waiver covers one target (a scenario ID, a test key, a file or a feature) and optionally
// only some rules. The latest entry for a target wins, so a revocation is just another line.
import { nmbPaths, readJson, writeJson, readJsonl, appendJsonl, nowIso } from './util.mjs';

export function loadWaivers(root) {
  const latest = new Map();
  for (const w of readJsonl(nmbPaths(root).waivers)) {
    if (!w || !w.target) continue;
    const prev = latest.get(w.target);
    if (!prev || String(w.at) >= String(prev.at)) latest.set(w.target, w);
  }
  return [...latest.values()].filter((w) => !w.revoked);
}

export function loadRequests(root) {
  return readJson(nmbPaths(root).requests, []) || [];
}

export function requestWaiver(root, { target, rule = null, reason }) {
  if (!target) throw new Error('Say what to waive: nmb waive <scenario-id | test | file> --reason "..."');
  if (!reason || reason.trim().length < 8) throw new Error('A waiver needs a real reason: --reason "why this gap is acceptable"');
  const requests = loadRequests(root).filter((r) => !(r.target === target && (r.rule || null) === (rule || null)));
  const req = { target, rule: rule || null, reason: reason.trim(), at: nowIso() };
  requests.push(req);
  writeJson(nmbPaths(root).requests, requests);
  return req;
}

export function grantWaiver(root, { target, reason, via, rule = null }) {
  const requests = loadRequests(root);
  const pending = requests.filter((r) => r.target === target);
  const finalReason = (reason && reason.trim()) || pending.map((p) => p.reason).join('; ') || 'granted without a reason';
  const rules = rule ? [rule] : pending.length && pending.every((p) => p.rule) ? [...new Set(pending.map((p) => p.rule))] : null;
  const grant = { target, rules, reason: finalReason, by: 'user', via, at: nowIso() };
  appendJsonl(nmbPaths(root).waivers, grant);
  writeJson(
    nmbPaths(root).requests,
    requests.filter((r) => r.target !== target),
  );
  return grant;
}

export function revokeWaiver(root, { target, via }) {
  appendJsonl(nmbPaths(root).waivers, { target, revoked: true, by: 'user', via, at: nowIso() });
}

export function findWaiver(waivers, finding) {
  return waivers.find((w) => w.target === finding.target && (!w.rules || !w.rules.length || w.rules.includes(finding.rule))) || null;
}

export function findRequest(requests, finding) {
  return requests.find((r) => r.target === finding.target && (!r.rule || r.rule === finding.rule)) || null;
}

// Grants must come from a person. Agents run commands without a terminal attached and
// with recognizable environment variables; refuse in both cases.
export function agentEnvironment() {
  const markers = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED', 'CODEX_THREAD_ID', 'CURSOR_AGENT', 'GEMINI_CLI', 'AIDER_MODEL'];
  return markers.find((m) => process.env[m]) || null;
}
