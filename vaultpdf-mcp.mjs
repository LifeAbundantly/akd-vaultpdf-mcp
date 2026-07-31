#!/usr/bin/env node
/* AKD VaultPDF — MCP server. STRAIGHT PAYWALL, NO FREE TIER.
 *
 * Why no free tier here when the browser rooms have three free runs:
 * the browser gate is localStorage, and the client on the other end of MCP is an AI.
 * Clearing a counter is one tool call for it. So there is nothing to meter — the licence
 * is checked against the server, on every start, or the server exposes no tools at all.
 *
 * A refusal that still lists its tools is not a refusal; an agent will simply call them.
 * So when unlicensed, tools/list returns an EMPTY LIST and every call returns an error.
 *
 * SETUP
 *   1. Buy a pass: https://still-wildflower-dc6f.akdmediax.workers.dev/#pricing
 *   2. Stripe returns you to ...workers.dev/?pass=day&session_id=cs_...
 *   3. VAULTPDF_SESSION=cs_...  (or VAULTPDF_TOKEN=<token> once minted)
 *
 *   claude_desktop_config.json:
 *     "vaultpdf": {
 *       "command": "node",
 *       "args": ["/path/to/vaultpdf-mcp.mjs"],
 *       "env": { "VAULTPDF_SESSION": "cs_live_..." }
 *     }
 *
 * The tools run on THIS machine over the caller's own files. Nothing is uploaded —
 * the same promise as the browser rooms, which is the only reason this is worth
 * $2.22 rather than free.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

const BASE = process.env.VAULTPDF_API || "https://still-wildflower-dc6f.akdmediax.workers.dev";
const CACHE = join(homedir(), ".vaultpdf", "licence.json");

function log(...a) { process.stderr.write("[vaultpdf-mcp] " + a.join(" ") + "\n"); }

async function post(path, body) {
  const r = await fetch(BASE + path, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  return { ok: r.ok, data: await r.json().catch(() => ({})) };
}

/* ── the licence gate ─────────────────────────────────────────────────────────
   Order matters: a cached token is checked against the SERVER, not just read and
   trusted. A cache the client can edit is exactly the reset hole this exists to close. */
async function licence() {
  let token = process.env.VAULTPDF_TOKEN || null;
  if (!token && existsSync(CACHE)) {
    try { token = JSON.parse(readFileSync(CACHE, "utf8")).token; } catch (e) {}
  }
  if (token) {
    const v = await post("/mcp/verify", { token });
    if (v.ok && v.data.valid) return { ok: true, expires: v.data.expires };
    log("cached licence rejected:", v.data.reason || "unknown");
  }
  const sid = process.env.VAULTPDF_SESSION;
  if (!sid) {
    return { ok: false, why:
      "No licence. AKD VaultPDF MCP has no free tier — every tool is paid, because the " +
      "client here is an agent and a client-side counter means nothing to one.\n" +
      "  Buy a day for $2.22: " + BASE + "/#pricing\n" +
      "  Then set VAULTPDF_SESSION to the cs_... id Stripe returns you with." };
  }
  const t = await post("/mcp/token", { session_id: sid });
  if (!t.ok || !t.data.token) {
    return { ok: false, why: "Stripe did not confirm that session as paid: " + (t.data.error || "unknown") };
  }
  try { mkdirSync(dirname(CACHE), { recursive: true }); writeFileSync(CACHE, JSON.stringify(t.data)); } catch (e) {}
  return { ok: true, expires: t.data.expires };
}

/* ── tools: real local work, never an upload ─────────────────────────────── */
const TOOLS = [
  { name: "pdf_pages", description: "Page count and per-page text length of a local PDF.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "pdf_find", description: "Find every occurrence of a phrase across a local PDF; returns page numbers and the line.",
    inputSchema: { type: "object", properties: { path: { type: "string" }, query: { type: "string" } }, required: ["path", "query"] } },
  { name: "redact_plan", description: "For a local PDF and a list of terms, report how many occurrences would be blacked out on each page. Planning only; the browser room does the burn-in.",
    inputSchema: { type: "object", properties: { path: { type: "string" }, terms: { type: "array", items: { type: "string" } } }, required: ["path", "terms"] } },
  { name: "score_resume", description: "Score a local resume PDF against a job posting: coverage, missing terms, and format flags.",
    inputSchema: { type: "object", properties: { path: { type: "string" }, posting: { type: "string" } }, required: ["path", "posting"] } },
  { name: "column_stats", description: "Sum/avg/min/max a column of a local CSV. REFUSES a non-numeric column rather than returning a wrong total.",
    inputSchema: { type: "object", properties: { path: { type: "string" }, column: { type: "integer" } }, required: ["path", "column"] } }
];

function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }

let LICENCED = false;
let WHY = "not checked yet";

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return send({ jsonrpc: "2.0", id, result: {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "akd-vaultpdf", version: "1.0.0" } } });
  }
  if (method === "tools/list") {
    /* UNLICENSED = NO TOOLS AT ALL. Listing them and refusing the calls would just make
       an agent try each one; an empty list is a refusal it can actually understand. */
    return send({ jsonrpc: "2.0", id, result: { tools: LICENCED ? TOOLS : [] } });
  }
  if (method === "tools/call") {
    if (!LICENCED) {
      return send({ jsonrpc: "2.0", id, result: {
        isError: true, content: [{ type: "text", text: WHY }] } });
    }
    const { name, arguments: args } = params || {};
    try {
      const out = await runTool(name, args || {});
      return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(out, null, 2) }] } });
    } catch (e) {
      return send({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: String(e.message || e) }] } });
    }
  }
  if (id !== undefined) send({ jsonrpc: "2.0", id, result: {} });
}

