/**
 * One frontend, three runtimes. Business logic never asks "am I Electron?" —
 * it talks to this interface. Electron uses the preload bridge, Tauri uses
 * whitelisted commands, a plain browser falls back to <input type=file> + download.
 */
export interface FilePayload { name: string; text: string }
export interface SaveResult { ok: boolean; canceled?: boolean; path?: string; bytes?: number }

export interface RuntimeBridge {
  kind: 'electron' | 'tauri' | 'web';
  isDesktop: boolean;
  label: string;
  openFiles(): Promise<FilePayload[]>;
  saveText(defaultName: string, text: string): Promise<SaveResult>;
  saveBinary(defaultName: string, base64: string): Promise<SaveResult>;
  /** native OS drag & drop of files onto the window (Tauri); Electron/web use HTML5 */
  supportsNativeDrop: boolean;
  onNativeDrop?(handlers: {
    enter: () => void;
    over?: () => void;
    leave: () => void;
    drop: (paths: string[]) => void;
  }): void;
  readPaths(paths: string[]): Promise<FilePayload[]>;
  writeDiag(path: string, content: string): Promise<boolean>;
  benchConfig(): Promise<{
    enabled: boolean; fixturePath?: string; outPath?: string;
    selfTest?: boolean; selfTestOut?: string; selfTestBad?: string; selfTestVariant?: string;
  } | null>;
  onMenu?(cb: (action: string) => void): void;
  onImport?(cb: (items: FilePayload[]) => void): void;
}

type ElectronBridge = {
  isElectron: boolean;
  open: () => Promise<FilePayload[]>;
  saveText: (n: string, t: string) => Promise<SaveResult>;
  saveBinary: (n: string, b: string) => Promise<SaveResult>;
  onImport: (cb: (items: FilePayload[]) => void) => void;
  onMenu: (cb: (a: string) => void) => void;
};

function electronBridge(native: ElectronBridge): RuntimeBridge {
  return {
    kind: 'electron',
    isDesktop: true,
    label: 'Electron',
    openFiles: () => native.open(),
    saveText: (n, t) => native.saveText(n, t),
    saveBinary: (n, b) => native.saveBinary(n, b),
    supportsNativeDrop: false,
    readPaths: async () => [],
    writeDiag: async () => false,
    benchConfig: async () => (window as unknown as { __BENCH__?: { enabled: boolean; fixturePath?: string; outPath?: string } }).__BENCH__ ?? null,
    onImport: (cb) => native.onImport(cb),
    onMenu: (cb) => native.onMenu(cb),
  };
}

function webBridge(): RuntimeBridge {
  return {
    kind: 'web',
    isDesktop: false,
    label: 'Browser',
    openFiles: async () => new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = '.svg,.xml';
      input.onchange = async () => {
        const out: FilePayload[] = [];
        for (const f of Array.from(input.files ?? [])) out.push({ name: f.name, text: await f.text() });
        resolve(out);
      };
      input.click();
    }),
    saveText: async (name, text) => {
      const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      return { ok: true, path: name, bytes: text.length };
    },
    saveBinary: async (name, base64) => {
      const bin = atob(base64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([buf], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      return { ok: true, path: name, bytes: buf.length };
    },
    supportsNativeDrop: false,
    readPaths: async () => [],
    writeDiag: async () => false,
    benchConfig: async () => null,
  };
}

/** Tauri 2: commands + native drag-drop events, loaded lazily so the browser build stays small. */
async function tauriBridge(): Promise<RuntimeBridge> {
  const core = await import('@tauri-apps/api/core');
  const invoke = core.invoke;
  const listeners: { enter: () => void; over?: () => void; leave: () => void; drop: (p: string[]) => void }[] = [];
  const webview = await import('@tauri-apps/api/webview');
  void webview.getCurrentWebview().onDragDropEvent((event) => {
    const p = event.payload as { type: string; paths?: string[] };
    for (const l of listeners) {
      if (p.type === 'enter') l.enter();
      else if (p.type === 'over') l.over?.();
      else if (p.type === 'leave') l.leave();
      else if (p.type === 'drop') l.drop(p.paths ?? []);
    }
  });
  return {
    kind: 'tauri',
    isDesktop: true,
    label: 'Tauri',
    openFiles: () => invoke<FilePayload[]>('open_files'),
    saveText: (n, t) => invoke<SaveResult>('save_text', { defaultName: n, text: t }),
    saveBinary: (n, b) => invoke<SaveResult>('save_binary', { defaultName: n, base64: b }),
    supportsNativeDrop: true,
    onNativeDrop: (h) => { listeners.push(h); },
    readPaths: (paths) => invoke<FilePayload[]>('read_files', { paths }),
    writeDiag: (path, content) => invoke<boolean>('write_diag', { path, content }),
    benchConfig: () => invoke<{ enabled: boolean; fixturePath?: string; outPath?: string; selfTest?: boolean; selfTestOut?: string; selfTestBad?: string; selfTestVariant?: string }>('bench_config'),
  };
}

let cached: RuntimeBridge | null = null;
export async function getBridge(): Promise<RuntimeBridge> {
  if (cached) return cached;
  const el = (window as unknown as { studio?: ElectronBridge }).studio;
  if (el?.isElectron) cached = electronBridge(el);
  else if ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) cached = await tauriBridge();
  else cached = webBridge();
  return cached;
}
export function bridgeSyncKind(): 'electron' | 'tauri' | 'web' {
  if ((window as unknown as { studio?: ElectronBridge }).studio?.isElectron) return 'electron';
  if ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return 'tauri';
  return 'web';
}
