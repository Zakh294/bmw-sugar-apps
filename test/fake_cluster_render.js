'use strict';
/**
 * A stand-in for the car's cluster-render service (PROTOCOL.md of robertnisipeanu/idrive-apps), enough for the tests:
 * answers hello, keeps every layer's options, visibility and pixels, and reports "shown" for a visible layer.
 *   const srv = await start(socketPath);  srv.layers: Map ref -> { target, x, y, w, h, iw, ih, visible, klass, px, frames }
 */
const net = require('net');
const fs = require('fs');

function start(socketPath) {
    try { fs.unlinkSync(socketPath); } catch (e) { /* none */ }
    const layers = new Map();
    const log = [];
    const socks = [];
    const send = (sock, obj) => {
        const b = Buffer.from(JSON.stringify(obj), 'utf8');
        const m = Buffer.alloc(5 + b.length);
        m.writeUInt32LE(b.length + 1, 0); m[4] = 0x4a; b.copy(m, 5);
        sock.write(m);
    };
    const server = net.createServer((sock) => {
        socks.push(sock);
        let buf = Buffer.alloc(0);
        sock.on('data', (d) => {
            buf = Buffer.concat([buf, d]);
            let off = 0;
            while (buf.length - off >= 5) {
                const len = buf.readUInt32LE(off);
                if (buf.length - off < 4 + len) break;
                const type = buf[off + 4], body = buf.slice(off + 5, off + 4 + len);
                off += 4 + len;
                if (type === 0x4a) {
                    const m = JSON.parse(body.toString('utf8'));
                    log.push(m);
                    if (m.op === 'hello') send(sock, { ev: 'hello', proto: 1, backend: 'id7', targets: 'map:1088x480,panel:1920x720,hud:800x480' });
                    else if (m.op === 'layer') {
                        layers.set(m.ref, Object.assign({ frames: 0, px: Buffer.alloc(m.iw * m.ih * 4) }, m, { visible: m.visible === undefined ? 1 : m.visible }));
                    } else if (m.op === 'set') {
                        const l = layers.get(m.ref);
                        if (!l) continue;
                        Object.keys(m).forEach((k) => { if (k !== 'op' && k !== 'ref') l[k] = m[k]; });
                        if (m.visible !== undefined) send(sock, { ev: 'layer', ref: m.ref, state: m.visible ? 'shown' : 'hidden' });
                    }
                } else if (type === 0x46) {
                    const ref = body.readUInt32LE(0), n = body.readUInt16LE(12);
                    const l = layers.get(ref);
                    if (!l) continue;
                    let p = 14 + n * 8;
                    if (!n) body.copy(l.px, 0, p, p + l.iw * l.ih * 4);
                    else {
                        for (let i = 0; i < n; i++) {
                            const x = body.readUInt16LE(14 + i * 8), y = body.readUInt16LE(16 + i * 8), w = body.readUInt16LE(18 + i * 8), h = body.readUInt16LE(20 + i * 8);
                            for (let r = 0; r < h; r++) { body.copy(l.px, ((y + r) * l.iw + x) * 4, p, p + w * 4); p += w * 4; }
                        }
                    }
                    l.frames++;
                }
            }
            buf = buf.slice(off);
        });
        sock.on('error', () => {});
    });
    return new Promise((resolve) => server.listen(socketPath, () => resolve({ server, layers, log, emit: (ev) => socks.forEach((k) => send(k, ev)), close: () => { socks.forEach((k) => k.destroy()); server.close(); } })));
}

module.exports = { start };
