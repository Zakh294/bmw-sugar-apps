'use strict';
/**
 * render.js - DeX Drive's own small client for mgu-render (the Store's renderer), its native dialect mgu-render/1, as
 * mgu-render's PROTOCOL.md describes it: a layer over the centre screen in which the renderer shows the newest frame
 * of a video file another program writes (/dev/shm/mgu-video-<name>, "Video"), touch claims with every finger
 * (X_FINGERS), and the iDrive controller's knob (X_GRAB). Written for this app from the protocol description; Node 8.
 *
 *   const r = new Render('dex_drive', log);
 *   r.on('ready', (info) => { ... info.video, info.fingers ... });
 *   r.place({ x: 0, y: 0, w: 1920, h: 720 }); r.video(1, '/dev/shm/mgu-video-dexdrive'); r.claim([...]); r.fingers(true);
 *   r.frame(words); r.show(true);
 *
 * Events: ready (info), finger (phase, id, x, y), touch (phase, x, y), closed, state ({ onScreen, front }),
 * ccu ({ knob, press, tilt }), tick, error (text), gone.
 */
const net = require('net');
const fs = require('fs');
const EventEmitter = require('events');

const SOCKETS = ['/run/mgu-render/render.sock', '/run/mgu-renderd/renderd.sock'];
const T = { HELLO: 1, PLACE: 2, SHOW: 3, FRAME: 7, CLAIM: 9, VIDEO: 13, DROP_VIDEO: 14 };
const X = { MODE: 0x4d520001, GRAB: 0x4d520002, FINGERS: 0x4d520006, READY: 0x4d520101, STATE: 0x4d520102, CCU: 0x4d520103,
    FINGER: 0x4d520104 };
const E = { READY: 101, TICK: 102, ERROR: 103, TOUCH: 105, CLOSED: 106 };
const PHASE = [null, 'down', 'move', 'up', 'cancel'];
const CAP = { touch: 1, controller: 2, frontGate: 4, video: 16, fingers: 64, controllerHold: 128 };
const OP = { CLEAR: 1, RECT: 2, RRECT: 4, LINE: 9, VIDEO: 19 };
const HOLD = { knob: 1, press: 2, tilt: 4 };

function msg(type, payload) {
    const len = payload ? payload.length : 0;
    const b = Buffer.alloc(8 + len + ((4 - (len & 3)) & 3));
    b.writeUInt32LE(type, 0);
    b.writeUInt32LE(b.length - 8, 4);
    if (len) payload.copy(b, 8);
    return b;
}
function u32(type, values) {
    const p = Buffer.alloc(values.length * 4);
    values.forEach((v, i) => p.writeUInt32LE(v >>> 0, i * 4));
    return msg(type, p);
}

/** Draw ops as mgu-render reads them: f32 coordinates, u32 colours 0xRRGGBBAA. */
class Ops {
    constructor() { this.w = []; }
    _f(v) { const b = Buffer.alloc(4); b.writeFloatLE(v, 0); return b.readUInt32LE(0); }
    _c(c) { return c >>> 0; }
    clear(c) { this.w.push(OP.CLEAR, this._c(c)); return this; }
    rect(x, y, w, h, c) { this.w.push(OP.RECT, this._f(x), this._f(y), this._f(w), this._f(h), this._c(c)); return this; }
    rrect(x, y, w, h, r, c) { this.w.push(OP.RRECT, this._f(x), this._f(y), this._f(w), this._f(h), this._f(r), this._c(c)); return this; }
    line(xa, ya, xb, yb, width, c) {
        this.w.push(OP.LINE, this._f(xa), this._f(ya), this._f(xb), this._f(yb), this._f(width), this._c(c));
        return this;
    }
    /** the video's newest frame fitted into the rect (aspect kept, centred), corner radius r */
    video(id, x, y, w, h, r) { this.w.push(OP.VIDEO, this._f(x), this._f(y), this._f(w), this._f(h), this._f(r || 0), id >>> 0); return this; }
    buffer() {
        const b = Buffer.alloc(this.w.length * 4);
        this.w.forEach((v, i) => b.writeUInt32LE(v >>> 0, i * 4));
        return b;
    }
}

