'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const dns = require('dns').promises;
const { spawn, execFile } = require('child_process');
const { URL } = require('url');

const VERSION = '1.0.0';
const HOST = '127.0.0.1';
const PORT = clampInt(process.env.BRIDGE_PORT, 8765, 1, 65535);
const DATA_DIR = path.join(os.tmpdir(), 'downrabbit-bridge');
const CACHE_DIR = path.join(DATA_DIR, 'ytdlp-cache');
const BIN_DIR = path.join(__dirname, 'bin');

const MAX_ACTIVE = clampInt(process.env.BRIDGE_MAX_ACTIVE, 3, 1, 4);
const FRAGMENTS = clampInt(process.env.BRIDGE_FRAGMENTS, 24, 1, 32);
const CONNECTIONS = clampInt(process.env.BRIDGE_CONNECTIONS, 8, 1, 16);
const HTTP_CHUNK = process.env.BRIDGE_HTTP_CHUNK || '16M';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';
const FILE_TTL_MS = clampInt(process.env.BRIDGE_FILE_TTL_MS, 60 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000);
const JOB_TTL_MS = Math.max(FILE_TTL_MS, clampInt(process.env.BRIDGE_JOB_TTL_MS, 2 * 60 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000));
const MAX_FILESIZE = process.env.BRIDGE_MAX_FILESIZE || '8G';
const ALLOWED_ORIGINS = (process.env.BRIDGE_ALLOWED_ORIGINS || '*').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
const COOKIES_BROWSER = process.env.BRIDGE_COOKIES_FROM_BROWSER || '';
const COOKIE_FILE = process.env.BRIDGE_COOKIE_FILE || '';
const PROXY = process.env.BRIDGE_PROXY || '';
const IMPERSONATE = process.env.BRIDGE_IMPERSONATE || '';
const AUTO_UPDATE = process.env.BRIDGE_AUTO_UPDATE !== '0';

const jobs = new Map();
const files = new Map();
const resolveCache = new Map();
const queue = [];
const rateHits = [];
let active = 0;
let ytdlpVersion = null;
let ffmpegVersion = null;
let ffmpegMp3 = false;
let toolsCheckedAt = 0;
let toolsCheck = null;

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function findTool(name) {
  const exe = process.platform === 'win32' ? name + '.exe' : name;
  const local = path.join(BIN_DIR, exe);
  if (fs.existsSync(local)) return local;
  return exe;
}

const YTDLP = process.env.YTDLP_PATH || findTool('yt-dlp');
const FFMPEG = process.env.FFMPEG_PATH || findTool('ffmpeg');
const FFMPEG_DIR = path.isAbsolute(FFMPEG) ? path.dirname(FFMPEG) : '';

function probeTool(cmd, args) {
  return new Promise(function (resolve) {
    execFile(cmd, args, { windowsHide: true, timeout: 20000, maxBuffer: 2 * 1024 * 1024 }, function (err, stdout, stderr) {
      if (err) return resolve(null);
      const text = String(stdout || stderr || '').trim();
      resolve(text.split(/\r?\n/)[0] || 'ok');
    });
  });
}

function probeMp3() {
  return new Promise(function (resolve) {
    execFile(FFMPEG, ['-hide_banner', '-encoders'], { windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024 }, function (err, stdout, stderr) {
      if (err) return resolve(false);
      resolve(/libmp3lame|\bmp3\b/i.test(String(stdout || '') + String(stderr || '')));
    });
  });
}

async function refreshTools(force) {
  if (!force && toolsCheckedAt && Date.now() - toolsCheckedAt < 60000) return;
  if (toolsCheck) return toolsCheck;
  toolsCheck = (async function () {
    ytdlpVersion = await probeTool(YTDLP, ['--version']);
    ffmpegVersion = await probeTool(FFMPEG, ['-version']);
    ffmpegMp3 = ffmpegVersion ? await probeMp3() : false;
    toolsCheckedAt = Date.now();
    toolsCheck = null;
  })();
  return toolsCheck;
}

function maybeAutoUpdate() {
  if (!AUTO_UPDATE || !ytdlpVersion) return;
  const stamp = path.join(DATA_DIR, '.last-update');
  try {
    if (Date.now() - fs.statSync(stamp).mtimeMs < 24 * 60 * 60 * 1000) return;
  } catch (e) {}
  const p = spawn(YTDLP, ['--ignore-config', '-U'], { windowsHide: true, stdio: 'ignore' });
  const timer = setTimeout(function () { killTree(p); }, 120000);
  if (timer.unref) timer.unref();
  p.on('error', function () {});
  p.on('close', function () {
    clearTimeout(timer);
    try { fs.writeFileSync(stamp, String(Date.now())); } catch (e) {}
  });
}

function killTree(p) {
  if (!p || !p.pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      try { process.kill(-p.pid, 'SIGKILL'); } catch (e) { try { p.kill('SIGKILL'); } catch (e2) {} }
    }
  } catch (e) {}
}

function allowedOrigin(origin) {
  if (ALLOWED_ORIGINS.indexOf('*') !== -1) return origin && origin !== 'null' ? origin : '*';
  if (!origin) return '';
  return ALLOWED_ORIGINS.indexOf(origin) !== -1 ? origin : '';
}

