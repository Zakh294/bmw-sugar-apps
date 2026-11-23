'use strict';
/**
 * overlay.js - DeX on the centre screen: a renderer layer (render.js) over the whole 1920 x 720 display, showing the
 * phone's virtual display (the video dexdec writes) right of the HMI's back-arrow column, and a small menu button
 * at the bottom of that column (back to DeX Drive's own page). The column above it stays the HMI's, see-through:
 * its back arrow leaves DeX as it leaves any app. Touches on the picture go to the phone as fingers (every finger,
 * multi-touch); the iDrive controller's knob scrolls.
 *
 *   const ov = new Overlay(log, { touch(a, id, nx, ny), scroll(nx, ny, dy), menu() });
 *   ov.start(); ov.setVideo(w, h); ov.want(true); ov.update();
 */
const { Render, Ops } = require('./render');

const VIDEO_FILE = '/dev/shm/mgu-video-dexdrive';
const VIDEO_ID = 1;
const SCREEN = { w: 1920, h: 720 };
// the HMI's back-arrow column (iDrive 7, measured by the MGU App Kit: x 0..84, its content down to y 530)
const LEFT = 84;
const PICTURE = { x: LEFT, y: 0, w: SCREEN.w - LEFT, h: SCREEN.h };
const MENU = { x: 8, y: 636, w: 68, h: 68 };

/** The virtual display's size for the picture area: the encoder's sizes are multiples of 8. */
function displaySize() {
    return { w: Math.floor(PICTURE.w / 8) * 8, h: Math.floor(PICTURE.h / 8) * 8 };
}

