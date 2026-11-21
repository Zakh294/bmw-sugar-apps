'use strict';
/**
 * overlay.js - shows the camera warning on the HUD and the instrument cluster through cluster-render
 * (robertnisipeanu/idrive-apps, the service HUD Widgets, Cluster Themes and Maps on cluster draw with).
 *
 * Image layers of class "alert" (on top of every other app's layers), hidden while there is no warning:
 *   hud      the HUD, right of BMW's own speed and limit sign (which BMW draws over anything bottom left)
 *   cluster  a compact card in the lower part of the cluster (target panel), when no phone map shows
 *   map      a wide banner inside the phone's map (Waze, Google Maps, Apple Maps) on the cluster's map target,
 *            while Maps on cluster shows it there ("Inside the Waze / Google map" setting)
 *   hosted   the same banner on the panel, where an app (Cluster Themes) hosts the map inside its own scene: the
 *            service's "host" event says where the map lands, and the banner goes to the top of that rect
 * The phone sends its map as video only, so a camera cannot be pinned to its spot on the map; the banner is the
 * phone map's own warning strip instead. Which of cluster / map / hosted is used is decided when a warning starts
 * and kept until it ends: the map target shown by someone else (we only put a layer there while it is), or a host.
 * Plain Node 8.
 */
const { ClusterRender } = require('./cluster_render_client');
const badge = require('./badge');

const MAP = { w: 1088, h: 480 };
// at night (the sun below civil twilight at the car, "nightDim" on): the HUD to 60 %, the cluster pictures to 80 %
const NIGHT = { hud: 0.6, other: 0.8 };
const PLACE = {
    hud: { x: 372, y: 112 },
    cluster: { center: { x: 740, y: 468 }, left: { x: 150, y: 470 }, right: { x: 1330, y: 470 } },
    // the banner in the map's own pixels (1088x480); top: BMW's turn box is held off while a map shows
    map: { center: { x: 224, y: 16 }, left: { x: 36, y: 16 }, right: { x: 412, y: 16 } },
};

class Overlay {
    /** opts(): { hud, cluster, inMap, mapPlace, clusterPlace, size (%), hudBright (%), night, socketPath, tr, units } read on every paint. */
    constructor(appId, log, opts) {
        this.log = log;
        this.opts = opts;
        this.cr = new ClusterRender(appId, (opts() || {}).socketPath);
        this.layers = {};
        this.at = {};           // each layer's last { x, y, w, h }
        this.state = {};
        this.targets = {};
        this.mapByOthers = false;
        this.hosted = null;         // { x, y, w, h, src_x, src_y, src_w, src_h } of the map inside the panel
        this.mode = null;           // for the warning on the glass: 'cluster' | 'map' | 'hosted'
        this.ready = false;
        this.shown = null;
        this.lastKey = '';
        this.blink = false;
        this.cr.on('ready', () => {
            this.ready = true;
            this.log.info('cluster-render ready (' + (this.cr.backend || '?') + ')');
            this.lastKey = '';
            this._paint(true);
        });
        this.cr.on('disconnected', () => { this.ready = false; });
        this.cr.on('layer', (ref, state, reason) => {
            Object.keys(this.layers).forEach((k) => { if (this.layers[k] === ref) this.state[k] = state + (reason ? ' (' + reason + ')' : ''); });
        });
        this.cr.on('target', (name, state, holder) => {
            this.targets[name] = state + (holder && holder !== 'none' ? ' / ' + holder : '');
            // the map target is only ours while our banner is up: otherwise "shown" is someone's map
            if (name === 'map' && !(this.mode === 'map' && this.shown)) {
                const was = this.mapByOthers;
                this.mapByOthers = state === 'shown' || state === 'lingering';
                if (was !== this.mapByOthers) this.log.info('phone map on the cluster: ' + (this.mapByOthers ? 'shown' : 'gone'));
            }
        });
        this.cr.on('host', (target, ev) => {
            if (target !== 'map') return;
            const h = ev && ev.into === 'panel' && ev.shown !== 0 && ev.w > 0 && ev.h > 0 ? ev : null;
            this.hosted = h ? { x: h.x, y: h.y, w: h.w, h: h.h, src_x: h.src_x || 0, src_y: h.src_y || 0, src_w: h.src_w || MAP.w, src_h: h.src_h || MAP.h } : null;
            this.log.info('phone map ' + (this.hosted ? 'inside the cluster theme at ' + h.x + ',' + h.y + ' ' + h.w + 'x' + h.h : 'not hosted'));
        });
        this.cr.on('refused', (op, ref, reason) => this.log.warn('cluster-render refused ' + op + ': ' + reason));
    }

    start() {
        this.cr.connect();
        this.timer = setInterval(() => {
            if (!this.shown || this.shown.over !== 2) return;
            this.blink = !this.blink;
            try { this._paint(true); } catch (e) { this.log.warn('blink: ' + (e && e.stack || e)); }
        }, 500);
        return this;
    }

    stop() { clearInterval(this.timer); try { this.cr.close(); } catch (e) { /* exiting */ } }

