// velox :: cdp/discovery.js — find any Chromium-family browser on the system.
// No downloads, no bundled browser: use what the machine already has.
import { accessSync, constants } from 'node:fs';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const NIX = [
  'google-chrome', 'google-chrome-stable', 'google-chrome-beta', 'google-chrome-unstable',
  'chromium', 'chromium-browser', 'chrome-headless-shell',
  'microsoft-edge', 'microsoft-edge-stable', 'msedge',
  'brave-browser', 'brave-browser-stable', 'vivaldi', 'vivaldi-stable', 'vivaldi-snapshot',
  'opera', 'opera-stable', 'thorium-browser', 'ungoogled-chromium', 'chromium-vaapi',
];
const NIX_PATHS = [
  '/usr/bin', '/usr/local/bin', '/bin', '/opt/google/chrome', '/snap/bin',
  '/usr/bin/microsoft-edge', '/opt/brave.com/brave', '/opt/vivaldi', '/opt/opera',
];
const MAC_APPS = [
  'Google Chrome', 'Chromium', 'Microsoft Edge', 'Brave Browser', 'Vivaldi', 'Opera',
  'Opera GX', 'Thorium', 'Arc', 'Dia', 'Orion',
];
const WIN_PARTS = [
  ['Google/Chrome/Application', 'chrome.exe'],
  ['Google/Chrome Beta/Application', 'chrome.exe'],
  ['Google/Chrome SxS/Application', 'chrome.exe'],
  ['Chromium/Application', 'chrome.exe'],
  ['Microsoft/Edge/Application', 'msedge.exe'],
  ['BraveSoftware/Brave-Browser/Application', 'brave.exe'],
  ['Vivaldi/Application', 'vivaldi.exe'],
  ['Opera Software/stable', 'opera.exe'],
];

const exists = (p) => { try { accessSync(p, constants.X_OK); return true; } catch { return false; } };

function fromPath() {
  const out = [];
  for (const name of NIX) {
    try { const p = execSync(`command -v ${name} 2>/dev/null`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); if (p) out.push(p); }
    catch {}
  }
  return [...new Set(out)];
}

export function discoverBrowsers() {
  const found = new Map(); // path -> pretty name
  const add = (p, name) => { if (p && exists(p) && !found.has(p)) found.set(p, name); };
  const plat = process.platform;

  if (plat === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    for (const r of roots) for (const [dir, exe] of WIN_PARTS) add(`${r}\\${dir}\\${exe}`, dir.split('/').pop());
  } else if (plat === 'darwin') {
    for (const app of MAC_APPS) {
      const p = `/Applications/${app}.app/Contents/MacOS/${app === 'Google Chrome' ? 'Google Chrome' : app}`;
      add(p, app);
      add(`${homedir()}${p}`, app);
    }
  } else {
    for (const name of fromPath()) add(name, name);
    for (const dir of NIX_PATHS) for (const name of NIX) {
      const p = `${dir}/${name}`;
      if (exists(p)) {
        // snap wrappers are often dead in containers — verify they execute
        try { execSync(`"${p}" --version`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 }); add(p, name); }
        catch {}
      }
    }
    add(`${homedir()}/.cache/puppeteer/chrome-headless-shell`, 'chrome-headless-shell'); // scanned deeper below
    add('/usr/lib/chromium-browser/chromium-browser', 'chromium');
  }
  // snap wrappers work on desktops but frequently break inside containers —
  // deprioritize them when a native binary exists
  const list = [...found.entries()].map(([path, name]) => ({ path, name, snap: path.includes('/snap/') }));
  const hasNative = list.some((b) => !b.snap);
  return (hasNative ? list.filter((b) => !b.snap) : list);
}

export function findBrowser(pref) {
  const envBrowser = process.env.VELOX_BROWSER;
  const choice = pref || envBrowser || 'auto';
  if (choice && choice !== 'auto') {
    if (choice.includes('/') || choice.includes('\\')) {
      if (!exists(choice)) throw new Error(`Browser not found: ${choice}`);
      return choice;
    }
    const all = discoverBrowsers();
    const hit = all.find((b) => b.name === choice) || all.find((b) => b.name.includes(choice));
    if (hit) return hit.path;
    throw new Error(`Browser "${choice}" not found. Available: ${all.map((b) => b.name).join(', ') || 'none'}`);
  }
  const all = discoverBrowsers();
  // Prefer full browsers over shells (more compatible), then by preference order.
  const ORDER = ['google-chrome', 'chromium', 'microsoft-edge', 'brave-browser', 'vivaldi', 'opera', 'chrome-headless-shell'];
  for (const want of ORDER) {
    const hit = all.find((b) => b.name.includes(want));
    if (hit) return hit.path;
  }
  if (all.length) return all[0].path;
  throw new Error(
    'No Chromium-family browser found. Install any of: Chrome, Chromium, Edge, Brave, Vivaldi, Opera\n' +
    'or set VELOX_BROWSER=/path/to/browser, or use the lite engine (no browser needed): velox.open(url, { engine: "lite" })'
  );
}
