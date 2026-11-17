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
downr - download anything with one command

  downr <link>                      best quality video
  downr <link> 1080p                pick a quality: 2160p / 1440p / 1080p / 720p / 480p / 360p
  downr <link> audio                audio only, original format
  downr <link> mp3                  audio only, converted to mp3
  downr <link> -q 1080              long form of the quality shortcut
  downr <link> -a                   long form of audio
  downr <link> -m                   long form of mp3
  downr <link> -o "D:\\Videos"       save somewhere else
  downr <link> --name "my clip"     choose the filename
  downr <link1> <link2> ...         several links, one after another
  downr                             asks you to paste a link
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
    else if (/^(?:audio|audio-only|sound)$/i.test(a)) o.audio = 'audio';
    else if (/^(?:mp3|audio-mp3|music)$/i.test(a)) o.audio = 'audio-mp3';
    else if (/^(?:best|\d{3,4}p?)$/i.test(a)) o.quality = a.toLowerCase().replace(/p$/, '');
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

const Progress = (function () {
  const out = process.stdout;
  const tty = !!out.isTTY;
  const colorOn = tty && !process.env.NO_COLOR && (process.env.TERM || '') !== 'dumb';
  const trueColor = colorOn && /truecolor|24bit/i.test(process.env.COLORTERM || '');
  const E = '\x1b[';
  const RESET = colorOn ? E + '0m' : '';
  const DIM = colorOn ? E + '2m' : '';
  const BOLD = colorOn ? E + '1m' : '';
  const HIDE = tty ? E + '?25l' : '';
  const SHOW = tty ? E + '?25h' : '';
  const CLEAR = tty ? '\r' + E + '2K' : '';
  const UP = tty ? E + '1A' : '';

  let active = false;
  let printed = false;
  let timer = null;
  let title = '';
  let uploader = '';
  let duration = 0;
  let stage = 'starting';
  let target = null;
  let shown = 0;
  let speed = 0;
  let downloaded = 0;
  let total = 0;
  let titleLine = '';
  let barLine = '';

  const colorCache = new Map();

  function clampByte(v) { return Math.max(0, Math.min(255, Math.round(v))); }

  function to256(r, g, b) {
    r = clampByte(r); g = clampByte(g); b = clampByte(b);
    if (Math.abs(r - g) < 8 && Math.abs(g - b) < 8) {
      if (r < 8) return 16;
      if (r > 248) return 231;
      return 232 + Math.round((r - 8) / 247 * 24);
    }
    const q = v => Math.round(v / 255 * 5);
    return 16 + 36 * q(r) + 6 * q(g) + q(b);
  }

  function fg(r, g, b) {
    if (!colorOn) return '';
    if (trueColor) return E + '38;2;' + clampByte(r) + ';' + clampByte(g) + ';' + clampByte(b) + 'm';
    const key = (clampByte(r) << 16) | (clampByte(g) << 8) | clampByte(b);
    let n = colorCache.get(key);
    if (n === undefined) { n = to256(r, g, b); colorCache.set(key, n); }
    return E + '38;5;' + n + 'm';
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360 / 360;
    if (s <= 0) { const v = Math.round(l * 255); return [v, v, v]; }
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue = t => {
      t = ((t % 1) + 1) % 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)].map(v => Math.round(v * 255));
  }

  function cols() { return process.stdout.columns || 80; }

  function truncate(str, max) {
    const chars = Array.from(str);
    if (chars.length <= max) return str;
    return chars.slice(0, Math.max(1, max - 1)).join('') + '…';
  }

  function stageLabel() {
    if (stage === 'downloading' && target === null) return 'starting';
    switch (stage) {
      case 'starting': return 'starting';
      case 'resolving': return 'looking up';
      case 'preparing': return 'getting ready';
      case 'queued': return 'waiting';
      case 'finishing':
      case 'merging':
      case 'converting': return 'finishing';
      case 'saving': return 'saving';
      default: return null;
    }
  }

  function statParts(width) {
    const label = stageLabel();
    if (label) return [{ t: label, c: fg(148, 163, 184) }];
    if (stage === 'downloading' || stage === 'done') {
      const pct = Math.round(shown);
      const parts = [{ t: pct + '%', c: BOLD + fg(226, 232, 240) }];
      if (total > 0 && width >= 54) {
        parts.push({ t: fmtBytes(downloaded) + ' / ' + fmtBytes(total), c: fg(148, 163, 184) });
      }
      if (speed > 0 && width >= 70) {
        parts.push({ t: fmtBytes(speed) + '/s', c: fg(45, 212, 191) });
      }
      return parts;
    }
    return [{ t: 'working', c: fg(148, 163, 184) }];
  }

  function cometBar(width) {
    const t = Date.now() / 1000;
    const head = ((t * 24) % (width + 20)) - 10;
    let s = '';
    for (let i = 0; i < width; i++) {
      const d = i - head;
      if (d >= 0 && d < 11) {
        const ch = d < 3 ? '█' : d < 6 ? '▓' : '▒';
        const c = hslToRgb(192 + d * 5, 0.82, Math.max(0.25, 0.8 - d * 0.045));
        s += fg(c[0], c[1], c[2]) + ch;
      } else {
        s += fg(54, 60, 74) + '░';
      }
    }
    return s + RESET;
  }

  function fillBar(width) {
    const pct = Math.max(0, Math.min(100, shown));
    const filled = Math.round(width * pct / 100);
    const t = Date.now() / 1000;
    const glint = (((t * 0.55) % 1.5) - 0.25) * width;
    let s = '';
    for (let i = 0; i < width; i++) {
      if (i < filled) {
        const pos = width <= 1 ? 0 : i / (width - 1);
        const hue = 166 + pos * 152 + Math.sin(t * 1.7 + i * 0.08) * 5;
        const g = Math.exp(-Math.pow((i - glint) / 3.4, 2));
        const edge = i === filled - 1 ? 0.11 : 0;
        const l = Math.max(0.24, Math.min(0.9, 0.47 + 0.22 * g + edge + 0.03 * Math.sin(t * 4.2 + i * 0.4)));
        const c = hslToRgb(hue, 0.78, l);
        s += fg(c[0], c[1], c[2]) + '█';
      } else {
        s += fg(54, 60, 74) + '░';
      }
    }
    return s + RESET;
  }

  function titleLineText(width) {
    const extra = [];
    if (uploader) extra.push(uploader);
    if (duration) extra.push(fmtDur(duration));
    const suffix = extra.length ? '  ·  ' + extra.join('  ·  ') : '';
    const max = Math.max(2, width - 6);
    let mainText = title || 'downrabbit';
    let suffixText = suffix;
    if (Array.from(mainText).length + Array.from(suffixText).length > max) {
      const suffixLen = Array.from(suffixText).length;
      if (suffixLen && suffixLen + 8 < max) mainText = truncate(mainText, max - suffixLen);
      else { suffixText = ''; mainText = truncate(mainText, max); }
    }
    const body = title
      ? fg(226, 232, 240) + mainText + RESET + (suffixText ? DIM + suffixText + RESET : '')
      : DIM + mainText + suffixText + RESET;
    return '  ' + fg(45, 212, 191) + '◆' + RESET + '  ' + body;
  }

  function barLineText(width) {
    let parts = statParts(width);
    let raw = parts.map(p => p.t).join('  ·  ');
    let barWidth = Math.max(6, Math.min(46, width - 5 - raw.length));
    if (raw && barWidth < 8) {
      parts = [];
      raw = '';
      barWidth = Math.max(6, Math.min(46, width - 5));
    }
    const bar = target === null ? cometBar(barWidth) : fillBar(barWidth);
    const stats = parts.length
      ? '  ' + parts.map(p => p.c + p.t + RESET).join(DIM + '  ·  ' + RESET)
      : '';
    return '  ' + bar + stats;
  }

  function drawAll() {
    if (!tty) return;
    const w = cols();
    titleLine = titleLineText(w);
    barLine = barLineText(w);
    if (!printed) {
      out.write(titleLine + '\n' + barLine);
      printed = true;
    } else {
      out.write(CLEAR + UP + CLEAR + titleLine + '\n' + barLine);
    }
  }

  function drawBar() {
    if (!tty || !printed) return;
    barLine = barLineText(cols());
    out.write(CLEAR + barLine);
  }

  function tick() {
    if (!active) return;
    if (target !== null) {
      if (target >= 99.5) {
        shown = 100;
      } else if (shown < target) {
        shown = Math.min(target, shown + Math.max(0.4, (target - shown) * 0.18));
      } else if (shown > target) {
        shown = target;
      }
    }
    const w = cols();
    if (titleLineText(w) !== titleLine) drawAll();
    else drawBar();
  }

  function startTimer() {
    if (!tty || timer) return;
    timer = setInterval(tick, 85);
    if (timer.unref) timer.unref();
  }

  function stopTimer() {
    if (timer) { clearInterval(timer); timer = null; }
  }

  function reset() {
    title = '';
    uploader = '';
    duration = 0;
    stage = 'starting';
    target = null;
    shown = 0;
    speed = 0;
    downloaded = 0;
    total = 0;
  }

  function begin() {
    if (active) {
      reset();
      drawAll();
      return;
    }
    active = true;
    printed = false;
    reset();
    if (tty) out.write(HIDE);
    drawAll();
    startTimer();
  }

  function setTitle(t, u, d) {
    title = String(t || '').replace(/\s+/g, ' ').trim();
    uploader = String(u || '').replace(/\s+/g, ' ').trim();
    duration = Number(d) || 0;
    if (active) drawAll();
  }

  function setStage(s) {
    stage = s || 'working';
    if (s === 'starting' || s === 'resolving' || s === 'preparing' || s === 'queued') {
      target = null;
    } else if (s === 'downloading') {
      if (target === null) target = 0;
    } else if (s === 'finishing' || s === 'merging' || s === 'converting' || s === 'saving') {
      target = 100;
      shown = 100;
    }
  }

  function update(j) {
    if (!active) return;
    const s = j.stage || j.status || 'downloading';
    stage = s;
    if (s === 'queued') target = null;
    const p = Number(j.percent);
    if (isFinite(p) && s !== 'queued') target = Math.max(0, Math.min(100, p));
    if (s === 'finishing' || s === 'merging' || s === 'converting') {
      target = 100;
      shown = 100;
    }
    if (j.speed !== undefined && j.speed !== null) speed = Number(j.speed) || 0;
    if (j.downloaded !== undefined && j.downloaded !== null) downloaded = Number(j.downloaded) || 0;
    if (j.total !== undefined && j.total !== null) total = Number(j.total) || 0;
  }

  function finish(name, size) {
    if (!active) return;
    stopTimer();
    stage = 'done';
    target = 100;
    shown = 100;
    if (tty && printed) {
      drawBar();
      out.write('\n');
      const bytes = Number(size) || 0;
      let suffix = bytes > 0 ? '  ·  ' + fmtBytes(bytes) : '';
      let avail = cols() - 1 - 12 - suffix.length;
      if (avail < 4 && suffix) {
        suffix = '';
        avail = cols() - 1 - 12;
      }
      const shownName = truncate(String(name), Math.max(1, avail));
      out.write('  ' + fg(52, 211, 153) + '✓' + RESET + '  saved  ' +
        fg(226, 232, 240) + shownName + RESET +
        (suffix ? DIM + suffix + RESET : '') + '\n');
    } else if (!tty) {
      const bytes = Number(size) || 0;
      out.write('saved ' + name + (bytes > 0 ? ' (' + fmtBytes(bytes) + ')' : '') + '\n');
    }
    if (tty) out.write(SHOW);
    active = false;
    printed = false;
  }

  function fail(msg) {
    const text = String(msg || 'something went wrong');
    if (!active) {
      process.stderr.write('error: ' + text + '\n');
      return;
    }
    stopTimer();
    if (tty && printed) {
      out.write(CLEAR + '\n');
      out.write('  ' + fg(248, 113, 113) + '✗' + RESET + '  ' + fg(252, 165, 165) + text + RESET + '\n');
      out.write(SHOW);
    } else {
      process.stderr.write('error: ' + text + '\n');
    }
    active = false;
    printed = false;
  }

  function cleanup() {
    if (!active) return;
    stopTimer();
    if (tty && printed) out.write(CLEAR + '\n' + SHOW);
    active = false;
    printed = false;
  }

  process.on('exit', cleanup);
  process.on('SIGINT', function () { cleanup(); process.exit(130); });
  process.on('SIGTERM', function () { cleanup(); process.exit(143); });

  return { begin: begin, setTitle: setTitle, setStage: setStage, update: update, finish: finish, fail: fail };
})();

