const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');

const path = require('node:path');
const fs = require('node:fs/promises');

let win = null;
const send = (channel, ...args) => win?.webContents.send(channel, ...args);

function createWindow() {
  win = new BrowserWindow({
    width: 1500, height: 950, minWidth: 980, minHeight: 640,
    backgroundColor: '#eef1f6',
    title: 'IGV Studio',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(__dirname, '..', 'dist', 'IGV-Single-SVG-Studio.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.on('closed', () => { win = null; });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open SVG / Session…', accelerator: 'CmdOrCtrl+O', click: async () => {
            const picked = await openDialog();
            if (picked.length) send('studio:import', picked);
          } },
        { type: 'separator' },
        { label: 'Export Current SVG…', accelerator: 'CmdOrCtrl+E', click: () => send('studio:menu', 'export-svg') },
        { label: 'Export All (ZIP)…', accelerator: 'CmdOrCtrl+Shift+E', click: () => send('studio:menu', 'export-zip') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { label: 'Edit', submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => send('studio:menu', 'undo') },
      { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: () => send('studio:menu', 'redo') },
      { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ] },
    { label: 'View', submenu: [
      { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
      { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function openDialog() {
  const testFiles = process.env.IGV_TEST_OPEN_FILES;
  if (testFiles) {
    const out = [];
    for (const p of testFiles.split(path.delimiter).filter(Boolean)) {
      try { out.push({ name: path.basename(p), text: await fs.readFile(p, 'utf8') }); } catch {}
    }
    return out;
  }
  const res = await dialog.showOpenDialog(win, {
    title: 'Open IGV SVG / Session',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'IGV exports', extensions: ['svg', 'xml'] }],
  });
  if (res.canceled) return [];
  const out = [];
  for (const p of res.filePaths) {
    try { out.push({ name: path.basename(p), text: await fs.readFile(p, 'utf8') }); } catch (e) { /* skip unreadable */ }
  }
  return out;
}

ipcMain.handle('studio:open', async () => openDialog());

ipcMain.handle('studio:save-text', async (_e, { defaultName, text }) => {
  // test seam: with IGV_TEST_SAVE_DIR set, write straight to that directory (no modal dialog)
  const testDir = process.env.IGV_TEST_SAVE_DIR;
  if (testDir) {
    await fs.mkdir(testDir, { recursive: true });
    const filePath = path.join(testDir, defaultName);
    await fs.writeFile(filePath, text, 'utf8');
    const st = await fs.stat(filePath);
    return { ok: true, path: filePath, bytes: st.size };
  }
  const res = await dialog.showSaveDialog(win, {
    title: 'Export SVG',
    defaultPath: defaultName,
    filters: [{ name: 'SVG', extensions: ['svg'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  await fs.writeFile(res.filePath, text, 'utf8');
  const st = await fs.stat(res.filePath);
  return { ok: true, path: res.filePath, bytes: st.size };
});

ipcMain.handle('studio:save-binary', async (_e, { defaultName, base64 }) => {
  const testDir = process.env.IGV_TEST_SAVE_DIR;
  if (testDir) {
    await fs.mkdir(testDir, { recursive: true });
    const filePath = path.join(testDir, defaultName);
    const buf0 = Buffer.from(base64, 'base64');
    await fs.writeFile(filePath, buf0);
    return { ok: true, path: filePath, bytes: buf0.length };
  }
  const res = await dialog.showSaveDialog(win, {
    title: 'Export ZIP',
    defaultPath: defaultName,
    filters: [{ name: 'ZIP', extensions: ['zip'] }],
  });
  if (res.canceled || !res.filePath) return { ok: false, canceled: true };
  const buf = Buffer.from(base64, 'base64');
  await fs.writeFile(res.filePath, buf);
  return { ok: true, path: res.filePath, bytes: buf.length };
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(() => { buildMenu(); createWindow(); });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