function cors(req, res) {
  const allow = allowedOrigin(req.headers.origin);
  if (allow) {
    res.setHeader('Access-Control-Allow-Origin', allow);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Content-Type, Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Disposition');
  if (req.headers['access-control-request-private-network'] === 'true') {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
}

function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on('data', function (chunk) {
      size += chunk.length;
      if (size > (limit || 8192)) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', function () {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function rateOk() {
  const now = Date.now();
  while (rateHits.length && now - rateHits[0] > 60000) rateHits.shift();
  if (rateHits.length >= 40) return false;
  rateHits.push(now);
  return true;
}

function isPrivateIp(ip) {
  if (net.isIP(ip) === 4) {
    const p = ip.split('.').map(Number);
    if (p[0] === 0 || p[0] === 10 || p[0] === 127) return true;
    if (p[0] === 169 && p[1] === 254) return true;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
    if (p[0] === 192 && p[1] === 168) return true;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true;
    if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return true;
    if (p[0] >= 224) return true;
    return false;
  }
  if (net.isIP(ip) === 6) {
    const s = ip.toLowerCase();
    if (s === '::1' || s === '::') return true;
    if (s.indexOf('fc') === 0 || s.indexOf('fd') === 0) return true;
    if (/^fe[89ab]/.test(s)) return true;
    if (s.indexOf('::ffff:') === 0) return isPrivateIp(s.slice(7));
    return false;
  }
  return false;
}

async function assertPublicUrl(raw) {
  if (typeof raw !== 'string' || raw.length < 8 || raw.length > 4096) throw new Error('invalid URL');
  let u;
  try { u = new URL(raw); } catch (e) { throw new Error('invalid URL'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('only http(s) links are supported');
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) throw new Error('invalid URL');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host === 'metadata.google.internal') {
    throw new Error('local addresses are blocked');
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error('local addresses are blocked');
  } else {
    let addrs;
    try { addrs = await dns.lookup(host, { all: true, verbatim: true }); }
    catch (e) { throw new Error('could not resolve that host'); }
    if (!addrs.length) throw new Error('could not resolve that host');
    for (const a of addrs) {
      if (isPrivateIp(a.address)) throw new Error('local addresses are blocked');
    }
  }
  if (/(^|\.)spotify\.com$/i.test(host)) throw new Error('Spotify is DRM-protected and cannot be downloaded');
  if (/(^|\.)youtube\.com$/i.test(host)) {
    const m = /^\/(shorts|live|embed)\/([^/?#]+)/i.exec(u.pathname);
    if (m) { u.pathname = '/watch'; u.search = '?v=' + m[2]; }
  }
  return u.toString();
}

function safeName(n, fallback) {
  const name = String(n || fallback || 'media')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 150);
  return name || (fallback || 'media');
}

function ensureExt(name, ext) {
  const base = safeName(name).replace(/\.[a-z0-9]{1,5}$/i, '');
  return base + '.' + (ext || 'mp4');
}

function sizeOf(f) {
  return Number(f && (f.filesize || f.filesize_approx)) || 0;
}

function videoExtAt(formats, height) {
  const best = pickVideo(formats, height);
  return (best && best.ext) || 'mp4';
}

function pickVideo(formats, maxHeight) {
  let best = null;
  for (const f of formats) {
    if (!f.vcodec || f.vcodec === 'none') continue;
    const h = Number(f.height) || 0;
    if (h <= 0 || h > maxHeight) continue;
    if (!best) { best = f; continue; }
    const bh = Number(best.height) || 0;
    if (h !== bh) { if (h > bh) best = f; continue; }
    if ((f.ext === 'mp4') !== (best.ext === 'mp4')) { if (f.ext === 'mp4') best = f; continue; }
    const fCombined = f.acodec && f.acodec !== 'none';
    const bCombined = best.acodec && best.acodec !== 'none';
    if (fCombined !== bCombined) { if (!fCombined) best = f; continue; }
    const fs = sizeOf(f), bs = sizeOf(best);
    if ((fs > 0) !== (bs > 0)) { if (fs > 0) best = f; continue; }
    if ((Number(f.tbr) || 0) > (Number(best.tbr) || 0)) best = f;
  }
  return best;
}

function pickAudio(formats) {
  let best = null;
  for (const f of formats) {
    const isAudio = (!f.vcodec || f.vcodec === 'none') && f.acodec && f.acodec !== 'none';
    if (!isAudio) continue;
    if (!best) { best = f; continue; }
    if ((f.ext === 'm4a') !== (best.ext === 'm4a')) { if (f.ext === 'm4a') best = f; continue; }
    const fs = sizeOf(f), bs = sizeOf(best);
    if ((fs > 0) !== (bs > 0)) { if (fs > 0) best = f; continue; }
    if ((Number(f.abr) || 0) > (Number(best.abr) || 0)) best = f;
  }
  return best;
}

function estimateBest(formats) {
  const bestV = pickVideo(formats, 4320);
  const bestA = pickAudio(formats);
  if (!bestV) return 0;
  if (bestV.acodec && bestV.acodec !== 'none') return sizeOf(bestV);
  return sizeOf(bestV) + (bestA ? sizeOf(bestA) : 0);
}

function estimateHeight(formats, height) {
  const bestV = pickVideo(formats, height);
  const bestA = pickAudio(formats);
  if (!bestV) return 0;
  if (bestV.acodec && bestV.acodec !== 'none') return sizeOf(bestV);
  return sizeOf(bestV) + (bestA ? sizeOf(bestA) : 0);
}

function normalizeInfo(d) {
  const formats = Array.isArray(d.formats) ? d.formats : [];
  const heights = new Set();
  const bestAudio = pickAudio(formats);
  for (const f of formats) {
    const h = Number(f.height) || 0;
    if (f.vcodec && f.vcodec !== 'none' && h > 0 && h <= 4320) heights.add(h);
  }
  const hs = Array.from(heights).sort(function (a, b) { return b - a; });
  const videoExt = videoExtAt(formats, 4320);
  const qualities = [{ key: 'best', label: 'best quality', height: 0, filesize: estimateBest(formats), ext: videoExt }];
  for (const h of hs) qualities.push({ key: String(h), label: h + 'p', height: h, filesize: estimateHeight(formats, h), ext: videoExtAt(formats, h) });
  const audioExt = (bestAudio && bestAudio.ext) || 'm4a';
  qualities.push({ key: 'audio', label: 'audio only · original', height: 0, filesize: bestAudio ? sizeOf(bestAudio) : 0, ext: audioExt });
  if (ffmpegMp3) {
    qualities.push({ key: 'audio-mp3', label: 'audio only · mp3 (re-encode)', height: 0, filesize: bestAudio ? sizeOf(bestAudio) : 0, ext: 'mp3' });
  }

  const title = safeName(d.title || d.id || 'media');
  return {
    title: title,
    duration: Number(d.duration) || 0,
    thumbnail: d.thumbnail || '',
    extractor: d.extractor_key || d.extractor || '',
    uploader: d.uploader || '',
    isLive: !!d.is_live,
    webpageUrl: d.webpage_url || '',
    heights: hs,
    qualities: qualities,
    audioExt: audioExt,
    videoExt: videoExt,
    mp3: !!ffmpegMp3,
    suggestedName: title + '.' + videoExt,
    audioSuggestedName: title + '.' + audioExt,
    mp3SuggestedName: title + '.mp3'
  };
}

function baseArgs() {
  const a = [
    '--ignore-config',
    '--no-playlist',
    '--playlist-items', '1',
    '--no-warnings',
    '--cache-dir', CACHE_DIR,
    '--no-mtime',
    '--no-write-info-json',
    '--no-write-thumbnail',
    '--no-write-subs',
    '--no-write-auto-subs',
    '--socket-timeout', '20',
    '--retries', '3',
    '--fragment-retries', '3',
    '--concurrent-fragments', String(FRAGMENTS)
  ];
  if (HTTP_CHUNK) a.push('--http-chunk-size', HTTP_CHUNK);
  if (MAX_FILESIZE) a.push('--max-filesize', MAX_FILESIZE);
  if (PROXY) a.push('--proxy', PROXY);
  if (IMPERSONATE) a.push('--impersonate', IMPERSONATE);
  if (COOKIES_BROWSER) a.push('--cookies-from-browser', COOKIES_BROWSER);
  if (COOKIE_FILE) a.push('--cookies', COOKIE_FILE);
  if (FFMPEG_DIR) a.push('--ffmpeg-location', FFMPEG_DIR);
  return a;
}

function cleanStderr(text) {
  return String(text || '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\r/g, '')
    .trim();
}

function friendlyError(stderr, code) {
  const s = cleanStderr(stderr);
  const last = s.split('\n').filter(Boolean).slice(-3).join(' ');
  if (/sign in|log in|login|cookies|private video|age.restricted|members.only|confirm you.re not a bot/i.test(s)) {
    return new Error('this site wants a login. set BRIDGE_COOKIES_FROM_BROWSER=chrome (or edge/firefox) and restart the bridge');
  }
  if (/drm/i.test(s)) return new Error('that media is DRM-protected and cannot be downloaded');
  if (/unsupported url/i.test(s)) return new Error('yt-dlp does not support that site');
  if (/encoder not found|audio conversion failed/i.test(s)) {
    return new Error('this ffmpeg build cannot encode MP3. pick audio (original) or run bridge/setup.ps1 for a full ffmpeg');
  }
  if (/ffmpeg.*not found|ffprobe.*not found|ffmpeg not installed/i.test(s)) {
    return new Error('ffmpeg is required for this format. install ffmpeg or run bridge/setup.ps1');
  }
  if (/requested format.*not available|format is not available/i.test(s)) {
    return new Error('that quality is not available for this video. pick another quality');
  }
  if (/video unavailable|not available|removed by/i.test(s)) return new Error('that video is not available');
  if (/max-filesize|file is larger than max-filesize/i.test(s)) return new Error('that file is larger than the bridge size limit');
  return new Error(last || ('yt-dlp failed with code ' + code));
}

function runCapture(cmd, args, timeout) {
  return new Promise(function (resolve) {
    let done = false;
    let out = '';
    let err = '';
    const p = spawn(cmd, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(function () {
      if (done) return;
      done = true;
      killTree(p);
      resolve({ code: -1, stdout: out, stderr: err + '\n(timeout)' });
    }, timeout);
    p.stdout.on('data', function (d) {
      out += d.toString('utf8');
      if (out.length > 64 * 1024 * 1024) killTree(p);
    });
    p.stderr.on('data', function (d) {
      err = (err + d.toString('utf8')).slice(-128 * 1024);
    });
    p.on('error', function (e) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code: -1, stdout: out, stderr: String(e && e.message || e) });
    });
    p.on('close', function (code) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code: code, stdout: out, stderr: err });
    });
  });
}

