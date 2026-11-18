'use strict';
/**
 * overlay.js - shows the camera warning on the HUD and the instrument cluster through cluster-render
 * (robertnisipeanu/idrive-apps, the service HUD Widgets and Cluster Themes draw with).
 *
 * One image layer per screen, class "alert" (on top of every other app's layers). Hidden while there is no warning, so
 * the screen's slot is released and nothing of ours is on the glass; shown with the badge while a camera comes up,
 * redrawn when the distance, speed or limit shown changes and twice a second to blink past the fine threshold.
 * The HUD layer sits right of BMW's own speed and limit sign (bottom left of the HUD window, which BMW draws over
 * anything), the cluster one in the lower middle, clear of the seat-belt light (shared/visible.js of bimmer-lab/apps).
 * Plain Node 8.
 */
const { ClusterRender } = require('./cluster_render_client');
const badge = require('./badge');

const PLACE = {
    hud: { x: 372, y: 112 },
    cluster: { center: { x: 740, y: 468 }, left: { x: 150, y: 470 }, right: { x: 1330, y: 470 } },
};

class Overlay {
    /** opts(): { hud: bool, cluster: bool, clusterPlace, units, socketPath } read on every show. */
    constructor(appId, log, opts) {
        this.log = log;
        this.opts = opts;
        this.cr = new ClusterRender(appId, (opts() || {}).socketPath);
        this.layers = {};
        this.state = { hud: 'none', cluster: 'none' };
        this.targets = {};
        this.ready = false;
        this.shown = null;          // the alert on the glass
        this.lastKey = '';
        this.blink = false;
        this.cr.on('ready', () => {
            this.ready = true;
            this.log.info('cluster-render ready (' + (this.cr.backend || '?') + ', targets ' + (this.cr.targets || '?') + ')');
            this.lastKey = '';
            this._paint(true);
        });
        this.cr.on('layer', (ref, state, reason) => {
            Object.keys(this.layers).forEach((k) => { if (this.layers[k] === ref) this.state[k] = state + (reason ? ' (' + reason + ')' : ''); });
        });
        this.cr.on('target', (name, state, holder) => { this.targets[name] = state + (holder ? ' / ' + holder : ''); });
        this.cr.on('refused', (op, ref, reason) => this.log.warn('cluster-render refused ' + op + ': ' + reason));
        this.cr.on('disconnected', () => { this.ready = false; });
    }

    start() {
        this._make();
        this.cr.connect();
        this.timer = setInterval(() => {
            if (!this.shown || this.shown.over !== 2) return;
            this.blink = !this.blink;
            this._paint(true);
        }, 500);
        return this;
    }

    stop() { clearInterval(this.timer); try { this.cr.close(); } catch (e) { /* exiting */ } }

    _make() {
        const o = this.opts();
        const hs = badge.SIZE.hud, cs = badge.SIZE.cluster, cp = PLACE.cluster[o.clusterPlace] || PLACE.cluster.center;
        if (!this.layers.hud) {
            this.layers.hud = this.cr.image({ target: 'hud', klass: 'alert', z: 50, x: PLACE.hud.x, y: PLACE.hud.y, w: hs[0], h: hs[1], visible: false });
        }
        if (!this.layers.cluster) {
            this.layers.cluster = this.cr.image({ target: 'panel', klass: 'alert', z: 50, x: cp.x, y: cp.y, w: cs[0], h: cs[1], visible: false });
            this.clusterPlace = o.clusterPlace;
        } else if (o.clusterPlace !== this.clusterPlace) {
            this.cr.set(this.layers.cluster, { x: cp.x, y: cp.y });
            this.clusterPlace = o.clusterPlace;
        }
    }

    /** alert (alerts.js) or null; warnDist for the bar. */
    show(alert, warnDist) {
        this.shown = alert;
        this.warnDist = warnDist;
        if (!alert) this.blink = false;
        this._paint(false);
    }

    _paint(force) {
        const a = this.shown, o = this.opts();
        this._make();
        const key = a ? [a.id, a.dist, a.speed, a.limit, a.over, this.blink, o.hud, o.cluster, o.units].join('|') : 'off|' + o.hud + '|' + o.cluster;
        if (!force && key === this.lastKey) return;
        this.lastKey = key;
        ['hud', 'cluster'].forEach((k) => {
            const ref = this.layers[k];
            if (!ref) return;
            const want = !!a && !!o[k];
            if (want) {
                const cv = badge.draw(a, k, { warnDist: this.warnDist, blink: this.blink, units: o.units });
                this.cr.pixels(ref, null, Buffer.from(cv.d.buffer, cv.d.byteOffset, cv.d.byteLength));
            }
            this.cr.set(ref, { visible: want });
        });
    }

    /** For the page. */
    status() {
        return {
            connected: this.ready && this.cr.ready,
            hud: this.state.hud, cluster: this.state.cluster,
            targets: Object.keys(this.targets).map((k) => k + ': ' + this.targets[k]).join(', '),
        };
    }
}

module.exports = { Overlay, PLACE };
