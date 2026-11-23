#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (C) 2026 Zakhar Vityk
"""Builds dexdec for the head unit (x86-64, glibc 2.27, no /lib64) with zig, and checks it.

    python3 native/dex_drive/dexdec/tools/build.py            # -> native/dex_drive/prebuilt/dexdec
    python3 native/dex_drive/dexdec/tools/build.py --fake     # host test build (no Media SDK) -> build/dexdec-fake

Needs zig 0.13 or later (`pip install ziglang`, run as `python3 -m ziglang`) and binutils' readelf.
Nothing is copied from the unit: the binary links the unit's /usr/lib/libmfxhw64.so, libva.so.1 and libva-drm.so.1
at run time, against link-only stubs made here from abi/*.symbols (their exports, from RideTube's ytdec).
The check: every MFX / va import is exported by the unit's library, every glibc symbol version is 2.27 or older,
the program interpreter is /lib/ld-linux-x86-64.so.2 and only the unit's libraries are needed.
"""
import os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'src')
ABI = os.path.join(HERE, '..', 'abi')
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
BUILD = os.path.join(ROOT, 'build', 'dexdec')
OUT = os.path.abspath(os.path.join(HERE, '..', '..', 'prebuilt', 'dexdec'))
TARGET = 'x86_64-linux-gnu.2.27'
LIBS = [('libmfx.symbols', 'libmfxhw64.so'), ('libva.symbols', 'libva.so.1'), ('libva-drm.symbols', 'libva-drm.so.1')]
ALLOWED_NEEDED = {'libmfxhw64.so', 'libva.so.1', 'libva-drm.so.1', 'libdl.so.2', 'libpthread.so.0', 'libc.so.6',
                  'libm.so.6', 'ld-linux-x86-64.so.2', 'librt.so.1'}


def zig():
    z = shutil.which('zig')
    return [z] if z else [sys.executable, '-m', 'ziglang']


def symbols(name):
    out = {}
    for line in open(os.path.join(ABI, name)):
        line = line.split('#')[0].strip()
        if line:
            n, kind, size = line.split()[:3]
            out[n] = (kind, int(size))
    return out


def stubs():
    os.makedirs(BUILD, exist_ok=True)
    made = []
    for sym, soname in LIBS:
        c = os.path.join(BUILD, soname + '.c')
        with open(c, 'w') as f:
            f.write('/* link-only stub of the unit\'s %s (abi/%s) */\n' % (soname, sym))
            for n, (kind, size) in sorted(symbols(sym).items()):
                f.write('void %s(void) {}\n' % n if kind == 'FUNC' else 'const unsigned char %s[%d] = {0};\n' % (n, max(size, 1)))
        so = os.path.join(BUILD, soname)
        subprocess.check_call(zig() + ['cc', '-target', TARGET, '-shared', '-Wl,-soname,' + soname, '-o', so, c])
        made.append(so)
    return made


def set_interp(path, interp=b'/lib/ld-linux-x86-64.so.2'):
    """The unit has no /lib64: rewrite PT_INTERP in place (the new path is shorter)."""
    data = bytearray(open(path, 'rb').read())
    old = b'/lib64/ld-linux-x86-64.so.2'
    i = data.find(old + b'\0')
    if i < 0:
        if data.find(interp + b'\0') >= 0:
            return
        sys.exit('no ELF interpreter %s in %s' % (old.decode(), path))
    data[i:i + len(old) + 1] = interp + b'\0' * (len(old) + 1 - len(interp))
    open(path, 'wb').write(bytes(data))


def readelf(*args):
    return subprocess.check_output(['readelf', '-W'] + list(args)).decode()


def check(path):
    problems = []
    interp = re.search(r'Requesting program interpreter: ([^\]]+)\]', readelf('-l', path))
    if not interp or interp.group(1) != '/lib/ld-linux-x86-64.so.2':
        problems.append('interpreter %s' % (interp.group(1) if interp else 'none'))
    needed = re.findall(r'\(NEEDED\)\s+Shared library: \[([^\]]+)\]', readelf('-d', path))
    for n in needed:
        if n not in ALLOWED_NEEDED:
            problems.append('needs %s, which the unit may not have' % n)
    exported = {}
    for sym, _ in LIBS:
        exported.update(symbols(sym))
    imports = 0
    for line in readelf('--dyn-syms', path).splitlines():
        m = re.match(r'\s*\d+:\s+[0-9a-f]+\s+\d+\s+(\w+)\s+\w+\s+\w+\s+UND\s+(\S+)', line)
        if not m:
            continue
        name = m.group(2)
        base, _, ver = name.partition('@')
        ver = ver.lstrip('@').split(' ')[0]
        g = re.match(r'GLIBC_(\d+)\.(\d+)', ver)
        if g and (int(g.group(1)), int(g.group(2))) > (2, 27):
            problems.append('%s needs %s (the unit has glibc 2.27)' % (base, ver))
        if re.match(r'(MFX|va)[A-Z_]', base):
            imports += 1
            if base not in exported:
                problems.append('imports %s, which the unit\'s libraries do not export' % base)
    for p in problems:
        print('FAIL  ' + p)
    if problems:
        sys.exit(1)
    print('OK    %s: %d Media SDK / VA imports, all exported by the unit; glibc <= 2.27; needs %s'
          % (os.path.relpath(path, ROOT), imports, ', '.join(needed)))


def main():
    fake = '--fake' in sys.argv
    srcs = [os.path.join(SRC, f) for f in (['main.cpp', 'mgvf.cpp'] if fake else
                                            ['main.cpp', 'mgvf.cpp', 'decoder_msdk.cpp', 'nal_reader.cpp'])]
    flags = ['-std=c++14', '-O2', '-Wall', '-Wextra', '-Werror', '-DNDEBUG', '-I' + SRC, '-I' + os.path.join(ABI, 'include')]
    os.makedirs(BUILD, exist_ok=True)
    if fake:
        out = os.path.join(BUILD, 'dexdec-fake')
        cxx = os.environ.get('CXX', 'c++')
        subprocess.check_call([cxx] + flags + ['-DDEXDEC_FAKE', '-o', out] + srcs)
        print('built ' + os.path.relpath(out, ROOT))
        return
    libs = stubs()
    tmp = os.path.join(BUILD, 'dexdec')
    subprocess.check_call(zig() + ['c++', '-target', TARGET, '-s'] + flags + ['-o', tmp] + srcs + libs + ['-ldl', '-lpthread'])
    set_interp(tmp)
    check(tmp)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    shutil.copyfile(tmp, OUT)
    os.chmod(OUT, 0o755)
    print('built ' + os.path.relpath(OUT, ROOT))


if __name__ == '__main__':
    main()
