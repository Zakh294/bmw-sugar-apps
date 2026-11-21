'use strict';
/**
 * updater.js - the monthly update of the camera packs, from the repository on GitHub.
 *
 * Once a month at most after a check that reached GitHub, every 6 hours while it cannot (and when the owner asks, or chooses a pack that is not here yet) it reads the index the
 * monthly GitHub workflow publishes (apps/speedcam_ua/packs/index.json on the main branch) and downloads only the
 * packs in use whose checksum changed: a few kilobytes to a few hundred. Each file is checked against its sha256
 * before it replaces the old one; anything that fails leaves the packs as they were. No internet, a private
 * repository (404) or GitHub down: the packs built into the app are used and the page says why.
 *
 *   const u = new Updater({ packs, base, dataDir, log, wanted: () => [codes] });
 *   u.start()                       checks 2 minutes after start-up, then every 6 hours whether a month has passed
 *   u.check(true)                   now -> Promise of the state
 *   u.state                         { checking, last, ok, error, updated, next }
 * Plain Node 8: https and zlib only.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const zlib = require('zlib');
const urlLib = require('url');

const MONTH = 30 * 24 * 3600 * 1000;
const FIRST_MS = 2 * 60 * 1000;
const EVERY_MS = 6 * 3600 * 1000;
const MAX_BYTES = 8 * 1024 * 1024;

/** GET url -> Promise of a Buffer; follows redirects, gunzips, times out. */
function get(url, timeoutMs, hops) {
    return new Promise((resolve, reject) => {
        const u = urlLib.parse(url);
        const req = https.get({ hostname: u.hostname, path: u.path, port: u.port || 443,
            headers: { 'User-Agent': 'SpeedCam-MGU', 'Accept-Encoding': 'gzip' } }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (hops || 0) < 4) {
                res.resume();
                return resolve(get(urlLib.resolve(url, res.headers.location), timeoutMs, (hops || 0) + 1));
            }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
            const parts = [];
            let n = 0;
            res.on('data', (c) => { n += c.length; if (n > MAX_BYTES) { req.abort(); reject(new Error('too big')); } else parts.push(c); });
            res.on('end', () => {
                const buf = Buffer.concat(parts);
                if (/gzip/.test(res.headers['content-encoding'] || '')) zlib.gunzip(buf, (e, out) => (e ? reject(e) : resolve(out)));
                else resolve(buf);
            });
            res.on('error', reject);
            return null;
        });
        req.on('error', reject);
        req.setTimeout(timeoutMs || 20000, () => { req.abort(); reject(new Error('timeout')); });
    });
}

class Updater {
    constructor(o) {
        this.packs = o.packs;
        this.base = String(o.base || '').replace(/\/?$/, '/');
        this.log = o.log || { info: () => {}, warn: () => {} };
        this.wanted = o.wanted || (() => []);
        this.enabled = o.enabled || (() => true);
        this.onChange = o.onChange || (() => {});
        this.get = o.get || get;
        this.file = o.dataDir ? path.join(o.dataDir, 'update.json') : null;
        const saved = this._read();
        this.state = { checking: false, last: saved.last || 0, ok: saved.ok || 0, error: saved.error || null, updated: saved.updated || 0, checked: saved.checked || null };
        this.busy = null;
    }

    _read() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { return {}; } }

    _save() {
        if (!this.file) return;
        const s = this.state;
        try { fs.writeFileSync(this.file, JSON.stringify({ last: s.last, ok: s.ok, error: s.error, updated: s.updated, checked: s.checked })); } catch (e) { /* read-only */ }
    }

    next() { return (this.state.last || 0) + MONTH; }

    due(now) { return this.enabled() && (now || Date.now()) >= this.next(); }

    start() {
        const tick = () => { if (this.due()) this.check(false).catch(() => {}); };
        setTimeout(tick, FIRST_MS);
        setInterval(tick, EVERY_MS);
        return this;
    }

    /** Checks now (force) or when a month has passed; `codes`: packs to get as well (just chosen). */
    check(force, codes) {
        if (this.busy) return this.busy;
        if (!force && !this.due()) return Promise.resolve(this.state);
        if (!this.base || this.base === '/') return Promise.resolve(this.state);
        const st = this.state;
        let reached = false;
        st.checking = true;
        this.busy = this.get(this.base + 'index.json', 20000)
            .then((buf) => {
                const remote = JSON.parse(buf.toString('utf8'));
                if (!remote || !remote.packs) throw new Error('no index');
                reached = true;
                this.packs.keepRemote(remote);
                const want = this.wanted().concat(codes || []).filter((k, i, a) => a.indexOf(k) === i && remote.packs[k]);
                const todo = want.filter((k) => remote.packs[k].sha256 && remote.packs[k].sha256 !== this.packs.sha(k));
                let n = 0;
                // one after another: a car's connection is slow, and a failure leaves the rest
                return todo.reduce((p, k) => p.then(() => this.get(this.base + k + '.json', 60000)
                    .then((raw) => { if (this.packs.store(k, raw, remote.packs[k])) n++; this.log.info('update: ' + k + ' ' + remote.packs[k].updated); })
                    .catch((e) => { this.log.warn('update ' + k + ': ' + e.message); st.error = k + ': ' + e.message; })), Promise.resolve())
                    .then(() => { st.updated = n; st.ok = Date.now(); st.checked = remote.checked || null; if (n === todo.length) st.error = null; });
            })
            .catch((e) => { st.error = e.message; this.log.warn('update: ' + e.message); })
            .then(() => {
                st.checking = false;
                // a month from a check that reached GitHub; a failed one is tried again 6 hours later
                if (reached) st.last = Date.now();
                st.tried = Date.now();
                this._save();
                this.packs.reload();
                this.busy = null;
                this.onChange(st);
                return st;
            });
        return this.busy;
    }
}

module.exports = { Updater, get, MONTH };
