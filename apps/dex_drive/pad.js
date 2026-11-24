'use strict';
/**
 * pad.js - the iDrive controller's touchpad as a laptop touchpad for DeX:
 *   one finger moves DeX's pointer (faster when the finger moves faster), a short tap clicks,
 *   two fingers scroll (natural: the fingers go up, the content goes up), a tap with two fingers right-clicks.
 *
 * Input: ControllerElements.ZBETouchFrontSide, as the car sends it (what the field names and values mean is what
 * people measured in the car: RideTube's notes): statusSystemModeFrontSide 3 = the pad in touch mode (it sends
 * fingers only then), finger 1 at touchCoordinatesX1FrontSide / Y1, finger 2 at touchCcoordinatesX2FrontSide (sic) /
 * touchCoordinatesY2FrontSide, 0 / 0 = no finger, about 0..470 each way, Y grows upwards, ~50 samples a second
 * each sent twice; touchCoordinatesZ1FrontSide 2 = nothing on the pad whatever the coordinates say.
 * Written for DeX Drive; Node 8.
 *
 *   const pad = new Pad({ move(dx, dy) {}, click(button) {}, scroll(notches) {},
 *                         speed() { return 0.7; }, scrollSpeed() { return 0.7; } });   // optional: x the gains below
 *   pad.feed(value, Date.now());
 *
 * TouchMode asks the controller for touch mode (FrontCCU.ccsControlTouchCCU = TOUCH_AKTIV, as the HMI's speller
 * does) while DeX is on the screen, and gives it back after.
 */
const TOUCH_MODE = 3;
const TAP_MS = 250;        // a tap: this short...
const TAP_TRAVEL = 14;     // ...and moved less than this (pad units)
const SCROLL_UNITS = 22;   // pad units of two-finger travel per scroll notch
const GAIN_SLOW = 1.8, GAIN_FAST = 7;   // screen px per pad unit at <= 0.08 and >= 0.9 units/ms
const V_SLOW = 0.08, V_FAST = 0.9;

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** A sensitivity from the settings (percent of the gains above) as a factor: 0.1..3, 1 when unset or not a number. */
function factor(pct) {
    const n = Number(pct);
    return n > 0 ? clamp(n / 100, 0.1, 3) : 1;
}

/** The fingers in one sample: [] when nothing is on the pad (or it is not in touch mode). */
function fingers(v) {
    if (!v || v.statusSystemModeFrontSide !== TOUCH_MODE || (v.touchCoordinatesZ1FrontSide | 0) === 2) return [];
    const out = [];
    const x1 = v.touchCoordinatesX1FrontSide | 0, y1 = v.touchCoordinatesY1FrontSide | 0;
    const x2 = (v.touchCcoordinatesX2FrontSide || v.touchCoordinatesX2FrontSide) | 0, y2 = v.touchCoordinatesY2FrontSide | 0;
    if (x1 || y1) out.push({ x: x1, y: y1 });
    if (x2 || y2) out.push({ x: x2, y: y2 });
    return out;
}

class Pad {
    constructor(h) {
        this.h = h;
        this.reset();
    }

    _k(name) { return typeof this.h[name] === 'function' ? Number(this.h[name]()) || 1 : 1; }

    reset() {
        this.g = null;        // the gesture: { t0, n (most fingers), travel, x0, y0, scrolled }
        this.prev = null;     // the last sample used: { n, x, y, t }
        this.scrollAcc = 0;
        this.rx = 0; this.ry = 0;
        this.speed = 0;
    }

    /** Is a gesture going on (a finger on the pad)? */
    active() { return !!this.g; }