async function resolveData(url) {
  const cached = resolveCache.get(url);
  if (cached && cached.expires > Date.now()) return cached.data;
  const args = baseArgs().concat(['-J', '--skip-download', url]);
  const r = await runCapture(YTDLP, args, 90000);
  if (r.code !== 0) throw friendlyError(r.stderr, r.code);
  let data;
  try {
    const text = r.stdout.slice(r.stdout.indexOf('{'));
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('could not parse yt-dlp output');
  }
  if (data && data._type === 'playlist' && Array.isArray(data.entries)) data = data.entries[0];
  if (!data) throw new Error('no media found at that link');
  if (!Array.isArray(data.formats) || !data.formats.length) throw new Error('no downloadable formats found');
  const now = Date.now();
  for (const entry of resolveCache) if (entry[1].expires < now) resolveCache.delete(entry[0]);
  while (resolveCache.size >= 8) resolveCache.delete(resolveCache.keys().next().value);
  resolveCache.set(url, { data: data, expires: now + 10 * 60 * 1000 });
  return data;
}

async function resolveUrl(url) {
  return normalizeInfo(await resolveData(url));
}

function formatSelector(job) {
  if (job.mode === 'audio' || job.mode === 'audio-mp3') return 'ba[ext=m4a]/ba/b';
  if (!job.height) return 'bv*[ext=mp4]+ba[ext=m4a]/bv*+ba/b';
  const h = job.height;
  return 'bv*[height<=' + h + '][ext=mp4]+ba[ext=m4a]/b[height<=' + h + '][ext=mp4]/bv*[height<=' + h + ']+ba/b[height<=' + h + ']';
}

