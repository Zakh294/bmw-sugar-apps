'use strict';
/**
 * position.js - where the car is, read from the head unit's own navigation over SOME/IP. Read-only: subscriptions and
 * getters, never a write.
 *
 * Which interface carries the car's GPS position is not documented anywhere public, and it can differ between firmware
 * versions. So the Store build on the car (tools/store_build.py) searches the unit's interface catalog
 * (/etc/oap/someip/someip-interfaces.json) for fields and events whose data type has a latitude and a longitude,
 * ranks them, adds the best few to app.json "signals" (each "_optional") and writes them to position_candidates.js.
 * Here every candidate is watched, the latitude / longitude pair is found inside whatever the car sends, its unit is
 * worked out (degrees, micro- or 1e-7 degrees, 2^32 per turn, radians, milliarcseconds) and the source that gives
 * fresh positions is used. The page shows each candidate and what it gave, so a car that sends none can be looked at
 * (tools/speedcam_ua/find_position.js over SSH).
 *
 * Plain Node 8 (the car's 8.16.2).
 */
const EventEmitter = require('events');

const STALE_MS = 3000;
// Ukraine with a margin: a unit that puts the car here is the right one
const UA = { lat0: 43.5, lat1: 53.5, lon0: 21.5, lon1: 41.5 };
const SCALES = [
    ['deg', 1], ['1e-6 deg', 1e-6], ['1e-7 deg', 1e-7], ['1e-5 deg', 1e-5], ['2^32/turn', 360 / 4294967296],
    ['2^31/180', 180 / 2147483648], ['2^30/90', 90 / 1073741824], ['2^24/turn', 360 / 16777216], ['rad', 180 / Math.PI], ['mas', 1 / 3600000],
    ['arcsec', 1 / 3600], ['1e-8 deg', 1e-8],
];

/** camelCase / snake_case words of a key, lower case. */
function words(k) {
    return String(k).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ').toLowerCase().split(' ').filter((w) => w);
}
function isLatKey(k) { return words(k).some((w) => w === 'lat' || w === 'latitude' || /^latitude/.test(w) || /^wgs84lat/.test(w)); }
function isLonKey(k) { return words(k).some((w) => w === 'lon' || w === 'lng' || w === 'longitude' || /^longitude/.test(w) || /^wgs84lon/.test(w)); }

/** A number, or the one number inside a small wrapper ({ value: 5 }); else null. */
function num(v) {
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
        const ks = Object.keys(v).filter((k) => typeof v[k] === 'number');
        if (ks.length === 1) return v[ks[0]];
    }
    return null;
}

/**
 * The first latitude / longitude pair inside v: { lat, lon, path } (raw numbers) or null. Objects whose path says
 * "current", "vehicle", "car", "ego" or "ccp" are preferred over others (a reply may also hold a destination).
 */
function findPair(v) {
    const found = [];
    (function walk(x, path, depth) {
        if (depth > 8 || !x || typeof x !== 'object' || found.length > 20) return;
        if (Array.isArray(x)) { if (x.length) walk(x[0], path + '[0]', depth + 1); return; }
        const keys = Object.keys(x);
        const lk = keys.filter(isLatKey), ok = keys.filter(isLonKey);
        if (lk.length && ok.length) {
            const lat = num(x[lk[0]]), lon = num(x[ok[0]]);
            if (lat !== null && lon !== null) found.push({ lat, lon, path: path || '.' });
        }
        keys.forEach((k) => { if (x[k] && typeof x[k] === 'object') walk(x[k], path ? path + '.' + k : k, depth + 1); });
    })(v, '', 0);
    if (!found.length) return null;
    const pref = found.find((f) => /current|vehicle|car|ego|ccp|own|matched/i.test(f.path) && !/dest|target|poi|via|stop/i.test(f.path));
    return pref || found.find((f) => !/dest|target|poi|via|stop/i.test(f.path)) || found[0];
}

/** [name, factor] that puts the raw pair in Ukraine (else anywhere on Earth, then null). Invalid markers give null. */
function scaleOf(rawLat, rawLon) {
    if (rawLat === 0 && rawLon === 0) return null;
    const inUA = SCALES.find((s) => { const a = rawLat * s[1], o = rawLon * s[1]; return a >= UA.lat0 && a <= UA.lat1 && o >= UA.lon0 && o <= UA.lon1; });
    if (inUA) return { name: inUA[0], k: inUA[1], ua: true };
    const anywhere = SCALES.find((s) => { const a = rawLat * s[1], o = rawLon * s[1]; return Math.abs(a) <= 90 && Math.abs(o) <= 180 && (Math.abs(a) > 0.01 || Math.abs(o) > 0.01); });
    return anywhere ? { name: anywhere[0], k: anywhere[1], ua: false } : null;
}

