'use strict';
/**
 * alerts.js - decides when a camera is coming up.
 *
 *   const eng = new AlertEngine(cameras, settings);
 *   eng.update({ lat, lon, t }, speedKmh)  -> the alert to show, or null:
 *       { id, cam, dist (m, rounded), limit, speed, over: 0 | 1 | 2, label }
 *       over 0: within the limit, 1: over it, 2: over by more than the fine threshold (20 km/h in Ukraine)
 *
 * Heading comes from the track: the bearing between fixes at least HEAD_MIN_M apart. A camera is "ahead" when the
 * bearing to it is within AHEAD_DEG of the heading (wider when close, for bends). The warning starts at
 * lead seconds x speed (at least minWarn, at most maxWarn metres) and stays until the camera is passed: the distance
 * grows again after it was under PASS_M, or the camera falls behind. A passed camera stays quiet for COOL_MS.
 * The official list has no travel direction per camera, so a camera for the other carriageway warns too.
 *
 * Plain Node 8.
 */
const geo = require('./geo');

const HEAD_MIN_M = 12;          // a heading from fixes this far apart (GPS noise at a crawl)
const AHEAD_DEG = 30;           // within this of the heading: ahead
const AHEAD_NEAR_DEG = 60;      // ... closer than NEAR_M
const NEAR_M = 200;
const PASS_M = 90;              // closer than this, then further again: passed
const COOL_MS = 120000;         // a passed camera is quiet this long
const PAIR_M = 200;             // ... and so are the cameras this close to it (the other carriageway's, 70 such pairs)
const MIN_KMH = 8;              // no new alerts slower than this
const FINE_OVER = 20;           // red past the limit + 20 km/h (Ukraine fines from there)
const ZONE_M = 2000;            // a danger zone (France) starts this far before the camera ...
const ZONE_FAST_M = 4000;       // ... at motorway speed (110 km/h and over)

class Track {
    constructor() { this.anchor = null; this.heading = null; this.headingT = 0; }
    feed(fix) {
        if (!this.anchor) { this.anchor = fix; return this.heading; }
        const d = geo.distance(this.anchor.lat, this.anchor.lon, fix.lat, fix.lon);
        if (d >= HEAD_MIN_M) {
            this.heading = geo.bearing(this.anchor.lat, this.anchor.lon, fix.lat, fix.lon);
            this.headingT = fix.t;
            this.anchor = fix;
        }
        // a heading older than 20 s (stopped for long): unknown until the car moves again
        if (this.heading !== null && fix.t - this.headingT > 20000) this.heading = null;
        return this.heading;
    }
}

class AlertEngine {
    /**
     * cameras: [{ id, lat, lon, limit (km/h or null), label, legal ('ok' | 'zones'), units }]; opts(): { lead (s), minWarn (m), maxWarn (m), tolerance (km/h) }
     * (read on every update, so a settings change works at once).
     */
    constructor(cameras, opts) {
        this.setCameras(cameras);
        this.opts = typeof opts === 'function' ? opts : () => (opts || {});
        this.track = new Track();
        this.active = null;        // { cam, minD, lastD, growing }
        this.cool = new Map();     // id -> t until quiet
        this.lastFix = null;
    }

    /** A new camera list (the packs in use changed): the camera being warned about stays until it is passed. */
    setCameras(cameras) {
        this.index = new geo.GridIndex(cameras);
        this.count = cameras.length;
        this.hasZones = cameras.some((c) => c.legal === 'zones');
    }

    /**
     * Where a camera's warning starts. A "zones" country (France) may only be told of a danger zone, never of the
     * camera's place: the zone starts 2 km before it, 4 km at motorway speed, so it does not give the place away.
     */
    warnFor(cam, speedKmh) {
        const d = this.warnDistance(speedKmh);
        return cam && cam.legal === 'zones' ? Math.max(d, speedKmh >= 110 ? ZONE_FAST_M : ZONE_M) : d;
    }

    warnDistance(speedKmh) {
        const o = this.opts();
        const lead = o.lead || 20, lo = o.minWarn || 300, hi = o.maxWarn || 1000;
        return Math.max(lo, Math.min(hi, (speedKmh / 3.6) * lead));
    }

    _over(speed, limit) {
        const tol = this.opts().tolerance || 0;
        if (!(limit > 0) || !(speed >= 0)) return 0;
        if (speed > limit + FINE_OVER) return 2;
        return speed > limit + tol ? 1 : 0;
    }

    _alert(a, speed) {
        const d = Math.round(a.lastD / 10) * 10;
        return { id: a.cam.id, cam: a.cam, dist: d, limit: a.cam.limit, speed: Math.round(speed), over: this._over(speed, a.cam.limit), label: a.cam.label,
            zone: a.cam.legal === 'zones', units: a.cam.units || 'kmh' };
    }

    update(fix, speedKmh) {
        if (!fix) { return this.active ? this._alert(this.active, speedKmh || 0) : null; }
        this.lastFix = fix;
        const speed = speedKmh >= 0 ? speedKmh : 0;
        const heading = this.track.feed(fix);
        for (const k of Array.from(this.cool.keys())) if (this.cool.get(k) <= fix.t) this.cool.delete(k);

        // the camera being warned about: still coming, or passed?
        if (this.active) {
            const a = this.active, c = a.cam;
            const d = geo.distance(fix.lat, fix.lon, c.lat, c.lon);
            const behind = heading !== null && d > 30 && Math.abs(geo.angleDiff(heading, geo.bearing(fix.lat, fix.lon, c.lat, c.lon))) > 100;
            a.growing = d > a.lastD + 3 ? a.growing + 1 : d < a.lastD - 3 ? 0 : a.growing;
            a.minD = Math.min(a.minD, d);
            a.lastD = d;
            const passed = behind || (a.minD < PASS_M && a.growing >= 2) || d > this.warnFor(c, speed) + 400;
            if (!passed) return this._alert(a, speed);
            this.cool.set(c.id, fix.t + COOL_MS);
            this.index.near(c.lat, c.lon, PAIR_M).forEach((n) => this.cool.set(n.item.id, fix.t + COOL_MS));
            this.active = null;
        }

        if (heading === null || speed < MIN_KMH) return null;
        const reach = this.hasZones ? this.warnFor({ legal: 'zones' }, speed) : this.warnDistance(speed);
        const near = this.index.near(fix.lat, fix.lon, reach);
        for (const n of near) {
            const c = n.item;
            if (this.cool.has(c.id) || n.d > this.warnFor(c, speed)) continue;
            const diff = Math.abs(geo.angleDiff(heading, geo.bearing(fix.lat, fix.lon, c.lat, c.lon)));
            if (diff > (n.d < NEAR_M ? AHEAD_NEAR_DEG : AHEAD_DEG)) continue;
            this.active = { cam: c, minD: n.d, lastD: n.d, growing: 0 };
            return this._alert(this.active, speed);
        }
        return null;
    }

    /** Nearest camera at any distance (the page): { cam, d } or null. */
    nearest(fix) {
        if (!fix) return null;
        const n = this.index.nearest(fix.lat, fix.lon);
        return n ? { cam: n.item, d: n.d } : null;
    }
}

module.exports = { AlertEngine, Track, FINE_OVER };