function findOutput(dir) {
  let best = null;
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { return null; }
  for (const name of names) {
    if (/\.(part|ytdl|temp|json|jpg|jpeg|png|webp|vtt|srt|ass|lrc|description)$/i.test(name)) continue;
    const p = path.join(dir, name);
    let st;
    try { st = fs.statSync(p); } catch (e) { continue; }
    if (!st.isFile()) continue;
    if (!best || st.size > best.size) best = { path: p, size: st.size };
  }
  return best;
}

function cleanupDir(dir) {
  const resolved = path.resolve(dir);
  if (resolved.indexOf(path.resolve(DATA_DIR) + path.sep) !== 0) return;
  try { fs.rmSync(resolved, { recursive: true, force: true }); } catch (e) {}
}

function startJob(input) {
  const mode = ['video', 'audio', 'audio-mp3'].indexOf(input.mode) !== -1 ? input.mode : 'video';
  let height = Number(input.height) || 0;
  if (!Number.isFinite(height) || height < 0 || height > 4320) height = 0;
  const id = crypto.randomUUID();
  const job = {
    id: id,
    url: input.url,
    mode: mode,
    height: mode === 'video' ? height : 0,
    name: safeName(input.name),
    status: 'queued',
    stage: 'queued',
    percent: 0,
    speed: 0,
    eta: null,
    downloaded: 0,
    total: 0,
    size: 0,
    ext: '',
    fileId: null,
    fileName: '',
    error: '',
    created: Date.now(),
    proc: null
  };
  jobs.set(id, job);
  queue.push(job);
  pumpJobs();
  return job;
}

function pumpJobs() {
  while (active < MAX_ACTIVE) {
    const job = queue.shift();
    if (!job) break;
    if (job.status !== 'queued') continue;
    active++;
    runJob(job).catch(function () {}).then(function () {
      active--;
      pumpJobs();
    });
  }
}

function parseProgress(job, line) {
  if (line.indexOf('PROGRESS|') === 0) {
    const parts = line.split('|');
    const status = parts[1] || '';
    const dl = Number(parts[2]) || 0;
    const total = Number(parts[3]) || Number(parts[4]) || 0;
    const speed = Number(parts[5]) || 0;
    const eta = parts[6] && parts[6] !== 'NA' ? Number(parts[6]) : null;
    job.downloaded = dl;
    job.total = total;
    job.speed = speed;
    job.eta = eta;
    job.percent = total ? Math.min(100, Math.round((dl / total) * 1000) / 10) : 0;
    job.stage = status === 'finished' ? 'finishing' : 'downloading';
    return;
  }
  if (/\[Merger\]|\[VideoRemuxer\]/i.test(line)) {
    job.stage = 'merging';
    job.percent = 100;
    return;
  }
  if (/\[ExtractAudio\]|\[AudioConvert\]/i.test(line)) {
    job.stage = 'converting';
    job.percent = 100;
  }
}

