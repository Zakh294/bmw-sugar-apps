'use strict';
/**
 * chime.js - a short sound for a camera warning through BMW's own media player, no native code.
 *
 * What the car showed (0.3.2's audio page): the audio manager has the app sources OAPGenericMedia (1046, class 1:
 * entertainment), OAPGenericInterrupt (1047, class 3: like a phone call or speech) and OAPGenericOverlay (1048,
 * class 2: like a navigation prompt, over the music). BMW's media player (MediaPlayer) has an instance per source
 * (OapGenericMedia, OapGenericInterrupt, OapGenericOverlay); an app plays a file on one with playFile once that
 * source is connected to the speakers (MediaSink_Front, 1024). This is the path NamelsMissing, leschi/mgu-media-client
 * (MIT) and loenne007/idrive-enginesound (MIT) found for OAPGenericMedia; the overlay and interrupt instances are the
 * same player for the other two sources.
 *
 * One sound at a time (a warning's and an over-the-limit one never pile up): connect source -> sink, wait until connected, playFile(wav in /tmp), wait it out, disconnect.
 * The media route takes the entertainment source over, so it puts the one before back afterwards. Every step goes to
 * `last` (for the page) and the log. Our open connection is noted in the data folder until it is gone, so a crash
 * cannot leave the music ducked. Plain Node 8.
 */
const fs = require('fs');
const path = require('path');

const AM = 'org.genivi.am.commandinterface.CommandControl';
const MP = 'de.bmw.infotainment.entertainment.mediaplayer.MediaPlayer';
const ROUTES = {
    overlay: { source: 'OAPGenericOverlay', id: 1048, inst: 'OapGenericOverlay' },
    interrupt: { source: 'OAPGenericInterrupt', id: 1047, inst: 'OapGenericInterrupt' },
    media: { source: 'OAPGenericMedia', id: 1046, inst: 'OapGenericMedia' },
};
const SINK = 1024;            // MediaSink_Front; entertainment sources are refused on MainSink (1)
const RATE = 48000;

/**
 * The sounds: notes [start s, end s, Hz, Hz at the end (a sweep) or 0, partials]. Every one is short, so it does not
 * talk over a navigation prompt for long.
 *   ding   two rising notes (B5, E6): the default
 *   gong   two falling bell notes (E6, B5) with a bell's inharmonic partials, like a car's own gong
 *   beep3  three short beeps, 1.2 kHz
 *   soft   one quiet round note (A5), for those who find the rest too much
 *   radar  two rising sweeps, as a radar detector
 *   alarm  four quick alternating beeps: over the limit (with "Тривожний сигнал при перевищенні")
 */
const STYLES = {
    ding: { len: 0.5, notes: [[0, 0.16, 987.77, 0, 'h'], [0.18, 0.46, 1318.51, 0, 'h']] },
    gong: { len: 1.1, notes: [[0, 0.5, 1318.51, 0, 'b'], [0.42, 1.08, 987.77, 0, 'b']] },
    beep3: { len: 0.5, notes: [[0, 0.09, 1200, 0, 's'], [0.17, 0.26, 1200, 0, 's'], [0.34, 0.43, 1200, 0, 's']] },
    soft: { len: 0.45, notes: [[0, 0.42, 880, 0, 'p']] },
    radar: { len: 0.7, notes: [[0, 0.28, 700, 1500, 'p'], [0.36, 0.64, 700, 1500, 'p']] },
    alarm: { len: 0.6, notes: [[0, 0.1, 1500, 0, 's'], [0.14, 0.24, 1100, 0, 's'], [0.28, 0.38, 1500, 0, 's'], [0.42, 0.52, 1100, 0, 's']] },
};
// partials [multiple, level, decay factor]: h harmonic chime, b bell, s square-ish beep, p pure
const TIMBRE = {
    h: [[1, 1, 3], [2, 0.25, 4]],
    b: [[1, 1, 2.5], [2.76, 0.35, 5], [5.4, 0.15, 8]],
    s: [[1, 1, 0], [3, 0.25, 0], [5, 0.1, 0]],
    p: [[1, 1, 1.5]],
};