async function saveFile(fileId, dest) {
  const r = await fetch(BASE + '/file/' + fileId);
  if (!r.ok) throw new Error('could not fetch the finished file');
  const total = Number(r.headers.get('content-length')) || 0;
  const out = fs.createWriteStream(dest);
  let received = 0;
  await new Promise((res, rej) => {
    const body = Readable.fromWeb(r.body);
    body.on('data', chunk => { received += chunk.length; });
    body.on('error', rej);
    out.on('error', rej);
    out.on('finish', res);
    body.pipe(out);
  });
  return received || total;
}

async function runOne(url, o, dir) {
  const meta = await api('POST', '/resolve', { url: url }, 180000);
  Progress.setTitle(meta.title || '', meta.uploader || '', meta.duration || 0);

  const q = o.audio ? 'audio' : pickQuality(meta, o.quality);
  const height = (q === 'best' || o.audio) ? 0 : Number(q) || 0;
  Progress.setStage('preparing');
  const prep = await api('POST', '/prepare', {
    url: url,
    mode: o.audio ? o.audio : 'video',
    height: height,
    name: o.name && o.single ? o.name : (meta.suggestedName || undefined)
  }, 30000);

  Progress.setStage('downloading');
  let j = null;
  for (;;) {
    j = await api('GET', '/job/' + prep.id, null, 15000);
    if (j.status === 'done') break;
    if (j.status === 'error') throw new Error(j.error || 'download failed');
    if (j.status === 'cancelled') throw new Error('cancelled');
    Progress.update(j);
    await sleep(1000);
  }

  const name = sanitize(j.fileName || 'media');
  const dest = uniquePath(dir, name);
  Progress.setStage('saving');
  const bytes = await saveFile(j.fileId, dest);
  await api('DELETE', '/file/' + j.fileId, null, 10000).catch(function () {});
  Progress.finish(path.basename(dest), bytes || j.size || 0);
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

  Progress.begin();
  let engine;
  try { engine = await ensureEngine(); }
  catch (e) { Progress.fail(e.message); process.exit(1); }

  let failed = 0;
  for (let i = 0; i < o.urls.length; i++) {
    Progress.begin();
    Progress.setStage('resolving');
    const one = Object.assign({}, o, { single: o.urls.length === 1 });
    try { await runOne(o.urls[i], one, dir); }
    catch (e) { failed++; Progress.fail(String((e && e.message) || e)); }
  }

  if (engine.spawned && !o.keep && spawned) {
    const p = await ping(1000);
    if (p && !p.active && !p.queued) {
      try { process.kill(spawned.pid); } catch (e) {}
    }
  }
  process.exit(failed ? 1 : 0);
})().catch(function (e) {
  Progress.fail(String((e && e.message) || e));
  process.exit(1);
});
