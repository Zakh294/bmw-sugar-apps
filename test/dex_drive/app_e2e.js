'use strict';
/**
 * DeX Drive's app end to end on a PC: the built app (kit/tools/build.py --preview-only dex_drive) runs in the kit's
 * stubbed head unit (preview.js) against a fake dex-drive-d (its control socket) and a fake mgu-render (the native
 * dialect: X_READY with video and fingers). Checks: Open starts DeX with the display the settings describe; once the
 * service streams, the picture is placed, named, claimed and shown; a finger on the picture reaches the service as
 * a touch in the video's 0..1; the menu button hides the picture again.
 *   python3 kit/tools/build.py --preview-only dex_drive && node test/dex_drive/app_e2e.js
 */
const assert = require('assert');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const STAGE = path.join(ROOT, 'dist', 'dex_drive');
if (!fs.existsSync(STAGE)) { console.error('build first: python3 kit/tools/build.py --preview-only dex_drive'); process.exit(2); }
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dexe2e-'));
const CTL = path.join(dir, 'ctl.sock'), REN = path.join(dir, 'render.sock');

const got = { ctl: [], render: [], shows: [] };
// ---- fake dex-drive-d ----
let ctlConn = null;
const ctlSrv = net.createServer((c) => {
    ctlConn = c;
    c.write(JSON.stringify({ ev: 'status', state: 'idle' }) + '\n');
    let buf = '';
    c.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            const m = JSON.parse(buf.slice(0, i));
            buf = buf.slice(i + 1);
            if (m.cmd !== 'ping') got.ctl.push(m);
            if (m.cmd === 'start') {
                setTimeout(() => c.write(JSON.stringify({ ev: 'status', state: 'connecting', msg: 'x' }) + '\n'), 50);
                setTimeout(() => c.write(JSON.stringify({ ev: 'status', state: 'streaming', device: 'SM-FAKE', via: 'usb', w: 1832, h: 720 }) + '\n'), 150);
                // the decoder makes the video file once its first frame is out: after the status says streaming
                setTimeout(() => c.write(JSON.stringify({ ev: 'frames', w: 1832, h: 720 }) + '\n'), 600);
            }
        }
    });
}).listen(CTL);
// ---- fake mgu-render ----
let renConn = null;
function rmsg(type, words) {
    const b = Buffer.alloc(8 + words.length * 4);
    b.writeUInt32LE(type, 0); b.writeUInt32LE(words.length * 4, 4);
    words.forEach((w, i) => (typeof w === 'number' && !Number.isInteger(w) ? b.writeFloatLE(w, 8 + i * 4) : b.writeUInt32LE(w >>> 0, 8 + i * 4)));
    return b;
}
function finger(phase, id, x, y) {
    const b = Buffer.alloc(24);
    b.writeUInt32LE(0x4d520104, 0); b.writeUInt32LE(16, 4);
    b.writeUInt32LE(phase, 8); b.writeUInt32LE(id, 12); b.writeFloatLE(x, 16); b.writeFloatLE(y, 20);
    renConn.write(b);
}
const renSrv = net.createServer((c) => {
    renConn = c;
    let buf = Buffer.alloc(0);
    c.on('data', (d) => {
        buf = Buffer.concat([buf, d]);
        while (buf.length >= 8) {
            const type = buf.readUInt32LE(0), len = buf.readUInt32LE(4);
            if (buf.length < 8 + len) break;
            const p = buf.slice(8, 8 + len);
            buf = buf.slice(8 + len);
            got.render.push({ type, p });
            if (type === 1) {
                // X_READY: version 1, layer mode, caps touch|controller|video|fingers|hold, boxes, side, refresh
                const x = Buffer.alloc(52);
                x.writeUInt32LE(1, 0); x.writeUInt32LE(1, 4); x.writeUInt32LE(1 | 2 | 16 | 64 | 128, 8);
                const h = Buffer.alloc(8); h.writeUInt32LE(0x4d520101, 0); h.writeUInt32LE(52, 4);
                c.write(Buffer.concat([h, x]));
                c.write(rmsg(101, [4, 1920, 720, 1]));
            }
            if (type === 3) got.shows.push(p.readUInt32LE(0));
        }
    });
}).listen(REN);