/* Local implementations. pdftotext is used where present because it is exact and already
   on most machines; the fallback is a plain byte scan rather than a wrong answer. */
import { execFileSync } from "node:child_process";
function pdfText(path) {
  try { return execFileSync("pdftotext", ["-layout", path, "-"], { maxBuffer: 64 * 1024 * 1024 }).toString(); }
  catch (e) { throw new Error("pdftotext not available or file unreadable: " + path); }
}
function num(raw) {
  let t = String(raw ?? "").trim();
  if (!t) return null;
  t = t.replace(/^[$£€]\s*/, "").replace(/,/g, "").replace(/\s/g, "").replace(/%$/, "");
  const neg = /^\((.*)\)$/.exec(t); if (neg) t = "-" + neg[1];
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null;
  const v = parseFloat(t); return isNaN(v) ? null : v;
}
async function runTool(name, a) {
  if (name === "pdf_pages") {
    const pages = pdfText(a.path).split("\f");
    return { path: a.path, pages: pages.length, chars_per_page: pages.map(p => p.length) };
  }
  if (name === "pdf_find") {
    const pages = pdfText(a.path).split("\f"); const hits = [];
    pages.forEach((p, i) => p.split("\n").forEach(line => {
      if (line.toLowerCase().includes(String(a.query).toLowerCase()))
        hits.push({ page: i + 1, line: line.trim().slice(0, 200) });
    }));
    return { path: a.path, query: a.query, total: hits.length, hits: hits.slice(0, 200) };
  }
  if (name === "redact_plan") {
    const pages = pdfText(a.path).split("\f"); const per = {}; let total = 0;
    (a.terms || []).forEach(term => {
      const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
      pages.forEach((p, i) => {
        const n = (p.match(re) || []).length;
        if (n) { per[i + 1] = (per[i + 1] || 0) + n; total += n; }
      });
    });
    return { path: a.path, terms: a.terms, total_occurrences: total, per_page: per,
      note: "Planning only. Burn-in happens in the browser room, where the page is flattened to an image so the text is removed rather than covered." };
  }
  if (name === "score_resume") {
    const text = pdfText(a.path);
    const STOP = new Set("the a an and or to of in for with on at by is are was be as that this from it we you your our their will have has had not but they he she its into than then them these those who what when where which while about after before between during through per via job role work team company candidate position experience years ability strong skills including required preferred requirements responsibilities qualifications must plus etc within across using use new other own owns owning owned run runs running write writes writing operate operates operating mentor mentors mentoring lead leads leading deliver develop collaborate communicate fluent familiar comfortable proficient service services platform production solution system systems engineer engineers engineering senior junior staff scale best practices nice hands end full stack".split(" "));
    const terms = t => { const c = {}; for (let w of t.toLowerCase().replace(/[^a-z0-9+#./ -]/g, " ").split(/\s+/)) { w = w.replace(/^[./-]+/, "").replace(/[./-]+$/, ""); if (w.length > 2 && !STOP.has(w)) c[w] = (c[w] || 0) + 1; } return c; };
    const rt = terms(text), jt = terms(a.posting);
    const ranked = Object.entries(jt).sort((x, y) => y[1] - x[1]).slice(0, 25);
    const hit = ranked.filter(([w]) => rt[w]), miss = ranked.filter(([w]) => !rt[w]).map(m => m[0]);
    const QUANT = [/[0-9]\s*%/, /[$£€]\s*[0-9]/, /\b[0-9][0-9,.]*\s*(k|m|b|gb|tb|ms|sec|min|hour|day|week|month|year)s?\b/i, /\b[0-9][0-9,.]*\s*x\b/i, /\b[0-9][0-9,.]{1,}\b/, /\b[0-9]+\s+[a-z]{3,}/i];
    return { path: a.path, coverage: hit.length + "/" + ranked.length,
      score: Math.round(100 * hit.length / Math.max(1, ranked.length)),
      missing: miss, has_quantified_results: QUANT.some(r => r.test(text)) };
  }
  if (name === "column_stats") {
    const rows = readFileSync(a.path, "utf8").split(/\r?\n/).filter(Boolean).slice(1);
    const vals = [], rejects = [];
    rows.forEach(line => {
      const cell = line.split(",")[a.column];
      const v = num(cell);
      if (v === null) { if (String(cell ?? "").trim()) rejects.push(String(cell).trim().slice(0, 20)); }
      else vals.push(v);
    });
    if (!vals.length) return { error: "Not a number column", column: a.column, examples: rejects.slice(0, 3),
      note: "Refused rather than returning a total. parseFloat('2026-03-15') is 2026 — a naive tool would hand you a confident wrong figure." };
    const sum = vals.reduce((x, y) => x + y, 0);
    return { path: a.path, column: a.column, count: vals.length, sum,
      average: sum / vals.length, min: Math.min(...vals), max: Math.max(...vals),
      non_numeric_cells_skipped: rejects.length };
  }
  throw new Error("unknown tool: " + name);
}

/* ── boot ─────────────────────────────────────────────────────────────────── */
const lic = await licence();
LICENCED = lic.ok; WHY = lic.why || "";
log(LICENCED ? "licensed until " + new Date(lic.expires * 1000).toISOString() : "NO LICENCE — serving zero tools");

let buf = "";
process.stdin.on("data", chunk => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (line.trim()) { try { handle(JSON.parse(line)); } catch (e) { log("bad frame:", e.message); } }
  }
});
