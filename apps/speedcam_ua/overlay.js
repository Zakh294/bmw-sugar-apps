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
const PLACE = {
    hud: { x: 372, y: 112 },
    cluster: { center: { x: 740, y: 468 }, left: { x: 150, y: 470 }, right: { x: 1330, y: 470 } },
    // the banner in the map's own pixels (1088x480); top: BMW's turn box is held off while a map shows
    map: { center: { x: 224, y: 16 }, left: { x: 36, y: 16 }, right: { x: 412, y: 16 } },
};

class Overlay {
    /** opts(): { hud, cluster, inMap, mapPlace, clusterPlace, socketPath } read on every paint. */
    constructor(appId, log, opts) {
        this.log = log;
        this.opts = opts;
        this.cr = new ClusterRender(appId, (opts() || {}).socketPath);
        this.layers = {};
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
            this._paint(true);
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

    _layer(k, o) {
        const hs = badge.SIZE.hud, cs = badge.SIZE.cluster, ms = badge.SIZE.map;
        if (k === 'hud') {
            if (!this.layers.hud) this.layers.hud = this.cr.image({ target: 'hud', klass: 'alert', z: 50, x: PLACE.hud.x, y: PLACE.hud.y, w: hs[0], h: hs[1], visible: false });
        } else if (k === 'cluster') {
            const p = PLACE.cluster[o.clusterPlace] || PLACE.cluster.center;
            if (!this.layers.cluster) { this.layers.cluster = this.cr.image({ target: 'panel', klass: 'alert', z: 50, x: p.x, y: p.y, w: cs[0], h: cs[1], visible: false }); this.at = { cluster: p }; }
            else if (this.at.cluster !== p) { this.cr.set(this.layers.cluster, { x: p.x, y: p.y }); this.at.cluster = p; }
        } else if (k === 'map') {
            const p = PLACE.map[o.mapPlace] || PLACE.map.center;
            if (!this.layers.map) { this.layers.map = this.cr.image({ target: 'map', klass: 'alert', z: 50, x: p.x, y: p.y, w: ms[0], h: ms[1], visible: false }); this.atMap = p; }
            else if (this.atMap !== p) { this.cr.set(this.layers.map, { x: p.x, y: p.y }); this.atMap = p; }
        } else if (k === 'hosted') {
            const p = this._hostedPlace(o.mapPlace);
            if (!this.layers.hosted) { this.layers.hosted = this.cr.image({ target: 'panel', klass: 'alert', z: 50, x: p.x, y: p.y, w: ms[0], h: ms[1], visible: false }); this.atHost = p; }
            else if (!this.atHost || this.atHost.x !== p.x || this.atHost.y !== p.y) { this.cr.set(this.layers.hosted, { x: p.x, y: p.y }); this.atHost = p; }
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
        const key = a ? [a.id, a.dist, a.speed, a.limit, a.over, a.label, this.blink, o.hud, o.cluster, mode, o.mapPlace, o.clusterPlace].join('|')
            : 'off|' + o.hud + '|' + o.cluster;
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
            if (want[k]) {
                const cv = badge.draw(a, k === 'hosted' ? 'map' : k, { warnDist: this.warnDist, blink: this.blink });
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