function rmQuiet(p) { try { fs.unlinkSync(p); } catch (e) {} }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function abortErr() { const e = new Error('cancelled'); e.cancel = true; return e; }
function writeAt(fd, buf, position) {
  return new Promise(function (resolve, reject) {
    fs.write(fd, buf, 0, buf.length, position, function (err, written) { err ? reject(err) : resolve(written); });
  });
}

function selectFormats(data, job) {
  const formats = Array.isArray(data.formats) ? data.formats : [];
  if (job.mode === 'audio' || job.mode === 'audio-mp3') {
    const a = pickAudio(formats);
    if (!a) throw new Error('no audio format found');
    return { video: null, audio: a };
  }
  const v = pickVideo(formats, job.height || 4320);
  if (!v) throw new Error('no video format found');
  if (v.acodec && v.acodec !== 'none') return { video: v, audio: null };
  return { video: v, audio: pickAudio(formats) };
}

function directOk(f) {
  return f && typeof f.url === 'string' && /^https?:/i.test(f.url) && !/m3u8|dash|ism|f4m/i.test(f.protocol || '');
}

function makeTracker(job) {
  let lastT = Date.now(), lastB = 0, speed = 0;
  return function add(n) {
    job.downloaded += n;
    const now = Date.now();
    if (now - lastT >= 400) {
      const dt = (now - lastT) / 1000;
      const inst = (job.downloaded - lastB) / dt;
      speed = speed ? speed * 0.6 + inst * 0.4 : inst;
      lastB = job.downloaded; lastT = now;
      job.speed = Math.round(speed);
      job.eta = speed > 0 && job.total > job.downloaded ? Math.round((job.total - job.downloaded) / speed) : null;
      job.percent = job.total ? Math.min(99.9, Math.round((job.downloaded / job.total) * 1000) / 10) : 0;
      job.stage = 'downloading';
    }
  };
}

async function downloadRange(url, fd, start, end, job, add) {
  const expect = end - start + 1;
  for (let attempt = 1; ; attempt++) {
    if (job.status === 'cancelled') throw abortErr();
    const ac = new AbortController();
    (job._acs = job._acs || []).push(ac);
    let idle = null;
    let got = 0;
    try {
      const resp = await fetch(url, { headers: { Range: 'bytes=' + start + '-' + end, 'User-Agent': UA }, signal: ac.signal, redirect: 'follow' });
      if (resp.status === 403 || resp.status === 401) { const e = new Error('HTTP ' + resp.status); e.fatal = true; throw e; }
      if (resp.status === 200) { const e = new Error('server ignored range'); e.fatal = true; throw e; }
      if (resp.status !== 206) throw new Error('HTTP ' + resp.status);
      const reader = resp.body.getReader();
      const arm = function () { clearTimeout(idle); idle = setTimeout(function () { ac.abort(); }, 30000); };
      arm();
      while (true) {
        const r = await reader.read();
        if (r.done) break;
        arm();
        await writeAt(fd, r.value, start + got);
        got += r.value.length;
        add(r.value.length);
        if (job.status === 'cancelled') throw abortErr();
      }
      clearTimeout(idle);
      if (got !== expect) throw new Error('short segment ' + got + '/' + expect);
      return;
    } catch (e) {
      clearTimeout(idle);
      if (e.cancel || job.status === 'cancelled') throw abortErr();
      if (e.fatal || attempt >= 4) throw e;
      await sleep(500 * attempt);
    }
  }
}

async function downloadSingle(url, dest, job, add) {
  for (let attempt = 1; ; attempt++) {
    if (job.status === 'cancelled') throw abortErr();
    const ac = new AbortController();
    (job._acs = job._acs || []).push(ac);
    let idle = null;
    const ws = fs.createWriteStream(dest);
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': UA }, signal: ac.signal, redirect: 'follow' });
      if (resp.status === 403 || resp.status === 401) { const e = new Error('HTTP ' + resp.status); e.fatal = true; throw e; }
      if (resp.status !== 200 && resp.status !== 206) throw new Error('HTTP ' + resp.status);
      const reader = resp.body.getReader();
      const arm = function () { clearTimeout(idle); idle = setTimeout(function () { ac.abort(); }, 30000); };
      arm();
      while (true) {
        const r = await reader.read();
        if (r.done) break;
        arm();
        await new Promise(function (res, rej) { ws.write(r.value, function (err) { err ? rej(err) : res(); }); });
        add(r.value.length);
        if (job.status === 'cancelled') throw abortErr();
      }
      clearTimeout(idle);
      await new Promise(function (res) { ws.end(res); });
      return;
    } catch (e) {
      clearTimeout(idle);
      ws.destroy();
      if (e.cancel || job.status === 'cancelled') throw abortErr();
      if (e.fatal || attempt >= 4) throw e;
      await sleep(500 * attempt);
    }
  }
}

async function downloadSegmented(url, dest, total, conns, job, add) {
  if (!total || total <= 0) return downloadSingle(url, dest, job, add);
  const n = Math.max(1, Math.min(conns, Math.ceil(total / (128 * 1024))));
  const seg = Math.ceil(total / n);
  const fd = fs.openSync(dest, 'w');
  fs.ftruncateSync(fd, total);
  try {
    let idx = 0;
    const worker = async function () {
      while (idx < n) {
        const my = idx++;
        const s = my * seg;
        const e = Math.min(total - 1, (my + 1) * seg - 1);
        await downloadRange(url, fd, s, e, job, add);
      }
    };
    const workers = [];
    for (let i = 0; i < n; i++) workers.push(worker());
    await Promise.all(workers);
  } finally {
    try { fs.closeSync(fd); } catch (e) {}
  }
}