/** A sound from STYLES as a 16-bit 48 kHz stereo WAV, `vol` 0..1. */
function wav(vol, style) {
    const S = STYLES[style] || STYLES.ding;
    const len = Math.round(RATE * S.len);
    const buf = Buffer.alloc(44 + len * 4);
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + len * 4, 4); buf.write('WAVEfmt ', 8);
    buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(RATE, 24);
    buf.writeUInt32LE(RATE * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34);
    buf.write('data', 36); buf.writeUInt32LE(len * 4, 40);
    const raw = new Float64Array(len);
    let peak = 0;
    S.notes.forEach((n) => {
        const d = n[1] - n[0], parts = TIMBRE[n[4]] || TIMBRE.p;
        let ph = 0;
        for (let i = Math.round(n[0] * RATE); i < Math.min(len, Math.round(n[1] * RATE)); i++) {
            const u = i / RATE - n[0];
            const f = n[3] ? n[2] + (n[3] - n[2]) * u / d : n[2];
            ph += 2 * Math.PI * f / RATE;
            const edge = Math.min(1, u / 0.006) * Math.min(1, (d - u) / 0.012);
            let v = 0;
            parts.forEach((q) => { v += q[1] * Math.exp(-q[2] * u / d) * Math.sin(ph * q[0]); });
            raw[i] += v * edge;
        }
    });
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(raw[i]));
    const amp = 32767 * 0.8 * Math.max(0, Math.min(1, vol)) / (peak || 1);
    for (let i = 0; i < len; i++) {
        const v = Math.round(raw[i] * amp);
        buf.writeInt16LE(v, 44 + i * 4); buf.writeInt16LE(v, 46 + i * 4);
    }
    return buf;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const arr = (r) => { if (Array.isArray(r)) return r; if (r && typeof r === 'object') for (const k in r) if (Array.isArray(r[k])) return r[k]; return []; };
const okReply = (r) => !!r && (r.amError === 'E_OK' || r.amError === 'E_ALREADY_EXISTS' || r.amError === 0);
const short = (x) => { const s = JSON.stringify(x); return s && s.length > 70 ? s.slice(0, 69) + '…' : String(s); };

class Chime {
    /** opts: { dataDir, tmpDir, scale (waits, for the tests) } */
    constructor(signals, log, opts) {
        opts = opts || {};
        this.signals = signals; this.log = log;
        this.scale = opts.scale !== undefined ? opts.scale : 1;
        this.tmp = opts.tmpDir || '/tmp';
        this.note = opts.dataDir ? path.join(opts.dataDir, 'chime-connection.json') : null;
        this.am = null; this.mp = {};
        this.busy = false;
        this.last = null;          // { route, at, ok, steps: [..] }
        this.files = {};
    }

    _w(ms) { return wait(ms * this.scale); }

    _call(px, m, a, ms) {
        ms = ms || 6000;
        return Promise.race([this.signals.call(px, m, a || {}, ms),
            new Promise((res, rej) => setTimeout(() => rej(new Error(m + ': no answer in ' + Math.round(ms / 1000) + ' s')), ms + 1000))]);
    }

    _proxy(iface, inst, ms) {
        return Promise.resolve(this.signals.proxy(iface, inst)).then((p) => new Promise((resolve, reject) => {
            if (!this.signals.onAvailable) return resolve(p);
            let done = false;
            const t = setTimeout(() => { if (!done) { done = true; reject(new Error(inst + ': not offered on this unit')); } }, ms * Math.max(this.scale, 0.01));
            Promise.resolve(this.signals.onAvailable(p, (a) => { if (a && !done) { done = true; clearTimeout(t); resolve(p); } })).catch(() => {});
            return null;
        }));
    }

    _file(vol, style) {
        style = STYLES[style] ? style : 'ding';
        const key = style + '-' + Math.round(vol * 100);
        const f = path.join(this.tmp, 'speedcam-chime-' + key + '.wav');
        if (!this.files[key] || !fs.existsSync(f)) {
            fs.writeFileSync(f, wav(vol, style), { mode: 0o644 });
            try { fs.chmodSync(f, 0o644); } catch (e) { /* not ours to change */ }
            this.files[key] = f;
        }
        return f;
    }

    _remember(id) {
        if (!this.note) return;
        try { if (id === null) fs.unlinkSync(this.note); else fs.writeFileSync(this.note, JSON.stringify({ id })); } catch (e) { /* best effort */ }
    }

