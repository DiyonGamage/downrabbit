#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { Readable } = require('stream');

const PORT = Number(process.env.DOWNR_PORT || 8765);
const BASE = (process.env.DOWNR_URL || ('http://127.0.0.1:' + PORT)).replace(/\/$/, '');
const CUSTOM_ENGINE = !!process.env.DOWNR_URL;

const HELP = `
downr - download from anywhere with one command

  downr <link> [more links...]      best quality mp4
  downr <link> -q 1080              pick a quality (best/2160/1440/1080/720/480/360)
  downr <link> -a                   audio only, original format
  downr <link> -m                   audio only, mp3
  downr <link> -o "D:\\Videos"       save somewhere else
  downr <link> --name "my clip"     choose the filename
  downr --help                      this text
  downr --version                   print the version

defaults to your Downloads folder. runs on the downrabbit engine
(the portable folder or bridge/ next to this command).
`;

function normalizeUrl(a) {
  if (/^[a-z]+:\/\//i.test(a)) return a;
  if (/^[\w-]+(\.[\w-]+)+([\/?#]|$)/.test(a)) return 'https://' + a;
  return a;
}

function ask(q) {
  return new Promise(function (resolve) {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, function (a) { rl.close(); resolve(String(a || '').trim().replace(/^["']|["']$/g, '')); });
  });
}

function parse(argv) {
  const o = { urls: [], dir: null, quality: 'best', audio: null, name: null, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '-v' || a === '--version') o.version = true;
    else if (a === '-o' || a === '--out' || a === '--dir') o.dir = argv[++i];
    else if (a === '-q' || a === '--quality') o.quality = String(argv[++i] || 'best').replace(/p$/i, '');
    else if (a === '-a' || a === '--audio') o.audio = 'audio';
    else if (a === '-m' || a === '--mp3') o.audio = 'audio-mp3';
    else if (a === '--name') o.name = argv[++i];
    else if (a === '--keep-engine') o.keep = true;
    else o.urls.push(normalizeUrl(a));
  }
  return o;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(method, p, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 15000);
  try {
    const r = await fetch(BASE + p, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: ctrl.signal
    });
    const txt = await r.text();
    let j = {};
    try { j = txt ? JSON.parse(txt) : {}; } catch (e) { j = { error: txt || ('engine HTTP ' + r.status) }; }
    if (!r.ok) throw new Error(j.error || ('engine HTTP ' + r.status));
    return j;
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error('the engine took too long to answer');
    throw e;
  } finally { clearTimeout(timer); }
}

async function ping(ms) {
  try {
    const j = await api('GET', '/ping', null, ms || 1500);
    return j && j.app === 'downrabbit-bridge' ? j : null;
  } catch (e) { return null; }
}

let spawned = null;
async function ensureEngine() {
  let p = await ping(1500);
  if (p) return { info: p, spawned: false };
  if (CUSTOM_ENGINE) throw new Error('no engine at ' + BASE + ' - start one there or unset DOWNR_URL');
  const server = path.join(__dirname, 'server.js');
  if (!fs.existsSync(server)) throw new Error('engine files are missing next to this command');
  console.log('starting the downrabbit engine...');
  const env = Object.assign({}, process.env, { BRIDGE_PORT: String(PORT), BRIDGE_HOST: '127.0.0.1' });
  spawned = spawn(process.execPath, [server], { cwd: __dirname, windowsHide: true, stdio: 'ignore', env: env });
  const child = spawned;
  child.unref();
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    p = await ping(1000);
    if (p) return { info: p, spawned: true };
    if (child.exitCode !== null) throw new Error('the engine exited - run it in a console to see why');
  }
  throw new Error('the engine did not start (port ' + PORT + ')');
}

function fmtDur(sec) {
  sec = Math.round(Number(sec) || 0);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
}

function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

function expand(p) {
  if (p === '~') return os.homedir();
  if (/^~[\\/]/.test(p)) return path.join(os.homedir(), p.slice(2));
  return p;
}

function defaultDir() {
  const termux = path.join(os.homedir(), 'storage', 'downloads');
  try { if (fs.statSync(termux).isDirectory()) return termux; } catch (e) {}
  const d = path.join(os.homedir(), 'Downloads');
  try { if (fs.statSync(d).isDirectory()) return d; } catch (e) {}
  return os.homedir();
}

function sanitize(name) {
  const n = String(name || 'media').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim();
  return n || 'media';
}

function uniquePath(dir, name) {
  let p = path.join(dir, name);
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let i = 2;
  while (fs.existsSync(p)) p = path.join(dir, base + ' (' + i++ + ')' + ext);
  return p;
}

function pickQuality(meta, q) {
  if (!q || q === 'best') return 'best';
  const want = Number(q);
  if (!want) return 'best';
  const heights = (meta.qualities || []).map(x => Number(x.height) || 0).filter(Boolean).sort((a, b) => b - a);
  const atMost = heights.find(h => h <= want);
  return atMost ? String(atMost) : 'best';
}

async function saveFile(fileId, dest) {
  const r = await fetch(BASE + '/file/' + fileId);
  if (!r.ok) throw new Error('could not fetch the finished file');
  const total = Number(r.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(dest);
  await new Promise((res, rej) => {
    const body = Readable.fromWeb(r.body);
    body.on('error', rej);
    out.on('error', rej);
    out.on('finish', res);
    body.pipe(out);
  });
  return total;
}

async function runOne(url, o, dir, label) {
  console.log(label + 'resolving ' + url);
  const meta = await api('POST', '/resolve', { url: url }, 180000);
  console.log(label + '  ' + (meta.title || 'media') +
    (meta.uploader ? ' - ' + meta.uploader : '') +
    (meta.duration ? '  ' + fmtDur(meta.duration) : ''));

  const q = o.audio ? 'audio' : pickQuality(meta, o.quality);
  const height = (q === 'best' || o.audio) ? 0 : Number(q) || 0;
  const prep = await api('POST', '/prepare', {
    url: url,
    mode: o.audio ? o.audio : 'video',
    height: height,
    name: o.name && o.single ? o.name : (meta.suggestedName || undefined)
  }, 30000);

  let shownStage = '', shownPct = -10;
  let j = null;
  for (;;) {
    j = await api('GET', '/job/' + prep.id, null, 15000);
    if (j.status === 'done') break;
    if (j.status === 'error') throw new Error(j.error || 'download failed');
    if (j.status === 'cancelled') throw new Error('cancelled');
    const pct = Math.floor(Number(j.percent) || 0);
    const stage = j.stage || j.status || 'working';
    if (stage !== shownStage || pct >= shownPct + 10) {
      shownStage = stage;
      shownPct = Math.floor(pct / 10) * 10;
      console.log(label + '  ' + stage + (pct ? ' ' + pct + '%' : '') +
        (j.speed ? '  ' + fmtBytes(j.speed) + '/s' : ''));
    }
    await sleep(1000);
  }

  const name = sanitize(j.fileName || 'media');
  const dest = uniquePath(dir, name);
  console.log(label + '  saving -> ' + dest);
  const bytes = await saveFile(j.fileId, dest);
  await api('DELETE', '/file/' + j.fileId, null, 10000).catch(function () {});
  console.log(label + 'saved ' + path.basename(dest) + ' (' + fmtBytes(bytes || j.size) + ')');
}

(async function main() {
  const o = parse(process.argv.slice(2));
  if (o.help) {
    console.log(HELP);
    process.exit(0);
  }
  if (o.version) {
    let v = 'dev';
    try { v = require('./package.json').version || v; } catch (e) {}
    console.log('downr ' + v);
    process.exit(0);
  }
  if (!o.urls.length && process.stdin.isTTY) {
    const url = await ask('paste a link and press enter: ');
    if (url) o.urls.push(normalizeUrl(url));
  }
  if (!o.urls.length) {
    console.log(HELP);
    process.exit(2);
  }
  const dir = path.resolve(expand(o.dir || defaultDir()));
  fs.mkdirSync(dir, { recursive: true });
  console.log('saving to ' + dir);

  let engine;
  try { engine = await ensureEngine(); }
  catch (e) { console.error('error: ' + e.message); process.exit(1); }

  let failed = 0;
  for (let i = 0; i < o.urls.length; i++) {
    const label = o.urls.length > 1 ? '[' + (i + 1) + '/' + o.urls.length + '] ' : '';
    const one = Object.assign({}, o, { single: o.urls.length === 1 });
    try { await runOne(o.urls[i], one, dir, label); }
    catch (e) { failed++; console.error(label + 'error: ' + String((e && e.message) || e)); }
  }

  if (engine.spawned && !o.keep && spawned) {
    const p = await ping(1000);
    if (p && !p.active && !p.queued) {
      try { process.kill(spawned.pid); } catch (e) {}
    }
  }
  process.exit(failed ? 1 : 0);
})().catch(function (e) {
  console.error('error: ' + String((e && e.message) || e));
  process.exit(1);
});
