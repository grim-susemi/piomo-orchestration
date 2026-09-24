#!/usr/bin/env node
// PR·업그레이드·커스텀·업데이트패치 반복점검 — 외부 점검·설치된 소프트웨어는 읽기 전용. 스냅샷 파일은 클론 로컬 .omo/evidence/pr-watch에 기록.
// usage: node scripts/pr-watch.mjs [--json] [--upgrade]
//   (기본) PR 6건 + ENV 버전 + CUSTOM 보존 diff 보고.
//   --upgrade: 업데이트 패치 과정 점검 추가 (아래 6단계). 여전히 읽기 전용 — 설치·수정 실행 없음.
// output: .omo/evidence/pr-watch/<YYYY-MM-DD-HHMM>.json + 이전 회차와의 diff 요약(stdout)
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Curated clone: workspace root resolves to the clone root (this file is <clone-root>/scripts/pr-watch.mjs).
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Home-anchored live-host paths resolve at runtime; no as-installed personal absolute path is published.
const HOME = homedir();
const EVDIR = join(ROOT, ".omo/evidence/pr-watch");
mkdirSync(EVDIR, { recursive: true });

const PRS = [
  ["code-yeongyu/senpi", 899], ["code-yeongyu/senpi", 912],
  ["code-yeongyu/senpi", 913], ["code-yeongyu/senpi", 927],
  ["code-yeongyu/oh-my-openagent", 6740],
  ["code-yeongyu/oh-my-openagent", 7268],
];

function gh(args) {
  try {
    return execFileSync("gh", args, { encoding: "utf8", timeout: 30000 }).trim();
  } catch (e) { return "ERR:" + String((e && e.message) || e).slice(0, 150); }
}
function sh(cmd, args) {
  try {
    return { out: execFileSync(cmd, args, { encoding: "utf8", timeout: 30000 }).trim() };
  } catch (e) { return { err: String((e && e.message) || e).slice(0, 150) }; }
}

const snap = { at: new Date().toISOString(), prs: [], env: {}, custom: {}, upgrade: null };
const WANT_UPGRADE = process.argv.includes("--upgrade");
const files = readdirSync(EVDIR).filter((f) => f.endsWith(".json")).sort();
let prev = null;
if (files.length) {
  try { prev = JSON.parse(readFileSync(join(EVDIR, files[files.length - 1]), "utf8")); } catch { prev = null; }
}
const prevPrs = Object.fromEntries((prev?.prs || []).map((r) => [r.pr, r]));
const isDefiniteMergeable = (value) => value && value !== "UNKNOWN";
const lastDefiniteMergeable = (row) => isDefiniteMergeable(row?.lastDefiniteMergeable)
  ? row.lastDefiniteMergeable : (isDefiniteMergeable(row?.mergeable) ? row.mergeable : null);
const historicalDefiniteMergeables = {};
for (const file of files.slice().reverse()) {
  try {
    for (const row of JSON.parse(readFileSync(join(EVDIR, file), "utf8")).prs || []) {
      if (!historicalDefiniteMergeables[row.pr]) {
        const mergeable = lastDefiniteMergeable(row);
        if (mergeable) historicalDefiniteMergeables[row.pr] = mergeable;
      }
    }
  } catch { /* ignore unreadable historical snapshots */ }
}
const inheritedLastDefiniteMergeable = (pr, row) => lastDefiniteMergeable(row) || historicalDefiniteMergeables[pr] || null;

