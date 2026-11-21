'use strict';
/**
 * packs.js - the camera databases: one pack per country (Ukraine, Europe) or US state.
 *
 * Two places: the packs built into this app version (packs/ in the app, read through the kit's data pack) and the
 * ones the monthly update downloaded (<data folder>/packs/). For each pack the newer of the two is used.
 * Which are in use: the ones the owner chose (the "Camera databases" screen) and, with "automatic" on, the ones whose
 * area holds the car. The choice is kept in <data folder>/packs.json.
 *
 *   const p = new Packs({ dir: path.join(__dirname, 'packs'), dataDir, log });
 *   p.list()                      every pack known: [{ code, name, en, uk, group, units, legal, count, bbox, updated, src }]
 *   p.at(lat, lon)                the packs whose area holds that point
 *   p.active(fix)                 the codes in use now
 *   p.cameras(codes)              [{ id, lat, lon, limit, label, dir, pack, iso, units, legal }]
 *   p.toggle(code) / p.setAuto(b) the owner's choice
 * Plain Node 8.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MARGIN = 0.25;               // a pack's area: its cameras' box, this many degrees wider (~25 km)

/** The kit's data pack reader: beside the app when built, in the repository's kit/ for the tests. */
function kitPack() {
    try { return require('./kit/pack'); } catch (e) { return require('../../kit/runtime/pack'); }
}

function readJson(f, fallback) {
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fallback; }
}

class Packs {
    constructor(o) {
        this.log = o.log || { info: () => {}, warn: () => {} };
        this.bundled = o.bundled || kitPack().open(o.dir);
        this.dlDir = o.dataDir ? path.join(o.dataDir, 'packs') : null;
        this.choiceFile = o.dataDir ? path.join(o.dataDir, 'packs.json') : null;
        this.choice = Object.assign({ chosen: ['ua'], auto: true }, readJson(this.choiceFile, {}));
        this.cache = new Map();
        this.reload();
    }

    /** Re-reads both indexes (after an update). */
    reload() {
        const b = this.bundled.json('index.json') || {};
        const d = this.dlDir ? readJson(path.join(this.dlDir, 'index.json'), {}) : {};
        this.remote = this.dlDir ? readJson(path.join(this.dlDir, 'remote.json'), null) : null;
        const all = {};
        Object.keys(b.packs || {}).forEach((k) => { all[k] = Object.assign({ code: k, src: 'app' }, b.packs[k]); });
        Object.keys(d.packs || {}).forEach((k) => {
            const m = d.packs[k];
            if (!all[k] || String(m.updated || '') > String(all[k].updated || '')) {
                if (fs.existsSync(path.join(this.dlDir, k + '.json'))) all[k] = Object.assign({ code: k, src: 'update' }, m);
            }
        });
        // packs only the last update's index knows (new on GitHub, not built in): listed, downloaded when chosen
        if (this.remote && this.remote.packs) {
            Object.keys(this.remote.packs).forEach((k) => { if (!all[k]) all[k] = Object.assign({ code: k, src: 'remote' }, this.remote.packs[k]); });
        }
        this.index = all;
        this.cache.clear();
        this.bundledDate = b.checked || null;
    }

    list() {
        const order = { ua: 0, eu: 1, us: 2 };
        return Object.keys(this.index).map((k) => this.index[k])
            .sort((a, c) => (order[a.group] - order[c.group]) || (a.group === 'eu' ? String(a.en).localeCompare(String(c.en)) : a.code < c.code ? -1 : 1));
    }

    meta(code) { return this.index[code] || null; }

    /** The rows of a pack: [[id, lat, lon, limit, label, dir], ...] (the meta element dropped). */
    rows(code) {
        if (this.cache.has(code)) return this.cache.get(code);
        const m = this.index[code];
        let arr = null;
        if (m && m.src === 'update') arr = readJson(path.join(this.dlDir, code + '.json'), null);
        if ((!arr || !Array.isArray(arr)) && m && m.src !== 'remote') arr = this.bundled.json(code + '.json');
        const rows = Array.isArray(arr) ? arr.slice(1) : [];
        this.cache.set(code, rows);
        return rows;
    }