/** Where a video of vw x vh sits in rect r (fitted, aspect kept, centred), as the renderer draws op VIDEO. */
function fitted(vw, vh, r) {
    if (!vw || !vh) return { x: r.x, y: r.y, w: r.w, h: r.h };
    const k = Math.min(r.w / vw, r.h / vh);
    const w = vw * k, h = vh * k;
    return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

/** A point on the layer (logical px = screen px) as 0..1 of the video, or null outside the picture. */
function toVideo(x, y, vw, vh) {
    const f = fitted(vw, vh, PICTURE);
    const nx = (x - f.x) / f.w, ny = (y - f.y) / f.h;
    return { nx: Math.max(0, Math.min(1, nx)), ny: Math.max(0, Math.min(1, ny)), inside: nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1 };
}

function inRect(x, y, r) { return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h; }

/** The layer's picture: see-through column, black under the video, the video, the menu button. */
function frameOps() {
    const o = new Ops();
    o.clear(0x00000000);
    o.rect(PICTURE.x, PICTURE.y, PICTURE.w, PICTURE.h, 0x000000ff);
    o.video(VIDEO_ID, PICTURE.x, PICTURE.y, PICTURE.w, PICTURE.h, 0);
    o.rrect(MENU.x, MENU.y, MENU.w, MENU.h, 16, 0x1c2633f0);
    // a 2 x 2 grid: "the app's menu"
    const s = 14, g = 6, x0 = MENU.x + (MENU.w - 2 * s - g) / 2, y0 = MENU.y + (MENU.h - 2 * s - g) / 2;
    [[0, 0], [1, 0], [0, 1], [1, 1]].forEach((p) => o.rrect(x0 + p[0] * (s + g), y0 + p[1] * (s + g), s, s, 3, 0xffffffff));
    return o;
}

/** Knob counter steps between two readings (u16, wrapping). */
function knobDelta(prev, now) {
    let d = (now - prev) & 0xffff;
    if (d > 0x7fff) d -= 0x10000;
    return d;
}

class Overlay {
    constructor(log, handlers) {
        this.log = log;
        this.h = handlers;
        this.r = new Render('dex_drive', log);
        this.info = null;
        this.connected = false;
        this.wanted = false;
        this.knobOn = true;
        this.vw = 0; this.vh = 0;
        this.fingers = new Map();        // finger id -> 'video' | 'menu'
        this.lastPoint = { nx: 0.5, ny: 0.5 };
        this.knob = null;
        this.keep = null;
        this.shown = false;
    }

    start() {
        const r = this.r;
        r.on('ready', (info) => {
            this.connected = true;
            this.info = info;
            this.log.info('renderer: ' + JSON.stringify(info));
            r.place({ x: 0, y: 0, w: SCREEN.w, h: SCREEN.h });
            r.video(VIDEO_ID, VIDEO_FILE);
            r.claim([PICTURE, MENU]);
            if (info && info.fingers) r.fingers(true);
            this.update();
        });
        r.on('gone', () => { this.connected = false; this.shown = false; this.fingers.clear(); this._keep(false); });
        r.on('finger', (phase, id, x, y) => this._finger(phase, id, x, y));
        // a renderer without X_FINGERS: the first finger only
        r.on('touch', (phase, x, y) => this._finger(phase, 0, x, y));
        r.on('closed', () => {
            // the HMI was touched outside our claims (its back arrow): it takes the screen back
            this.log.info('overlay: closed by a touch on the HMI');
            this.shown = false;
            this._release();
            if (this.h.closed) this.h.closed();
        });
        r.on('ccu', (c) => this._ccu(c));
        r.connect();
    }

    /** Status for the page: null when all is well, else 'no_renderer' / 'no_video'. */
    problem() {
        if (!this.connected && !Render.available()) return 'no_renderer';
        if (this.connected && (!this.info || !this.info.video)) return 'no_video';
        return null;
    }

    setVideo(w, h) { this.vw = w | 0; this.vh = h | 0; }
    setKnob(on) { this.knobOn = !!on; this.update(); }

    /** Show the layer (when it can be shown) or hide it. */
    want(on) { this.wanted = !!on; this.update(); }

    update() {
        const can = this.connected && this.info && this.info.video;
        const show = !!(this.wanted && can);
        if (show) {
            this.r.frame(frameOps());
            this.r.show(true);
            // the knob scrolls; the press is held too, so it never presses a button of the page under the picture
            this.r.grab(this.knobOn && this.info.controller, ['knob', 'press']);
        } else {
            this.r.show(false);
            this._release();
        }
        if (show !== this.shown) this.log.info('overlay ' + (show ? 'shown' : 'hidden'));
        this.shown = show;
        this._keep(show);
    }

    // a shown app sends at least one message a second, or the renderer takes it for hung
    _keep(on) {
        if (on && !this.keep) this.keep = setInterval(() => { if (this.shown) this.r.frame(frameOps()); }, 500);
        if (!on && this.keep) { clearInterval(this.keep); this.keep = null; }
    }

    _release() {
        this.r.grab(false);
        this.knob = null;
        // fingers still down on the phone are lifted there
        this.fingers.forEach((where, id) => { if (where === 'video') this.h.touch('cancel', id, this.lastPoint.nx, this.lastPoint.ny); });
        this.fingers.clear();
    }

    _finger(phase, id, x, y) {
        if (phase === 'down') {
            if (inRect(x, y, MENU)) { this.fingers.set(id, 'menu'); return; }
            this.fingers.set(id, 'video');
        }
        const where = this.fingers.get(id);
        if (!where) return;
        if (where === 'menu') {
            if (phase === 'up') { this.fingers.delete(id); if (inRect(x, y, MENU) && this.h.menu) this.h.menu(); }
            if (phase === 'cancel') this.fingers.delete(id);
            return;
        }
        const p = toVideo(x, y, this.vw, this.vh);
        this.lastPoint = p;
        this.h.touch(phase, id, p.nx, p.ny);
        if (phase === 'up' || phase === 'cancel') this.fingers.delete(id);
    }

    _ccu(c) {
        if (!this.knobOn || !this.shown) return;
        if (this.knob === null) { this.knob = c.knob; return; }
        const d = knobDelta(this.knob, c.knob);
        this.knob = c.knob;
        // a turn clockwise moves the content up, as a wheel turned towards you
        if (d) this.h.scroll(this.lastPoint.nx, this.lastPoint.ny, -d);
    }

    stop() { this._keep(false); this.r.close(); }
}

module.exports = { Overlay, displaySize, toVideo, fitted, frameOps, knobDelta, PICTURE, MENU, VIDEO_FILE };
