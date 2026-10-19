// omo custom layer: settings.json guard (alert only; owner choice 2026-10-17 "알림만")
//
// On 2026-10-16 16:52Z the global settings.json was rewritten with only theme/hideThinkingBlock/tuiMode:
// senpi's save merges its changed fields into the file it reads, and treats a missing/empty file as {}.
// This guard keeps a copy of the protected keys from the last good settings and, when any of them
// disappears, saves the bad file and warns in the conversation. It never writes settings.json.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_AGENT_DIR = path.dirname(HERE);
export const PROTECTED = Object.freeze(['extensions', 'defaultProvider', 'defaultModel', 'compaction.model']);
const RECHECK_MS = 1500;
const DEBOUNCE_MS = 500;

function pick(obj, dotted) {
  let v = obj;
  for (const k of dotted.split('.')) {
    if (v === null || typeof v !== 'object') return undefined;
    v = v[k];
  }
  return v;
}
const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

function replaceWrite(file, text) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text);
  try { fs.renameSync(tmp, file); } catch (err) { try { fs.unlinkSync(tmp); } catch {} throw err; }
}

export function createSettingsGuard({ agentDir = DEFAULT_AGENT_DIR, notify, now = () => new Date() } = {}) {
  const settingsPath = path.join(agentDir, 'settings.json');
  const guardDir = path.join(agentDir, 'settings-guard');
  const lastGoodPath = path.join(guardDir, 'last-good.json');
  const warned = new Set();

  function readSettings() {
    try {
      const text = fs.readFileSync(settingsPath, 'utf8');
      return { text, json: JSON.parse(text) };
    } catch (err) {
      return { error: err };
    }
  }
  function readLastGood() {
    try { return JSON.parse(fs.readFileSync(lastGoodPath, 'utf8')).keys ?? null; } catch { return null; }
  }

  // Returns {status: 'ok'|'missing'|'unreadable', missing?: string[]}
  function check() {
    const cur = readSettings();
    if (cur.error) return { status: 'unreadable', error: cur.error };
    const good = readLastGood();
    const missing = good ? PROTECTED.filter((k) => !isEmpty(good[k]) && isEmpty(pick(cur.json, k))) : [];
    if (missing.length === 0) {
      const keys = Object.fromEntries(PROTECTED.map((k) => [k, pick(cur.json, k)]).filter(([, v]) => !isEmpty(v)));
      if (JSON.stringify(keys) !== JSON.stringify(good)) {
        fs.mkdirSync(guardDir, { recursive: true });
        replaceWrite(lastGoodPath, JSON.stringify({ at: now().toISOString(), keys }, null, 2) + '\n');
      }
      return { status: 'ok' };
    }
    const hash = createHash('sha256').update(cur.text).digest('hex').slice(0, 12);
    const stamp = now().toISOString().replace(/[:.]/g, '-');
    const saved = path.join(guardDir, `settings-missing-${stamp}-${hash}.json`);
    if (!warned.has(hash)) {
      warned.add(hash);
      try { fs.mkdirSync(guardDir, { recursive: true }); fs.writeFileSync(saved, cur.text, { flag: 'wx' }); } catch {}
      notify?.(
        `설정 경고: settings.json에서 ${missing.join(', ')} 항목이 사라졌어. ` +
          `마지막 정상값은 ${lastGoodPath}, 지금 파일 사본은 ${saved}. ` +
          '자동으로 되돌리지는 않아. 복구하려면 말해줘(의도한 삭제면 last-good.json을 지우면 됨).',
      );
    }
    return { status: 'missing', missing };
  }

  let watcher = null;
  let timer = null;
  const schedule = (ms) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, ms);
    timer.unref?.();
  };
  function run() {
    timer = null;
    let r;
    try { r = check(); } catch { return; }
    // A rename-replace can leave the file briefly absent; look again once before staying quiet.
    if (r.status === 'unreadable') schedule(RECHECK_MS);
  }
  function start() {
    run();
    try {
      watcher = fs.watch(agentDir, { persistent: false }, (_event, name) => {
        if (name === null || String(name).toLowerCase() === 'settings.json') schedule(DEBOUNCE_MS);
      });
      watcher.on('error', () => {});
    } catch {}
  }
  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
    try { watcher?.close(); } catch {}
    watcher = null;
  }
  return { check, start, stop, paths: { settingsPath, lastGoodPath, guardDir } };
}

export default function omoSettingsGuard(pi) {
  let guard = null;
  pi.on('session_start', async (_event, ctx) => {
    if (ctx.hasUI === false || guard) return;
    guard = createSettingsGuard({ notify: (msg) => { try { ctx.ui.notify(msg, 'warning'); } catch {} } });
    guard.start();
  });
  pi.on('session_shutdown', async () => {
    guard?.stop();
    guard = null;
  });
}