function runFfmpeg(job, args) {
  return new Promise(function (resolve, reject) {
    const p = spawn(FFMPEG, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    job.proc = p;
    let err = '';
    p.stderr.on('data', function (d) { err = (err + d.toString('utf8')).slice(-8192); });
    p.on('error', function (e) { job.proc = null; reject(e); });
    p.on('close', function (code) {
      job.proc = null;
      if (job.status === 'cancelled') return reject(abortErr());
      if (code !== 0) return reject(new Error('ffmpeg failed: ' + cleanStderr(err).split('\n').filter(Boolean).slice(-2).join(' ')));
      resolve();
    });
  });
}

function registerOutput(job, filePath) {
  const st = fs.statSync(filePath);
  const ext = (path.extname(filePath).slice(1) || 'bin').toLowerCase();
  const fileId = crypto.randomUUID();
  const fileName = ensureExt(job.name, ext);
  files.set(fileId, { id: fileId, path: filePath, name: fileName, ext: ext, size: st.size, created: Date.now() });
  job.status = 'done';
  job.stage = 'done';
  job.percent = 100;
  job.downloaded = st.size;
  job.total = st.size;
  job.size = st.size;
  job.speed = 0;
  job.eta = null;
  job.ext = ext;
  job.fileId = fileId;
  job.fileName = fileName;
}

async function runJobFast(job, dir) {
  const vpath = path.join(dir, 'v.part');
  const apath = path.join(dir, 'a.part');
  let sel = null;
  for (let round = 0; ; round++) {
    if (job.status === 'cancelled') throw abortErr();
    const data = await resolveData(job.url);
    sel = selectFormats(data, job);
    if (sel.video && !directOk(sel.video)) throw new Error('video format is not a direct link');
    if (sel.audio && !directOk(sel.audio)) throw new Error('audio format is not a direct link');
    const add = makeTracker(job);
    job.downloaded = 0;
    job.total = (sel.video ? sizeOf(sel.video) : 0) + (sel.audio ? sizeOf(sel.audio) : 0);
    job.stage = 'downloading';
    try {
      const tasks = [];
      if (sel.video) tasks.push(downloadSegmented(sel.video.url, vpath, sizeOf(sel.video), CONNECTIONS, job, add));
      if (sel.audio) tasks.push(downloadSegmented(sel.audio.url, apath, sizeOf(sel.audio), 2, job, add));
      await Promise.all(tasks);
      break;
    } catch (e) {
      if (e.cancel || job.status === 'cancelled') throw e;
      if (e.fatal && /403|401/.test(e.message) && round < 2) {
        resolveCache.delete(job.url);
        rmQuiet(vpath); rmQuiet(apath);
        console.log('[bridge] ' + e.message + ' — re-resolving fresh (round ' + (round + 1) + ')');
        await sleep(800 * (round + 1));
        continue;
      }
      throw e;
    }
  }
  if (job.status === 'cancelled') throw abortErr();

  let outPath, outExt;
  if (job.mode === 'audio-mp3') {
    outExt = 'mp3'; outPath = path.join(dir, 'media.mp3');
    job.stage = 'converting'; job.percent = 100;
    await runFfmpeg(job, ['-y', '-hide_banner', '-loglevel', 'error', '-i', apath, '-vn', '-codec:a', 'libmp3lame', '-q:a', '2', outPath]);
  } else if (job.mode === 'audio') {
    outExt = sel.audio.ext || 'm4a'; outPath = path.join(dir, 'media.' + outExt);
    fs.renameSync(apath, outPath);
  } else if (!sel.audio) {
    outExt = sel.video.ext || 'mp4'; outPath = path.join(dir, 'media.' + outExt);
    fs.renameSync(vpath, outPath);
  } else {
    if (sel.video.ext === 'mp4' && sel.audio.ext === 'm4a') outExt = 'mp4';
    else if (sel.video.ext === 'webm' && (sel.audio.ext === 'webm' || sel.audio.ext === 'opus')) outExt = 'webm';
    else outExt = 'mkv';
    outPath = path.join(dir, 'media.' + outExt);
    job.stage = 'merging'; job.percent = 100;
    const margs = ['-y', '-hide_banner', '-loglevel', 'error', '-i', vpath, '-i', apath, '-c', 'copy'];
    if (outExt === 'mp4') margs.push('-movflags', '+faststart');
    margs.push(outPath);
    await runFfmpeg(job, margs);
  }
  rmQuiet(vpath); rmQuiet(apath);
  registerOutput(job, outPath);
}

async function runJob(job) {
  if (job.status === 'cancelled') return;
  const dir = path.join(DATA_DIR, job.id);
  fs.mkdirSync(dir, { recursive: true });
  job.status = 'downloading';
  job.stage = 'downloading';
  job.started = Date.now();
  try {
    await runJobFast(job, dir);
    return;
  } catch (e) {
    if (job.status === 'cancelled' || (e && e.cancel)) { cleanupDir(dir); return; }
    console.log('[bridge] fast path failed (' + (e && e.message) + ') — falling back to yt-dlp');
    resolveCache.delete(job.url);
    cleanupDir(dir);
    fs.mkdirSync(dir, { recursive: true });
    job.downloaded = 0; job.total = 0; job.percent = 0; job.speed = 0; job.eta = null;
    job.stage = 'downloading';
    await runJobYtdlp(job, dir);
  }
}

async function runJobYtdlp(job, dir) {
  const args = baseArgs().concat([
    '--newline',
    '--progress-template',
    'download:PROGRESS|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s',
    '-f', formatSelector(job)
  ]);
  if (job.mode === 'audio-mp3') args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
  args.push('-o', path.join(dir, 'media.%(ext)s'));
  const cached = resolveCache.get(job.url);
  if (cached && cached.expires > Date.now()) {
    try {
      const infoPath = path.join(dir, 'info.json');
      fs.writeFileSync(infoPath, JSON.stringify(cached.data));
      args.push('--load-info-json', infoPath);
    } catch (e) {
      args.push(job.url);
    }
  } else {
    args.push(job.url);
  }

  return new Promise(function (resolve) {
    let stderr = '';
    let buffer = '';
    let finished = false;
    const p = spawn(YTDLP, args, {
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    job.proc = p;

    function finish() {
      if (finished) return;
      finished = true;
      job.proc = null;
      resolve();
    }

    function onLine(line) {
      parseProgress(job, line.replace(/\r$/, ''));
    }

    p.stdout.on('data', function (d) {
      buffer += d.toString('utf8');
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        onLine(line);
      }
      if (buffer.length > 65536) buffer = buffer.slice(-65536);
    });

    p.stderr.on('data', function (d) {
      stderr = (stderr + d.toString('utf8')).slice(-16384);
    });

    p.on('error', function (e) {
      if (finished) return;
      if (job.status === 'cancelled') return finish();
      job.status = 'error';
      job.stage = 'error';
      job.error = String(e && e.message || e);
      cleanupDir(dir);
      finish();
    });

    p.on('close', function (code) {
      if (finished) return;
      if (job.status === 'cancelled') {
        cleanupDir(dir);
        return finish();
      }
      if (code !== 0) {
        job.status = 'error';
        job.stage = 'error';
        job.error = friendlyError(stderr, code).message;
        resolveCache.delete(job.url);
        cleanupDir(dir);
        return finish();
      }
      const output = findOutput(dir);
      if (!output) {
        job.status = 'error';
        job.stage = 'error';
        job.error = 'download finished but no file was produced';
        cleanupDir(dir);
        return finish();
      }
      const ext = (path.extname(output.path).slice(1) || 'bin').toLowerCase();
      const fileId = crypto.randomUUID();
      const fileName = ensureExt(job.name, ext);
      files.set(fileId, {
        id: fileId,
        path: output.path,
        name: fileName,
        ext: ext,
        size: output.size,
        created: Date.now()
      });
      job.status = 'done';
      job.stage = 'done';
      job.percent = 100;
      job.downloaded = output.size;
      job.total = output.size;
      job.size = output.size;
      job.ext = ext;
      job.fileId = fileId;
      job.fileName = fileName;
      finish();
    });
  });
}

function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) return false;
  job.status = 'cancelled';
  job.stage = 'cancelled';
  if (job._acs) job._acs.forEach(function (ac) { try { ac.abort(); } catch (e) {} });
  if (job.proc) killTree(job.proc);
  cleanupDir(path.join(DATA_DIR, id));
  return true;
}

