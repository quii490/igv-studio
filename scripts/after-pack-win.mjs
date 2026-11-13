#!/usr/bin/env node
/** Embed icon + version info into the packaged Windows exe without wine (pure JS PE editing). */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { NtExecutable, NtExecutableResource, Resource, Data } from 'resedit';

import { execFileSync } from 'node:child_process';

/** Ad-hoc sign the macOS bundle so Gatekeeper says "unidentified developer" (Open Anyway works)
 *  instead of "damaged". Without an Apple Developer ID this is the best that can be done. */
function adhocSignMac(context) {
  // during a universal build each arch is staged in "*-temp" first; signing there breaks the merge
  if (/-temp$/.test(path.basename(context.appOutDir))) return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  if (!existsSync(appPath)) return;
  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--identifier', 'org.igvstudio.app', appPath], { stdio: 'inherit' });
    const out = execFileSync('codesign', ['-dv', '--verbose=2', appPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    console.log('[afterPack] ad-hoc signed:', out.split('\n').filter((l) => /Identifier|Signature|TeamIdentifier/.test(l)).join(' | '));
  } catch (e) {
    console.warn('[afterPack] ad-hoc signing failed:', e.message);
  }
}

export default async function afterPack(context) {
  if (context.electronPlatformName === 'darwin') { adhocSignMac(context); return; }
  if (context.electronPlatformName !== 'win32') return;
  const dir = context.appOutDir;
  const exePath = path.join(dir, `${context.packager.appInfo.productFilename}.exe`);
  if (!existsSync(exePath)) { console.warn('[afterPack] exe not found:', exePath); return; }

  const exe = NtExecutable.from(readFileSync(exePath), { ignoreCert: true });
  const res = NtExecutableResource.from(exe);

  const icoPath = path.join(context.packager.projectDir, 'build', 'icon.ico');
  if (existsSync(icoPath)) {
    const iconFile = Data.IconFile.from(readFileSync(icoPath));
    const groups = Resource.IconGroupEntry.fromEntries(res.entries);
    const id = groups.length ? groups[0].id : 1;
    Resource.IconGroupEntry.replaceIconsForResource(res.entries, id, 1033,
      iconFile.icons.map((i) => i.data));
  }

  const viList = Resource.VersionInfo.fromEntries(res.entries);
  const pkg = JSON.parse(readFileSync(path.join(context.packager.projectDir, 'build-app', 'package.json'), 'utf8'));
  const version = `${pkg.version}.0`;
  if (viList.length) {
    const vi = viList[0];
    vi.setStringValues({ lang: 1033, codepage: 1200 }, {
      ProductName: 'IGV Studio', FileDescription: 'IGV Studio — IGV SVG figure editor',
      CompanyName: 'IGV Studio', LegalCopyright: 'IGV Studio', InternalName: 'IGV Studio',
      FileVersion: version, ProductVersion: version, OriginalFilename: 'IGV Studio.exe',
    });
    vi.outputToResourceEntries(res.entries);
  }
  res.outputResource(exe);
  writeFileSync(exePath, Buffer.from(exe.generate()));
  console.log('[afterPack] patched icon+version:', exePath);
}