    at(lat, lon) {
        if (typeof lat !== 'number') return [];
        return Object.keys(this.index).filter((k) => {
            const b = this.index[k].bbox;
            return b && lat >= b[0] - MARGIN && lat <= b[2] + MARGIN && lon >= b[1] - MARGIN && lon <= b[3] + MARGIN;
        });
    }

    /** The codes in use: the chosen ones, plus with "automatic" the ones where the car is (a pack not here yet: left out). */
    active(fix) {
        const set = {};
        this.choice.chosen.forEach((k) => { if (this.index[k] && this.index[k].src !== 'remote') set[k] = 1; });
        if (this.choice.auto && fix) this.at(fix.lat, fix.lon).forEach((k) => { if (this.index[k].src !== 'remote') set[k] = 1; });
        return Object.keys(set).sort();
    }

    /** Everything the update should keep fresh: chosen, used automatically, already downloaded. */
    wanted(extra) {
        const set = {};
        this.choice.chosen.concat(extra || []).forEach((k) => { set[k] = 1; });
        Object.keys(this.index).forEach((k) => { if (this.index[k].src === 'update') set[k] = 1; });
        return Object.keys(set);
    }

    cameras(codes) {
        const out = [];
        codes.forEach((code) => {
            const m = this.index[code] || {};
            this.rows(code).forEach((r) => {
                if (!Array.isArray(r) || typeof r[1] !== 'number') return;
                out.push({ id: code + ':' + r[0], lat: r[1], lon: r[2], limit: r[3], label: r[4], dir: r[5], pack: code, iso: m.iso, units: m.units || 'kmh', legal: m.legal || 'ok' });
            });
        });
        return out;
    }

    chosen(code) { return this.choice.chosen.indexOf(code) >= 0; }

    toggle(code, on) {
        const has = this.chosen(code);
        const want = on === undefined ? !has : !!on;
        if (want && !has) this.choice.chosen.push(code);
        if (!want && has) this.choice.chosen = this.choice.chosen.filter((k) => k !== code);
        this._save();
        return want;
    }

    setAuto(on) { this.choice.auto = !!on; this._save(); }

    _save() {
        if (!this.choiceFile) return;
        try { fs.writeFileSync(this.choiceFile, JSON.stringify(this.choice)); } catch (e) { this.log.warn('packs: ' + e.message); }
    }

    /** A downloaded pack, checked and saved (the updater): true when it was taken. */
    store(code, raw, meta) {
        if (!this.dlDir) return false;
        if (crypto.createHash('sha256').update(raw).digest('hex') !== meta.sha256) throw new Error(code + ': checksum differs');
        const arr = JSON.parse(raw.toString('utf8'));
        if (!Array.isArray(arr) || !arr[0] || arr[0].code !== code) throw new Error(code + ': not a camera pack');
        mkdirp(this.dlDir);
        const f = path.join(this.dlDir, code + '.json');
        fs.writeFileSync(f + '.tmp', raw);
        fs.renameSync(f + '.tmp', f);
        const idxFile = path.join(this.dlDir, 'index.json');
        const idx = readJson(idxFile, { packs: {} });
        idx.packs = idx.packs || {};
        idx.packs[code] = meta;
        fs.writeFileSync(idxFile + '.tmp', JSON.stringify(idx));
        fs.renameSync(idxFile + '.tmp', idxFile);
        return true;
    }

    /** The last remote index (lists packs that are not built in). */
    keepRemote(index) {
        if (!this.dlDir) return;
        mkdirp(this.dlDir);
        try { fs.writeFileSync(path.join(this.dlDir, 'remote.json'), JSON.stringify(index)); } catch (e) { this.log.warn('packs: ' + e.message); }
    }

    /** The sha256 of the pack in use (to compare with the remote index). */
    sha(code) { const m = this.index[code]; return m && m.src !== 'remote' ? m.sha256 : null; }
}

function mkdirp(d) {
    if (fs.existsSync(d)) return;
    mkdirp(path.dirname(d));
    fs.mkdirSync(d);
}

module.exports = { Packs, MARGIN };