function mimeFor(ext) {
  const map = {
    mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
    mov: 'video/quicktime', avi: 'video/x-msvideo', flv: 'video/x-flv',
    m4a: 'audio/mp4', mp3: 'audio/mpeg', opus: 'audio/opus', ogg: 'audio/ogg',
    oga: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp'
  };
  return map[ext] || 'application/octet-stream';
}

function serveFile(req, res, id) {
  const f = files.get(id);
  if (!f) return json(res, 404, { error: 'file not found or expired' });
  let st;
  try { st = fs.statSync(f.path); }
  catch (e) {
    files.delete(id);
    return json(res, 404, { error: 'file not found or expired' });
  }
  const size = st.size;
  const headers = {
    'Content-Type': mimeFor(f.ext),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Disposition': 'attachment; filename="' + f.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') + '"; filename*=UTF-8\'\'' + encodeURIComponent(f.name)
  };
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    if (!m) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + size });
      return res.end();
    }
    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : size - 1;
    if (m[1] === '' && m[2] !== '') {
      const suffix = parseInt(m[2], 10);
      start = Math.max(0, size - suffix);
      end = size - 1;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= size || end >= size || start > end) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + size });
      return res.end();
    }
    headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size;
    headers['Content-Length'] = String(end - start + 1);
    res.writeHead(206, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(f.path, { start: start, end: end }).pipe(res);
    return;
  }
  headers['Content-Length'] = String(size);
  res.writeHead(200, headers);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(f.path).pipe(res);
}