    /** Where the banner goes when the map is hosted in the panel: the map's place mapped into the host rect. */
    _hostedPlace(place) {
        const h = this.hosted, p = PLACE.map[place] || PLACE.map.center, bw = badge.SIZE.map[0];
        const kx = h.w / h.src_w, ky = h.h / h.src_h;
        let x = Math.round(h.x + (p.x + bw / 2 - h.src_x) * kx - bw / 2);
        x = Math.max(h.x, Math.min(h.x + h.w - bw, x));
        const y = Math.round(h.y + Math.max(0, p.y - h.src_y) * ky);
        return { x: Math.max(0, x), y: Math.max(0, y) };
    }

    /**
     * Where layer k goes and how big: the image keeps its size (badge.SIZE), the layer is shown at size % of it
     * (the service scales). Anchors: HUD top left, cluster card bottom centre, map banner top centre.
     */
    _rect(k, o) {
        const kind = k === 'hosted' ? 'map' : k, iw = badge.SIZE[kind][0], ih = badge.SIZE[kind][1];
        const f = Math.max(0.5, Math.min(1, (o.size || 100) / 100));
        const w = Math.round(iw * f), h = Math.round(ih * f);
        let x, y;
        if (k === 'hud') { x = PLACE.hud.x; y = PLACE.hud.y; }
        else if (k === 'cluster') { const p = PLACE.cluster[o.clusterPlace] || PLACE.cluster.center; x = p.x + Math.round((iw - w) / 2); y = p.y + ih - h; }
        else if (k === 'map') { const p = PLACE.map[o.mapPlace] || PLACE.map.center; x = p.x + Math.round((iw - w) / 2); y = p.y; }
        else { const p = this._hostedPlace(o.mapPlace); x = p.x + Math.round((iw - w) / 2); y = p.y; }
        return { x, y, w, h, iw, ih };
    }

    _layer(k, o) {
        // the hosted banner once the theme stopped hosting the map: only hidden, where it was
        if (k === 'hosted' && !this.hosted) return this.layers.hosted || null;
        const r = this._rect(k, o), target = { hud: 'hud', cluster: 'panel', map: 'map', hosted: 'panel' }[k];
        if (!this.layers[k]) {
            this.layers[k] = this.cr.image({ target, klass: 'alert', z: 50, x: r.x, y: r.y, w: r.w, h: r.h, iw: r.iw, ih: r.ih, visible: false });
            this.at[k] = r;
        } else {
            const was = this.at[k];
            if (was.x !== r.x || was.y !== r.y || was.w !== r.w || was.h !== r.h) { this.cr.set(this.layers[k], { x: r.x, y: r.y, w: r.w, h: r.h }); this.at[k] = r; }
        }
        return this.layers[k];
    }

    /** alert (alerts.js) or null; warnDist for the bar. */
    show(alert, warnDist) {
        if (alert && !this.shown) {
            const o = this.opts();
            this.mode = o.inMap && this.hosted ? 'hosted' : o.inMap && this.mapByOthers ? 'map' : 'cluster';
            if (this.mode !== 'cluster') this.log.info('warning inside the phone map (' + this.mode + ')');
        }
        this.shown = alert;
        this.warnDist = warnDist;
        if (!alert) this.blink = false;
        this._paint(false);
        if (!alert) this.mode = null;
    }

    _paint(force) {
        const a = this.shown, o = this.opts();
        const mode = this.mode || 'cluster';
        const key = a ? [a.id, a.dist, a.speed, a.limit, a.over, a.label, this.blink, o.hud, o.cluster, mode, o.mapPlace, o.clusterPlace,
            o.size, o.hudBright, o.night, a.zone, o.units, o.tr && o.tr.lang].join('|') : 'off|' + o.hud + '|' + o.cluster;
        if (!force && key === this.lastKey) return;
        this.lastKey = key;
        const want = {
            hud: !!a && !!o.hud,
            cluster: !!a && !!o.cluster && mode === 'cluster',
            map: !!a && !!o.cluster && mode === 'map',
            hosted: !!a && !!o.cluster && mode === 'hosted',
        };
        ['hud', 'cluster', 'map', 'hosted'].forEach((k) => {
            if (!want[k] && !this.layers[k]) return;
            const ref = this._layer(k, o);
            if (!ref) return;
            if (want[k]) {
                const cv = badge.draw(a, k === 'hosted' ? 'map' : k, { warnDist: this.warnDist, blink: this.blink, tr: o.tr, units: o.units });
                // the HUD at its brightness setting; every screen a step down at night
                const lvl = (k === 'hud' ? (o.hudBright || 100) / 100 : 1) * (o.night ? (k === 'hud' ? NIGHT.hud : NIGHT.other) : 1);
                if (lvl < 0.995) badge.dim(cv, lvl);
                this.cr.pixels(ref, null, Buffer.from(cv.d.buffer, cv.d.byteOffset, cv.d.byteLength));
            }
            this.cr.set(ref, { visible: want[k] });
        });
    }

    /** For the page. */
    status() {
        return {
            connected: this.ready && this.cr.ready,
            hud: this.state.hud || '-', cluster: this.state.cluster || '-', map: this.state.map || this.state.hosted || '-',
            phoneMap: this.hosted ? 'inside the cluster theme' : this.mapByOthers ? 'on the cluster' : null,
            mode: this.mode,
            targets: Object.keys(this.targets).map((k) => k + ': ' + this.targets[k]).join(', '),
        };
    }
}

module.exports = { Overlay, PLACE };