/** Key paths of a value (no values: a car's position never goes to the log). */
function shape(v) {
    const out = [];
    (function walk(x, p, d) {
        if (out.length > 60 || d > 6) return;
        if (Array.isArray(x)) { if (x.length) walk(x[0], p + '[]', d + 1); else out.push(p + '[]'); return; }
        if (x && typeof x === 'object') { Object.keys(x).forEach((k) => walk(x[k], p ? p + '.' + k : k, d + 1)); return; }
        out.push(p + ':' + typeof x);
    })(v, '', 0);
    return out.join(' ');
}

const mono = () => { const h = process.hrtime(); return h[0] * 1000 + h[1] / 1e6; };

class PositionSource extends EventEmitter {
    /**
     * signals: the kit's signals module (watch); candidates: position_candidates.js "list"
     * ([{ iface, inst, name, kind: 'field' | 'event', poll }]); log: the kit's log.
     */
    constructor(signals, log, candidates) {
        super();
        this.signals = signals;
        this.log = log;
        this.cands = (candidates || []).map((c) => Object.assign({ count: 0, misses: 0, last: null, scale: null, error: null, shapeLogged: false, available: false }, c));
        this.best = null;
    }

    start() {
        if (!this.signals || !this.signals.watch) return this;
        // one proxy per interface and instance, with every candidate field of it
        const groups = {};
        this.cands.forEach((c) => { const k = c.iface + '|' + (c.inst || '1'); (groups[k] = groups[k] || []).push(c); });
        Object.keys(groups).forEach((k) => {
            const list = groups[k], c0 = list[0], handlers = {};
            list.forEach((c) => { handlers[c.name] = (v) => this._value(c, v); });
            const poll = list.some((c) => c.poll);
            Promise.resolve(this.signals.watch(c0.iface, c0.inst || '1', handlers, this.log, poll ? { pollMs: 1000 } : undefined))
                .then((s) => {
                    const err = s && s.error ? String(s.error) : null;
                    list.forEach((c) => { c.sub = s; c.error = err; });
                    this.log.info('position: ' + c0.iface + ' (' + list.map((c) => c.name).join(', ') + ')' + (err ? ' error: ' + err : ' watched'));
                })
                .catch((e) => list.forEach((c) => { c.error = String(e && e.message || e); }));
        });
        return this;
    }

    _value(c, v) {
        try {
            const pair = findPair(v);
            if (!pair) {
                c.misses++;
                if (!c.shapeLogged) { c.shapeLogged = true; this.log.info('position: ' + c.name + ' sent no lat/lon pair; its keys: ' + shape(v).slice(0, 600)); }
                return;
            }
            let s = c.scale;
            // the unit is worked out once and checked again when the value stops fitting it
            const fits = s && Math.abs(pair.lat * s.k) <= 90 && Math.abs(pair.lon * s.k) <= 180 && (!s.ua || this._inUA(pair.lat * s.k, pair.lon * s.k));
            if (!fits) {
                s = scaleOf(pair.lat, pair.lon);
                if (!s) { c.misses++; return; }
                if (!c.scale || c.scale.name !== s.name) this.log.info('position: ' + c.name + ' at ' + pair.path + ' in ' + s.name + (s.ua ? '' : ' (outside Ukraine)'));
                c.scale = s;
            }
            const fix = { lat: pair.lat * s.k, lon: pair.lon * s.k, t: mono(), src: c.name };
            c.last = fix;
            c.count++;
            this._choose();
            if (this.best === c) this.emit('fix', fix);
        } catch (e) {
            this.log.warn('position ' + c.name + ': ' + e);
        }
    }

    _inUA(lat, lon) { return lat >= UA.lat0 && lat <= UA.lat1 && lon >= UA.lon0 && lon <= UA.lon1; }

    /** The candidate with a fresh fix, most updates first (the GPS one sends about once a second). */
    _choose() {
        const now = mono();
        const fresh = this.cands.filter((c) => c.last && now - c.last.t <= STALE_MS);
        fresh.sort((a, b) => (b.scale && b.scale.ua ? 1 : 0) - (a.scale && a.scale.ua ? 1 : 0) || b.count - a.count);
        const next = fresh[0] || null;
        if (next !== this.best) {
            if (next) this.log.info('position source: ' + next.iface + '.' + next.name);
            this.best = next;
        }
    }

    /** The newest fix of the source in use, or null when it is older than STALE_MS. */
    fix() {
        this._choose();
        return this.best && this.best.last ? this.best.last : null;
    }

    /** For the page: one line per candidate. */
    status() {
        const now = mono();
        return this.cands.map((c) => ({
            name: c.iface.split('.').slice(-2).join('.') + '.' + c.name,
            count: c.count, misses: c.misses, error: c.error,
            age: c.last ? Math.round((now - c.last.t) / 1000) : null,
            scale: c.scale ? c.scale.name : null, inUse: this.best === c,
        }));
    }
}

module.exports = { PositionSource, findPair, scaleOf, shape, isLatKey, isLonKey, mono };
