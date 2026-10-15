// Lumora desktop app (Electron). Opens the same web app that GitHub Pages serves, from
// files bundled inside the app, so it works with no internet connection.
//
// The files are served over a private app:// address rather than file://, because the
// app's JavaScript modules and background loader (a Web Worker) don't run from file://.

const { app, BrowserWindow, Menu, net, protocol, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const WEB_ROOT = path.join(__dirname, 'www');
const SCHEME = 'app';
const HOST = 'lumora';

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

async function serve(request) {
  const { pathname } = new URL(request.url);
  const relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const file = path.normalize(path.join(WEB_ROOT, relative));
  // Never serve anything outside the bundled web app.
  if (file !== WEB_ROOT && !file.startsWith(WEB_ROOT + path.sep)) return new Response('Not found', { status: 404 });
  try {
    const response = await net.fetch(pathToFileURL(file).toString());
    const type = TYPES[path.extname(file).toLowerCase()];
    if (!type) return response;
    return new Response(response.body, { status: response.status, headers: { 'content-type': type } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 380,
    minHeight: 500,
    title: 'Lumora',
    backgroundColor: '#011132',
    icon: path.join(WEB_ROOT, 'assets', 'logo-512.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // Links to websites (help pages, GitHub) open in the normal browser, not inside Lumora.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${SCHEME}://${HOST}/`)) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  win.loadURL(`${SCHEME}://${HOST}/index.html`);
}

// Only one Lumora window set: opening the app again focuses the existing one.
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    protocol.handle(SCHEME, serve);
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