    /** At the start: a connection a crash left open goes. */
    sweep() {
        let id = null;
        try { id = JSON.parse(fs.readFileSync(this.note, 'utf8')).id; } catch (e) { return Promise.resolve(); }
        return this._amReady().then(() => this._call(this.am, 'disconnect', { mainConnectionID: id }))
            .then((r) => this.log.info('chime: leftover connection ' + id + ' disconnect ' + short(r)), (e) => this.log.warn('chime: leftover ' + id + ': ' + e.message))
            .then(() => this._remember(null));
    }

    _amReady() {
        if (this.am) return Promise.resolve(this.am);
        return this._proxy(AM, '1', 15000).then((p) => { this.am = p; return p; });
    }

    /** Plays one sound (STYLES) on `route` (overlay | interrupt | media), volume 0..1. Resolves to `last`; never rejects. */
    play(route, vol, style) {
        if (this.busy) return Promise.resolve(this.last);
        const R = ROUTES[route] || ROUTES.overlay;
        this.busy = true;
        const last = { route: route in ROUTES ? route : 'overlay', style: STYLES[style] ? style : 'ding', at: Date.now(), ok: false, steps: [], done: false };
        this.last = last;
        const step = (s) => { last.steps.push(s); this.log.info('chime ' + last.route + ': ' + s); };
        let conn = null, prev = null;
        const run = async () => {
            const file = this._file(vol === undefined ? 0.7 : vol, style);
            const am = await this._amReady();
            const lists = await Promise.all([this._call(am, 'getListMainSources'), this._call(am, 'getListMainConnections')]);
            const src = arr(lists[0]).find((x) => x && x.name === R.source);
            const sourceID = src ? src.sourceID : R.id;
            if (route === 'media') prev = arr(lists[1]).find((c) => c && c.sinkID === SINK && c.sourceID !== sourceID) || null;
            const r = await this._call(am, 'connect', { sourceID, sinkID: SINK });
            if (!okReply(r)) { step('з\'єднання ' + sourceID + ' > ' + SINK + ' відхилено: ' + short(r)); return; }
            conn = r.amError === 'E_ALREADY_EXISTS' ? null : r.mainConnectionID;
            if (conn !== null && conn !== undefined) this._remember(conn);
            let state = null;
            for (let k = 0; k < 8 && state !== 2; k++) {
                await this._w(200);
                const c = arr(await this._call(am, 'getListMainConnections')).find((x) => x && x.sourceID === sourceID && x.sinkID === SINK);
                state = c ? c.connectionState : null;
            }
            step('з\'єднання ' + sourceID + ' > ' + SINK + ': ' + (state === 2 ? 'є' : 'стан ' + state));
            if (!this.mp[R.inst]) this.mp[R.inst] = await this._proxy(MP, R.inst, 5000);
            const p = await this._call(this.mp[R.inst], 'playFile', { path: file, languageCode: 0 });
            step('playFile: ' + short(p));
            await this._w(500);
            let ps = null;
            const mp = this.mp[R.inst];
            try {
                ps = await Promise.race([new Promise((res) => setImmediate(() => res(mp.getValue ? mp.getValue('playerState', 2000) : null))), wait(2500).then(() => null)]);
            } catch (e) { ps = 'error ' + e.message; }
            if (ps !== null && ps !== undefined) step('плеєр: ' + short(ps));
            last.ok = true;
            await this._w(STYLES[last.style].len * 1000 + 500);
        };
        return run().catch((e) => { step('помилка: ' + (e && e.message || e)); })
            .then(async () => {
                if (conn !== null && conn !== undefined && this.am) {
                    try { step('відключено: ' + short(await this._call(this.am, 'disconnect', { mainConnectionID: conn }))); } catch (e) { step('відключення: ' + e.message); }
                    this._remember(null);
                }
                if (prev && this.am) {
                    await this._w(500);
                    try { step('повернуто джерело ' + prev.sourceID + ': ' + short(await this._call(this.am, 'connect', { sourceID: prev.sourceID, sinkID: SINK }))); } catch (e) { step('повернення джерела: ' + e.message); }
                }
                last.done = true;
                this.busy = false;
                return last;
            });
    }
}

module.exports = { Chime, wav, STYLES, ROUTES, MP };