class Render extends EventEmitter {
    constructor(appId, log, opts) {
        super();
        this.appId = appId;
        this.log = log || console;
        this.opts = opts || {};
        this.sock = null;
        this.ready = false;
        this.native = false;
        this.info = null;
        this.placement = null;
        this.visible = false;
        this.claims = [];
        this.videos = new Map();
        this.wantFingers = false;
        this.grabbing = false;
        this.holdMask = 0;
        this.grabTimer = null;
        this.inbuf = Buffer.alloc(0);
        this.closed = false;
        this.retry = null;
        this.warned = false;
    }

    static available() {
        return (process.env.MGU_RENDERD_SOCKET ? [process.env.MGU_RENDERD_SOCKET] : SOCKETS).some((p) => { try { return fs.statSync(p).isSocket(); } catch (e) { return false; } });
    }

    connect(at) {
        const env = process.env.MGU_RENDERD_SOCKET;
        const paths = this.opts.socket ? [this.opts.socket] : env ? [env] : SOCKETS;
        const i = at || 0;
        let next = false, connected = false;
        const s = net.createConnection(paths[i]);
        this.sock = s;
        s.on('connect', () => {
            connected = true;
            s.setNoDelay(true);
            this._write(msg(T.HELLO, Buffer.concat([Buffer.from(this.appId), Buffer.from([0]), Buffer.from('proto=mgu-render/1')])));
        });
        s.on('data', (d) => this._data(d));
        s.on('error', (e) => {
            if (!connected && i + 1 < paths.length) { next = true; return; }
            if (!this.warned) { this.warned = true; this.log.warn('mgu-render: ' + e.message); }
        });
        s.on('close', () => {
            const was = this.ready;
            this.ready = this.native = false;
            this.sock = null;
            if (was) { this.log.warn('mgu-render: connection closed'); this.emit('gone'); }
            if (this.closed) return;
            if (next) this.connect(i + 1);
            else this.retry = setTimeout(() => { this.retry = null; this.connect(); }, 3000);
        });
        return this;
    }

    close() {
        this.closed = true;
        if (this.retry) clearTimeout(this.retry);
        if (this.grabTimer) clearInterval(this.grabTimer);
        if (this.sock) this.sock.destroy();
    }

    _write(b) { return this.sock && !this.sock.destroyed ? this.sock.write(b) : false; }

    _data(d) {
        this.inbuf = this.inbuf.length ? Buffer.concat([this.inbuf, d]) : d;
        while (this.inbuf.length >= 8) {
            const type = this.inbuf.readUInt32LE(0), len = this.inbuf.readUInt32LE(4);
            if (this.inbuf.length < 8 + len) break;
            const p = this.inbuf.slice(8, 8 + len);
            this.inbuf = this.inbuf.slice(8 + len);
            this._event(type, p);
        }
    }

    _event(type, p) {
        if (type === X.READY && p.length >= 12) {
            const caps = p.readUInt32LE(8), modes = p.readUInt32LE(4);
            this.native = true;
            this.info = {
                version: p.readUInt32LE(0), layer: !!(modes & 1), touch: !!(caps & CAP.touch), controller: !!(caps & CAP.controller),
                video: !!(caps & CAP.video), fingers: !!(caps & CAP.fingers), controllerHold: !!(caps & CAP.controllerHold),
            };
        } else if (type === E.READY) {
            this.ready = true;
            this.warned = false;
            if (!this.native) {
                this.log.warn('mgu-render: the renderer does not speak mgu-render/1 (an older renderer?)');
                this.emit('ready', null);
                return;
            }
            this._write(u32(X.MODE, [1]));
            if (this.placement) this._sendPlace();
            this.videos.forEach((file, id) => this._sendVideo(id, file));
            if (this.claims.length) this._sendClaim();
            if (this.wantFingers) this._write(u32(X.FINGERS, [1]));
            if (this.grabbing) this._write(this._grabMsg(1));
            if (this.visible) this._write(u32(T.SHOW, [1]));
            this.emit('ready', this.info);
        } else if (type === X.FINGER && p.length >= 16) {
            const ph = PHASE[p.readUInt32LE(0)];
            if (ph) this.emit('finger', ph, p.readUInt32LE(4), p.readFloatLE(8), p.readFloatLE(12));
        } else if (type === E.TOUCH && p.length >= 12) {
            const ph = PHASE[p.readUInt32LE(0)];
            if (ph) this.emit('touch', ph, p.readFloatLE(4), p.readFloatLE(8));
        } else if (type === E.CLOSED) {
            this.visible = false;
            this.emit('closed');
        } else if (type === X.STATE && p.length >= 12) {
            this.emit('state', { shown: !!p.readUInt32LE(0), onScreen: !!p.readUInt32LE(4), front: !!p.readUInt32LE(8) });
        } else if (type === X.CCU && p.length >= 5) {
            this.emit('ccu', { seq: p[0], knob: p.readUInt16BE(1), press: p[3], tilt: p[4] });
        } else if (type === E.TICK) {
            this.emit('tick');
        } else if (type === E.ERROR) {
            this.log.warn('mgu-render error: ' + p.toString().replace(/\0+$/, ''));
            this.emit('error-text', p.toString().replace(/\0+$/, ''));
        }
    }