    feed(v, now) {
        now = now || Date.now();
        const f = fingers(v);
        if (!f.length) { this._lift(now); return; }
        const n = f.length;
        const x = n === 2 ? (f[0].x + f[1].x) / 2 : f[0].x;
        const y = n === 2 ? (f[0].y + f[1].y) / 2 : f[0].y;
        if (!this.g) this.g = { t0: now, n, travel: 0, x0: x, y0: y, scrolled: false };
        const g = this.g;
        if (n > g.n) g.n = n;
        const p = this.prev;
        if (p && p.n === n && p.x === x && p.y === y) return;      // the same sample again
        this.prev = { n, x, y, t: now };
        if (!p || p.n !== n) return;                                // a finger came or went: no jump
        const dx = x - p.x, dy = y - p.y;
        g.travel += Math.abs(dx) + Math.abs(dy);
        if (g.n >= 2) {
            if (n !== 2) return;
            // natural scrolling: fingers up (pad Y grows) = the content up = scroll down (negative notches)
            this.scrollAcc += dy * this._k('scrollSpeed') / SCROLL_UNITS;
            const k = this.scrollAcc > 0 ? Math.floor(this.scrollAcc) : Math.ceil(this.scrollAcc);
            if (k) { this.scrollAcc -= k; g.scrolled = true; this.h.scroll(-k); }
            return;
        }
        if (now - g.t0 < TAP_MS && g.travel < TAP_TRAVEL) return;   // may still be a tap: the pointer stays
        const dt = clamp(now - p.t, 8, 100);
        const sp = Math.sqrt(dx * dx + dy * dy) / dt;
        this.speed = 0.6 * sp + 0.4 * this.speed;
        const gain = this._k('speed') * (GAIN_SLOW + (GAIN_FAST - GAIN_SLOW) * clamp((this.speed - V_SLOW) / (V_FAST - V_SLOW), 0, 1));
        this.rx += dx * gain;
        this.ry -= dy * gain;                                       // the pad's Y goes up, the screen's down
        const mx = Math.trunc(this.rx), my = Math.trunc(this.ry);
        if (mx || my) { this.rx -= mx; this.ry -= my; this.h.move(mx, my); }
    }

    _lift(now) {
        const g = this.g;
        if (g && now - g.t0 <= TAP_MS && g.travel < TAP_TRAVEL && !g.scrolled) this.h.click(g.n >= 2 ? 'right' : 'left');
        this.reset();
    }
}

const FRONT_CCU = 'de.bmw.infotainment.controlelements.FrontCCU';

/** Touch mode on the controller's pad while DeX shows. At most 5 asks a show: never a fight with the HMI. */
class TouchMode {
    constructor(signals, log) {
        this.signals = signals;
        this.log = log;
        this.p = null;
        this.on = false;
        this.asks = 0;
        this.alive = 0;
        this.lastAsk = 0;
        this.ready = Promise.resolve()
            .then(() => signals.proxy(FRONT_CCU, '1'))
            .then((p) => { this.p = p; return this._write(false); }, (e) => log.warn('touch mode: ' + e));
    }

    want(on) {
        on = !!on;
        if (on === this.on) return Promise.resolve();
        if (!on) this.asks = 0;
        else if (this.asks >= 5) return Promise.resolve();
        this.on = on;
        return this.ready.then(() => this._write(on));
    }

    /** The pad says it is not in touch mode while we want it (the HMI turned it off): ask again, counted. */
    lost(now) {
        if (this.on && (now || Date.now()) - this.lastAsk > 1500) { this.on = false; this.want(true); }
    }

    _write(on) {
        if (!this.p) return Promise.resolve();
        if (on) this.asks++;
        this.lastAsk = Date.now();
        this.alive = (this.alive + 1) % 15;
        const v = { aliveControlTouchZBEFrontSide: this.alive, controlTouchActiveFrontSide: on ? 'TOUCH_AKTIV' : 'TOUCH_NICHT_AKTIV', controlIcon: 15 };
        return Promise.resolve(this.signals.set(this.p, 'ccsControlTouchCCU', v))
            .then(() => this.log.info('touch mode ' + v.controlTouchActiveFrontSide), (e) => this.log.warn('touch mode: ' + e));
    }
}

module.exports = { Pad, TouchMode, fingers, factor, TOUCH_MODE };