// 1. PR states
for (const [repo, num] of PRS) {
  const pr = repo + "#" + num;
  const prior = prevPrs[pr];
  let j = null;
  const raw = gh(["pr", "view", String(num), "--repo", repo, "--json",
    "number,state,mergeable,mergeStateStatus,updatedAt,reviewDecision,headRefOid"]);
  try { j = JSON.parse(raw); }
  catch {
    snap.prs.push({ pr, error: raw.slice(0, 120), lastDefiniteMergeable: inheritedLastDefiniteMergeable(pr, prior) });
    continue;
  }
  const mergeable = j.mergeable || "UNKNOWN";
  snap.prs.push({
    pr, state: j.state, mergeable, lastDefiniteMergeable: isDefiniteMergeable(mergeable)
      ? mergeable : inheritedLastDefiniteMergeable(pr, prior), head: j.headRefOid || "",
    mergeState: j.mergeStateStatus, updated: (j.updatedAt || "").slice(0, 10),
    review: j.reviewDecision || "NONE",
  });
}
// 2. maintainer-human comments on the 5 owner PRs (skip bots: sisyphus-bot)
// #7268 is other-author observation-only, excluded from maintainer sweep.
for (const row of snap.prs.slice(0, 5)) {
  if (row.error) continue;
  const [repo, num] = row.pr.split("#");
  const raw = gh(["api", `repos/${repo}/issues/${num}/comments?per_page=30`]);
  let arr = [];
  try { arr = JSON.parse(raw); } catch { row.lastMaint = "QUERY-FAIL"; continue; }
  const humans = arr.filter((c) => {
    const l = (c.user && c.user.login) || "";
    return l !== "grim-susemi" && !/sisyphus-bot/i.test(l) && !/bot$/i.test(l);
  });
  const last = humans[humans.length - 1];
  row.lastMaint = last
    ? `${last.user.login} ${(last.created_at || "").slice(0, 10)}: ${String(last.body || "").slice(0, 180).replace(/\n/g, " | ")}`
    : "none";
}
// 3. local env
const OMO = join(HOME, ".local/bin/omo.cmd");
const runOmo = (args) => sh("cmd.exe", ["/c", OMO, ...args]);
const v = runOmo(["--version"]);
snap.env.version = (v.out || v.err || "").slice(0, 120);
const h = runOmo(["--help"]);
snap.env.helpLen = (h.out || "").length;
const u = runOmo(["ulw-loop", "status", "--json"]);
snap.env.ulwOk = (u.out || "").includes('"ok": true');
// 4. custom guard: MED sha12 + directive marker + floor
const crypto = await import("node:crypto");
const sha12 = (p) => {
  try { return crypto.createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 12); }
  catch { return "MISSING"; }
};
function parseJsonc(text) {
  let withoutComments = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inString) {
      withoutComments += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; withoutComments += c; continue; }
    if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      withoutComments += "\n";
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 1;
      continue;
    }
    withoutComments += c;
  }
  let json = "";
  inString = false;
  escaped = false;
  for (let i = 0; i < withoutComments.length; i += 1) {
    const c = withoutComments[i];
    if (inString) {
      json += c;
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; json += c; continue; }
    if (c === ",") {
      let next = i + 1;
      while (/\s/.test(withoutComments[next] || "")) next += 1;
      if (withoutComments[next] === "}" || withoutComments[next] === "]") continue;
    }
    json += c;
  }
  return JSON.parse(json);
}
function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalJson(value[key])]));
  return value;
}
const semanticJsoncHash = (p) => {
  try {
    const parsed = parseJsonc(readFileSync(p, "utf8"));
    return crypto.createHash("sha256").update(JSON.stringify(canonicalJson(parsed))).digest("hex").slice(0, 12);
  } catch { return "PARSE-ERR"; }
};
const G = join(HOME, "AppData/Roaming/npm/node_modules/omo-ai");
snap.custom.med = {
  "omo.jsonc": sha12(join(HOME, ".omo/omo.jsonc")),
  "models.json": sha12(join(HOME, ".omo/agent/models.json")),
  "omo-model-tuning.ts": sha12(join(HOME, ".omo/agent/extensions/omo-model-tuning.ts")),
};
snap.custom.omoSettings = semanticJsoncHash(join(HOME, ".omo/omo.jsonc"));
snap.custom.canonical = {
  "omo.jsonc": semanticJsoncHash(join(HOME, ".omo/omo.jsonc")),
};
try {
  snap.custom.directiveTopo = readFileSync(G + "/plugin/runtime/agent-toolkit/directive.md", "utf8").includes("MUST declare TOPOLOGY");
} catch { snap.custom.directiveTopo = "READ-ERR"; }
try {
  const t = readFileSync(G + "/node_modules/@code-yeongyu/senpi/node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js", "utf8");
  const m = t.match(/claudeCodeVersion\s*=\s*["']([\d.]+)["']/);
  snap.custom.floor = m ? m[1] : "NOT-FOUND";
} catch { snap.custom.floor = "READ-ERR"; }

// 5. diff vs previous snapshot (report only what changed)
const stamp = snap.at.slice(0, 16).replace(/[-:T]/g, "");
snap.status = { exit: 0, status: "ok" };
const changes = [];
if (prev) {
  for (const r of snap.prs) {
    const p = prevPrs[r.pr];
    if (r.error) {
      if (!p || !p.error) changes.push(`QUERY ${r.pr}: ${r.error}`);
      continue;
    }
    if (!p) { changes.push(`NEW ${r.pr} ${r.state}`); continue; }
    if (p.error) { changes.push(`QUERY ${r.pr}: recovered`); continue; }
    const bits = [];
    if (p.state !== r.state) bits.push(`${p.state}→${r.state}`);
    // UNKNOWN is deferred: retain the last definite value but emit no rebuild-relevant change until GitHub returns a definite value.
    const priorMergeable = inheritedLastDefiniteMergeable(r.pr, p);
    if (isDefiniteMergeable(r.mergeable) && priorMergeable && priorMergeable !== r.mergeable) bits.push(`merge:${priorMergeable}→${r.mergeable}`);
    if ((p.review || "") !== (r.review || "")) bits.push(`review:${p.review}→${r.review}`);
    if ((p.head || "") !== (r.head || "") && p.head && r.head) bits.push(`head:${String(p.head).slice(0,8)}→${String(r.head).slice(0,8)}`);
    if ((p.lastMaint || "") !== (r.lastMaint || "")) bits.push(`comment:[${r.lastMaint}]`);
    if (bits.length) changes.push(`${r.pr}: ${bits.join(" / ")}`);
  }
  if ((prev.env && prev.env.version) !== snap.env.version) changes.push(`ENV version: ${prev.env && prev.env.version} → ${snap.env.version}`);
  const pcm = (prev.custom && prev.custom.med) || {};
  for (const [k, val] of Object.entries(snap.custom.med)) {
    if (pcm[k] && pcm[k] !== val) {
      changes.push(k === "omo.jsonc"
        ? `CUSTOM ${k}: ${pcm[k]}→${val} (changed)`
        : `CUSTOM ${k}: ${pcm[k]}→${val} (깨짐 의심)`);
    }
  }
  if (prev.custom?.omoSettings && prev.custom.omoSettings !== snap.custom.omoSettings) {
    changes.push(`CUSTOM omo.jsonc settings: ${prev.custom.omoSettings}→${snap.custom.omoSettings} (깨짐 의심)`);
  }
  if (prev.custom && prev.custom.directiveTopo !== snap.custom.directiveTopo) changes.push(`CUSTOM directive TOPOLOGY: ${prev.custom.directiveTopo}→${snap.custom.directiveTopo}`);
  if (prev.custom && prev.custom.floor !== snap.custom.floor) changes.push(`CUSTOM floor: ${prev.custom.floor}→${snap.custom.floor}`);
} else {
  changes.push("(첫 회차 — 기준 스냅샷 저장)");
}

// 6. 업데이트 패치 과정 점검 (--upgrade; 읽기 전용)
// 목적: 새 beta가 나오면 올리기 전에 준비 상태를 한 번에 보여준다.
// 단계: (a) registry beta vs 로컬 버전 밀림 확인 (b) 새 beta tarball diff 요약
// (c) 커스텀 4종 충돌 위험 판정 (d) pre 백업 존재 확인 (e) 올리기 실행 조건 판정.
// 여전히 읽기 전용 — 설치·수정·백업 실행 없음. 올리기는 별도 승인 후 수행.
if (WANT_UPGRADE) {
  const up = { registry: {}, local: {}, guard: {} };
  try {
    const { execFileSync: ex } = await import("node:child_process");
    const tags = JSON.parse(ex("cmd.exe /c npm view omo-ai dist-tags --json", { encoding: "utf8", timeout: 60000, shell: true }));
    up.registry.beta = tags.beta || "UNKNOWN";
  } catch { up.registry.beta = "QUERY-FAIL"; }
  up.local.version = snap.env.version;
  up.local.behind = (up.registry.beta !== "UNKNOWN" && !snap.env.version.includes(up.registry.beta))
    ? `밀림 (${snap.env.version} vs beta ${up.registry.beta})` : "최신";
  // 가드 재료: pre 백업 존재 + MED 기준 + directive/floor 현행
  const UPEV = join(ROOT, ".omo/evidence");
  let preDirs = [];
  try { preDirs = readdirSync(UPEV).filter((d) => d.endsWith("-upgrade")); } catch { preDirs = []; }
  up.guard.preBackup = {};
  for (const d of preDirs) {
    const mp = join(UPEV, d, "pre/manifest.json");
    if (!existsSync(mp)) { up.guard.preBackup[d] = "no-manifest"; continue; }
    try {
      const m = JSON.parse(readFileSync(mp, "utf8"));
      up.guard.preBackup[d] = `target=${m.targetVersion || "?"} files=${(m.entries || []).length}`;
    } catch { up.guard.preBackup[d] = "manifest-unreadable"; }
  }
  up.guard.preReadyForBeta = preDirs.some((d) => {
    try { return JSON.parse(readFileSync(join(UPEV, d, "pre/manifest.json"), "utf8")).targetVersion === up.registry.beta; }
    catch { return false; }
  });
  up.guard.med = snap.custom.med;
  up.guard.directiveTopo = snap.custom.directiveTopo;
  up.guard.floor = snap.custom.floor;
  up.guard.shimDelegation = (() => {
    try {
      const s = readFileSync(OMO, "utf8");
      return s.includes("AppData\\Roaming\\npm\\omo.cmd") || s.includes("AppData/Roaming/npm/omo.cmd");
    } catch { return "READ-ERR"; }
  })();
  snap.upgrade = up;
  changes.push(`UPGRADE registry beta=${up.registry.beta} / local=[${up.local.version}] → ${up.local.behind}`);
  // 커스텀 4종 충돌 위험 판정 (읽기 전용): beta49 overlay 실측 기준 — directive.md는
  // tarball마다 바뀌므로 재적용 대상, models.json/AGENTS.md/조율파일은 덮어쓰기 감시 대상.
  const bumpMinor = /beta\.4[89]/.test(up.registry.beta || "") || /beta\.49/.test(snap.env.version || "");
  if (bumpMinor && up.guard.directiveTopo !== true) changes.push("UPGRADE directive TOPOLOGY 소멸 — beta49 베이스에 2줄 재적용 필요");
  else if (up.guard.directiveTopo === false) changes.push("UPGRADE directive TOPOLOGY 소멸 — 재적용 필요");
  const broken = Object.entries(up.guard.med).filter(([, v]) => v === "MISSING").map(([k]) => k);
  if (broken.length) changes.push(`UPGRADE CUSTOM 깨짐 의심: ${broken.join(",")}`);
  if (up.guard.directiveTopo === false) changes.push("UPGRADE directive TOPOLOGY 소멸 — 재적용 필요");
  if (!up.guard.shimDelegation) changes.push("UPGRADE 심 위임 깨짐 — 확인 필요");
  if (up.registry.beta !== "UNKNOWN" && up.registry.beta !== "QUERY-FAIL" && !up.guard.preReadyForBeta) changes.push(`UPGRADE pre 백업 없음 — beta ${up.registry.beta}용 백업 필요`);
}

writeFileSync(join(EVDIR, `${stamp}.json`), JSON.stringify(snap, null, 1));
if (process.argv.includes("--json")) console.log(JSON.stringify({ snap: `${stamp}.json`, changes }, null, 1));
else {
  console.log(`snapshot: .omo/evidence/pr-watch/${stamp}.json`);
  console.log(changes.length ? "CHANGES:\n- " + changes.join("\n- ") : "NO CHANGES since last run");
}