    /** Where the layer goes, in screen pixels; drawn 1:1 (logical px = screen px from x, y). */
    place(r) {
        const same = this.placement && ['x', 'y', 'w', 'h'].every((k) => this.placement[k] === r[k]);
        if (same) return;
        const resize = !this.placement || this.placement.w !== r.w || this.placement.h !== r.h;
        this.placement = { x: r.x, y: r.y, w: r.w, h: r.h };
        if (!this.ready || !this.native) return;
        this._sendPlace();
        // a new size drops the renderer's videos: name them again
        if (resize) this.videos.forEach((file, id) => this._sendVideo(id, file));
    }
    _sendPlace() {
        const p = this.placement, b = Buffer.alloc(28);
        b.writeInt32LE(p.x | 0, 0); b.writeInt32LE(p.y | 0, 4); b.writeInt32LE(p.w | 0, 8); b.writeInt32LE(p.h | 0, 12);
        b.writeFloatLE(1, 16); b.writeFloatLE(0, 20); b.writeFloatLE(0, 24);
        this._write(msg(T.PLACE, b));
    }

    show(on) {
        on = !!on;
        if (on === this.visible) return;
        this.visible = on;
        if (this.ready && this.native) this._write(u32(T.SHOW, [on ? 1 : 0]));
    }

    /** Touch areas [{ x, y, w, h }] in logical px: while shown, touch there is ours. */
    claim(rects) {
        this.claims = (rects || []).slice(0, 16);
        if (this.ready && this.native) this._sendClaim();
    }
    _sendClaim() {
        const b = Buffer.alloc(4 + this.claims.length * 16);
        b.writeUInt32LE(this.claims.length, 0);
        this.claims.forEach((r, i) => [r.x, r.y, r.w, r.h].forEach((v, k) => b.writeFloatLE(v, 4 + i * 16 + k * 4)));
        this._write(msg(T.CLAIM, b));
    }

    fingers(on) {
        this.wantFingers = !!on;
        if (this.ready && this.native) this._write(u32(X.FINGERS, [on ? 1 : 0]));
    }

    /** The controller's parts (knob, press, tilt) to us while shown; renewed every 0.5 s as the renderer wants. */
    grab(on, parts) {
        on = !!on;
        const mask = (parts || []).reduce((m, k) => m | (HOLD[k] || 0), 0);
        if (on === this.grabbing && mask === this.holdMask) return;
        this.grabbing = on;
        this.holdMask = mask;
        if (this.grabTimer) { clearInterval(this.grabTimer); this.grabTimer = null; }
        if (on) this.grabTimer = setInterval(() => { if (this.ready && this.native) this._write(this._grabMsg(1)); }, 500);
        if (this.ready && this.native) this._write(this._grabMsg(on ? 1 : 0));
    }
    _grabMsg(on) { return u32(X.GRAB, on && this.holdMask ? [1, this.holdMask] : [on]); }

    /** Video `id` is the frame file `file` (/dev/shm/mgu-video-<name>); null forgets it. The renderer opens the file
     *  when it is named: a file made later (the player starts after) is named again with again = true. */
    video(id, file, again) {
        if (!file) {
            if (this.videos.delete(id) && this.ready && this.native) this._write(u32(T.DROP_VIDEO, [id]));
            return;
        }
        if (this.videos.get(id) === file && !again) return;
        this.videos.set(id, file);
        if (this.ready && this.native) this._sendVideo(id, file);
    }
    _sendVideo(id, file) {
        const head = Buffer.alloc(4);
        head.writeUInt32LE(id, 0);
        this._write(msg(T.VIDEO, Buffer.concat([head, Buffer.from(file), Buffer.from([0])])));
    }

    /** Send a frame (Ops). */
    frame(ops) {
        if (!this.ready || !this.native || !this.placement) return false;
        return this._write(msg(T.FRAME, ops.buffer()));
    }
}

module.exports = { Render, Ops, SOCKETS };
