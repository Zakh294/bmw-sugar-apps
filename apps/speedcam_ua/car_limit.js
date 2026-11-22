'use strict';
/**
 * car_limit.js - the speed limit the car itself shows (its sign recognition / the navigation's map limit), read over
 * SOME/IP. Read-only: subscriptions and getters, never a write.
 *
 * Like the position (position.js), which interface carries it is not documented anywhere public. The Store build on
 * the car (tools/store_build.py) searches the unit's interface catalog for fields and events whose names say "speed
 * limit", "traffic sign", "SLI", "KAFAS" and the like, adds the best few to app.json "signals" (each "_optional") and
 * writes them to limit_candidates.js. Here every candidate is watched and a plausible limit is looked for in whatever
 * it sends (a multiple of 5 between 5 and 160). The HUD then leaves out our own limit sign while one of them says
 * the same limit as the camera ("hudLimit": "auto"). The page shows each candidate and its last value.
 *
 * Plain Node 8 (the car's 8.16.2).
 */
const { mono } = require('./position');

const MPH = 1.609344;
// an event's value counts this long; a field's value stands until the field changes
const EVENT_MS = 120000;
const SKIP = /unit|type|status|state|^id$|ident|count|num|dist|offset|toler|quality|conf|valid|flag|time|age|index|lat|lon|head|reason|source|kind|crc|counter|mode|level|prio/i;
const PREFER = /limit|vmax|tempo|speed|value|sign/i;

function plausible(n) { return typeof n === 'number' && isFinite(n) && n >= 5 && n <= 160 && Math.round(n) === n && n % 5 === 0; }

/** The limit inside v: { v, path } or null (no plausible number, or one that says "no limit known"). */
function findLimit(v) {
    if (typeof v === 'number') return plausible(v) ? { v, path: '.' } : null;
    const found = [];
    (function walk(x, path, key, depth) {
        if (depth > 6 || found.length > 30 || x === null || x === undefined) return;
        if (typeof x === 'number') { if (!SKIP.test(key)) found.push({ v: x, path: path || '.', key }); return; }
        if (typeof x !== 'object') return;
        if (Array.isArray(x)) { if (x.length) walk(x[0], path + '[0]', key, depth + 1); return; }
        Object.keys(x).forEach((k) => walk(x[k], path ? path + '.' + k : k, k, depth + 1));
    })(v, '', '', 0);
    const good = found.filter((f) => plausible(f.v));
    if (!good.length) return null;
    const pref = good.find((f) => PREFER.test(f.key)) || (good.length === 1 && found.length <= 3 ? good[0] : null);
    return pref ? { v: pref.v, path: pref.path } : null;
}

/** Numbers of v in a short line, for the page and the log (no positions: those keys are left out). */
function brief(v) {
    if (typeof v !== 'object' || v === null) return String(v).slice(0, 40);
    const out = [];
    (function walk(x, p, d) {
        if (out.length > 8 || d > 5 || x === null || x === undefined) return;
        if (Array.isArray(x)) { if (x.length) walk(x[0], p + '[0]', d + 1); return; }
        if (typeof x === 'object') { Object.keys(x).forEach((k) => { if (!/lat|lon/i.test(k)) walk(x[k], p ? p + '.' + k : k, d + 1); }); return; }
        out.push(p + '=' + String(x).slice(0, 12));
    })(v, '', 0);
    return out.join(' ').slice(0, 120);
}

class CarLimit {
    /** signals: the kit's signals module (watch); candidates: limit_candidates.js "list"; log: the kit's log. */
    constructor(signals, log, candidates) {
        this.signals = signals;
        this.log = log;
        this.cands = (candidates || []).map((c) => Object.assign({ count: 0, misses: 0, value: null, t: null, raw: '', error: null }, c));
    }

    start() {
        if (!this.signals || !this.signals.watch) return this;
        const groups = {};
        this.cands.forEach((c) => { const k = c.iface + '|' + (c.inst || '1'); (groups[k] = groups[k] || []).push(c); });
        Object.keys(groups).forEach((k) => {
            const list = groups[k], c0 = list[0], handlers = {};
            list.forEach((c) => { handlers[c.name] = (v) => this._value(c, v); });
            const poll = list.some((c) => c.poll);
            Promise.resolve(this.signals.watch(c0.iface, c0.inst || '1', handlers, this.log, poll ? { pollMs: 2000 } : undefined))
                .then((s) => {
                    const err = s && s.error ? String(s.error) : null;
                    list.forEach((c) => { c.error = err; });
                    this.log.info('car limit: ' + c0.iface + ' (' + list.map((c) => c.name).join(', ') + ')' + (err ? ' error: ' + err : ' watched'));
                })
                .catch((e) => list.forEach((c) => { c.error = String(e && e.message || e); }));
        });
        return this;
    }

    _value(c, v) {
        try {
            const r = findLimit(v), raw = brief(v);
            c.count++;
            c.t = mono();
            if (!r) c.misses++;
            const value = r ? r.v : null;
            if (value !== c.value || c.count === 1) this.log.info('car limit: ' + c.name + ' = ' + (value === null ? '-' : value + ' at ' + r.path) + ' (' + raw + ')');
            c.value = value;
            c.raw = raw;
        } catch (e) {
            this.log.warn('car limit ' + c.name + ': ' + e);
        }
    }

    /** The limits the car says now (km/h or mph as it sends them). */
    values() {
        const now = mono();
        return this.cands.filter((c) => c.value !== null && (c.kind !== 'event' || now - c.t <= EVENT_MS)).map((c) => c.value);
    }

    /** Whether the car says this limit (km/h) now: the same number, or the same in mph. */
    shows(limitKmh) {
        if (!(limitKmh > 0)) return false;
        return this.values().some((v) => Math.abs(v - limitKmh) <= 2 || Math.abs(v - limitKmh / MPH) <= 1);
    }

    /** For the page: one line per candidate. */
    status() {
        const now = mono();
        return this.cands.map((c) => ({
            name: c.iface.split('.').slice(-1)[0] + '.' + c.name, value: c.value, raw: c.raw, count: c.count, misses: c.misses,
            error: c.error, age: c.t === null ? null : Math.round((now - c.t) / 1000),
        }));
    }
}

module.exports = { CarLimit, findLimit, brief, plausible };