const env = Object.assign({}, process.env, { DEX_DRIVE_CTL: CTL, MGU_RENDERD_SOCKET: REN });
const child = spawn(process.execPath, [path.join(ROOT, 'kit', 'tools', 'preview.js'), STAGE, path.join(dir, 'out'), 'wait=1', 'BTN_OPEN', 'wait=6'],
    { env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '';
child.stdout.on('data', (d) => { out += d; });
child.stderr.on('data', (d) => { out += d; });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, fn, ms) {
    const t0 = Date.now();
    while (Date.now() - t0 < (ms || 5000)) { if (fn()) return; await wait(50); }
    throw new Error('timed out: ' + what + '\n' + out.split('\n').slice(-25).join('\n'));
}

(async () => {
    try {
        await until('start', () => got.ctl.some((m) => m.cmd === 'start'), 8000);
        const start = got.ctl.find((m) => m.cmd === 'start');
        assert.deepStrictEqual([start.w, start.h, start.dpi, start.fps, start.bitrate, start.tcp], [1832, 720, 160, 30, 8000000, 'auto']);
        console.log('ok  Open starts DeX: ' + JSON.stringify(start));
        await until('picture shown', () => got.shows.indexOf(1) >= 0, 5000);
        const types = got.render.map((r) => r.type);
        [1, 0x4d520001, 2, 13, 9, 0x4d520006, 7, 0x4d520002].forEach((t) => assert.ok(types.indexOf(t) >= 0, 'renderer message ' + t.toString(16)));
        const place = got.render.find((r) => r.type === 2).p;
        assert.deepStrictEqual([place.readInt32LE(0), place.readInt32LE(4), place.readInt32LE(8), place.readInt32LE(12)], [0, 0, 1920, 720]);
        const video = got.render.find((r) => r.type === 13).p;
        assert.strictEqual(video.slice(4).toString().replace(/\0+$/, ''), '/dev/shm/mgu-video-dexdrive');
        // the renderer opens the file when it is named: named again once the decoder has made it
        await until('video named again after the file is made', () => got.render.filter((r) => r.type === 13).length >= 3);
        const frame = got.render.filter((r) => r.type === 7).pop().p;
        let hasVideoOp = false;
        for (let i = 0; i + 4 <= frame.length; i += 4) if (frame.readUInt32LE(i) === 19 && frame.readUInt32LE(i + 24) === 1) hasVideoOp = true;
        assert.ok(hasVideoOp, 'the frame draws the video');
        const grab = got.render.filter((r) => r.type === 0x4d520002).pop().p;
        assert.deepStrictEqual([grab.readUInt32LE(0), grab.readUInt32LE(4)], [1, 7], 'knob, press and tilt held');
        console.log('ok  the picture is placed, named, claimed and shown');
        // a finger in the middle of the picture, then the menu button
        finger(1, 0, 84 + 918, 360); finger(2, 0, 84 + 920, 370); finger(3, 0, 84 + 920, 370);
        await until('touches', () => got.ctl.filter((m) => m.cmd === 'touch').length >= 3);
        const t = got.ctl.filter((m) => m.cmd === 'touch');
        assert.deepStrictEqual(t.map((m) => m.a), ['down', 'move', 'up']);
        assert.ok(Math.abs(t[0].x - 0.5) < 0.002 && Math.abs(t[0].y - 0.5) < 0.002, JSON.stringify(t[0]));
        console.log('ok  a finger reaches the phone: ' + JSON.stringify(t[0]));
        // the controller: knob turn, press (a click where the last touch was), tilt (an arrow key)
        const ccu = (seq, knob, press, tilt) => {
            const b = Buffer.alloc(16);
            b.writeUInt32LE(0x4d520103, 0); b.writeUInt32LE(8, 4);
            b[8] = seq; b.writeUInt16BE(knob, 9); b[11] = press; b[12] = tilt;
            renConn.write(b);
        };
        ccu(1, 300, 0, 0); ccu(2, 301, 0, 0); ccu(3, 301, 1, 0); ccu(4, 301, 0, 0); ccu(5, 301, 0, 7); ccu(6, 301, 0, 0);
        await until('controller', () => got.ctl.some((m) => m.cmd === 'key'));
        await wait(100);
        const c = got.ctl.filter((m) => m.cmd === 'scroll' || m.cmd === 'mouse' || m.cmd === 'key');
        assert.deepStrictEqual(c.map((m) => m.cmd + ':' + (m.a || m.dy || m.code)), ['scroll:-1', 'mouse:down', 'mouse:up', 'key:20']);
        assert.ok(Math.abs(c[1].x - 0.501) < 0.003, 'the click where the finger was: ' + JSON.stringify(c[1]));
        console.log('ok  the controller: knob scrolls, press clicks, tilt is an arrow key');
        const shows = got.shows.length;
        finger(1, 1, 40, 670); finger(3, 1, 40, 670);
        await until('picture hidden by the menu button', () => got.shows.slice(shows).indexOf(0) >= 0);
        assert.strictEqual(got.ctl.filter((m) => m.cmd === 'touch').length, 3, 'the menu button is not a touch on the phone');
        console.log('ok  the menu button hides the picture');
        console.log('app e2e passed');
        child.kill();
        process.exit(0);
    } catch (e) {
        console.error(e.message || e);
        child.kill();
        process.exit(1);
    }
})();