function cleanup() {
  const now = Date.now();
  for (const entry of files) {
    const id = entry[0];
    const f = entry[1];
    if (now - f.created > FILE_TTL_MS) {
      files.delete(id);
      cleanupDir(path.dirname(f.path));
    }
  }
  for (const entry of jobs) {
    const id = entry[0];
    const j = entry[1];
    if (j.status !== 'downloading' && j.status !== 'queued' && now - j.created > JOB_TTL_MS) jobs.delete(id);
  }
}

function initDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  let names = [];
  try { names = fs.readdirSync(DATA_DIR); } catch (e) {}
  for (const name of names) {
    const p = path.join(DATA_DIR, name);
    try {
      const st = fs.statSync(p);
      if (st.isDirectory() && Date.now() - st.mtimeMs > 6 * 60 * 60 * 1000) cleanupDir(p);
    } catch (e) {}
  }
}

const server = http.createServer(async function (req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  let u;
  try { u = new URL(req.url, 'http://' + HOST + ':' + PORT); }
  catch (e) { return json(res, 400, { error: 'bad request' }); }
  const p = u.pathname;

  try {
    if (p === '/ping' && req.method === 'GET') {
      refreshTools(false);
      return json(res, 200, {
        ok: true,
        app: 'downrabbit-bridge',
        version: VERSION,
        ready: !!ytdlpVersion,
        ytdlp: ytdlpVersion,
        ffmpeg: ffmpegVersion,
        mp3: !!ffmpegMp3,
        fragments: FRAGMENTS,
        maxActive: MAX_ACTIVE,
        httpChunk: HTTP_CHUNK,
        active: active,
        queued: queue.length
      });
    }

    if (p === '/resolve' && req.method === 'POST') {
      if (!rateOk()) return json(res, 429, { error: 'too many requests — slow down a little' });
      const body = await readBody(req);
      const url = await assertPublicUrl(body.url);
      await refreshTools(false);
      if (!ytdlpVersion) return json(res, 503, { error: 'yt-dlp is not installed. run bridge/setup.ps1 or install yt-dlp' });
      const cached = resolveCache.get(url);
      if (cached && cached.expires > Date.now()) return json(res, 200, Object.assign({ ok: true }, normalizeInfo(cached.data)));
      const info = await resolveUrl(url);
      return json(res, 200, Object.assign({ ok: true }, info));
    }

    if (p === '/prepare' && req.method === 'POST') {
      if (!rateOk()) return json(res, 429, { error: 'too many requests — slow down a little' });
      const body = await readBody(req);
      const url = await assertPublicUrl(body.url);
      await refreshTools(false);
      if (!ytdlpVersion) return json(res, 503, { error: 'yt-dlp is not installed. run bridge/setup.ps1 or install yt-dlp' });
      if (body.mode === 'audio-mp3' && !ffmpegMp3) {
        return json(res, 422, { error: 'this ffmpeg build has no MP3 encoder. pick audio (original) or run bridge/setup.ps1 for a full ffmpeg' });
      }
      const job = startJob({ url: url, mode: body.mode, height: body.height, name: body.name });
      return json(res, 200, { ok: true, id: job.id });
    }

    let m = /^\/job\/([a-f0-9-]+)$/i.exec(p);
    if (m && req.method === 'GET') {
      const job = jobs.get(m[1]);
      if (!job) return json(res, 404, { error: 'job not found or expired' });
      return json(res, 200, {
        ok: true,
        id: job.id,
        status: job.status,
        stage: job.stage,
        percent: job.percent,
        speed: job.speed,
        eta: job.eta,
        downloaded: job.downloaded,
        total: job.total,
        size: job.size,
        ext: job.ext,
        fileName: job.fileName,
        fileId: job.fileId,
        error: job.error
      });
    }

    m = /^\/job\/([a-f0-9-]+)\/cancel$/i.exec(p);
    if (m && req.method === 'POST') {
      const ok = cancelJob(m[1]);
      return json(res, ok ? 200 : 404, { ok: ok });
    }

    m = /^\/file\/([a-f0-9-]+)$/i.exec(p);
    if (m && (req.method === 'GET' || req.method === 'HEAD')) return serveFile(req, res, m[1]);
    if (m && req.method === 'DELETE') {
      const f = files.get(m[1]);
      if (f) {
        files.delete(m[1]);
        cleanupDir(path.dirname(f.path));
      }
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: 'not found' });
  } catch (e) {
    return json(res, 400, { error: e.message || 'request failed' });
  }
});

initDirs();
refreshTools(true).then(function () {
  server.listen(PORT, HOST, function () {
    console.log('downrabbit bridge ' + VERSION + ' -> http://' + HOST + ':' + PORT);
    console.log('yt-dlp: ' + (ytdlpVersion || 'NOT FOUND') + '   ffmpeg: ' + (ffmpegVersion || 'NOT FOUND'));
    if (!ytdlpVersion) console.log('run bridge/setup.ps1 (Windows) or install yt-dlp');
    maybeAutoUpdate();
  });
});
const cleanupTimer = setInterval(cleanup, 10 * 60 * 1000);
if (cleanupTimer.unref) cleanupTimer.unref();

function shutdown() {
  for (const job of jobs.values()) {
    if (job.proc) killTree(job.proc);
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
