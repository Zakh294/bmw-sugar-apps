'use strict';
/**
 * SpeedCam UA - offline warnings for Ukraine's automatic speed cameras on the HUD and the instrument cluster.
 *
 * Runs in the background from start-up (app.json "autostart"): the car's position from its own navigation
 * (position.js), the official camera list built in (cameras.js, no internet), the warning logic (alerts.js) and the
 * picture on the HUD / cluster through cluster-render (overlay.js). The page on the center screen only shows the
 * state and has the test button; it is not needed for the warnings.
 * Plain Node 8 (the car's 8.16.2).
 */
const mgu = require('./kit/mgu');
const DB = require('./cameras');
const { translit } = require('./translit');
const { PositionSource, mono } = require('./position');
const { AlertEngine } = require('./alerts');
const { Overlay } = require('./overlay');
const geo = require('./geo');
let CANDS;
try { CANDS = require('./position_candidates'); } catch (e) { CANDS = { list: [], note: 'position_candidates.js missing' }; }

const W = 1600, H = 520;
const SPEED = { iface: 'de.bmw.infotainment.vehicle.Vehicle2', field: 'statusCarSpeed2', factor: 0.015625, invalid: 65535 };

/** The road index in Latin letters (М-06 -> M-06) for the kit's fonts. */
function latinRoad(r) { return String(r || '').replace(/М/g, 'M').replace(/Н/g, 'H').replace(/Р/g, 'P').replace(/Т/g, 'T').replace(/О/g, 'O'); }

function cameras() {
    return DB.rows.map((r) => ({
        id: r[0], lat: r[1], lon: r[2], limit: r[3],
        label: r[4] ? latinRoad(r[4]) + ' km ' + r[5] : translit(r[7]) + ', ' + translit(r[6]).replace(/^m\. /, ''),
    }));
}

/** A made-up camera run for the test button: 800 m to 0 in 12 s, then 2 s past it. */
function testAlert(test, speed) {
    const t = (Date.now() - test.t0) / 1000;
    const dist = Math.max(0, 800 - t * 800 / 12);
    const sp = speed > 5 ? Math.round(speed) : 72;
    return { id: -1, dist: Math.round(dist / 10) * 10, limit: 50, speed: sp, over: sp > 70 ? 2 : sp > 50 ? 1 : 0, label: 'TEST' };
}

/** Everything that runs with or without the page. */
function background(bg) {
    const { settings, signals, log } = bg;
    const list = cameras();
    const st = { speed: null, speedT: 0, fix: null, lastFixT: -1, alert: null, test: null, heading: null, alerts: 0 };
    log.info('cameras: ' + list.length + ' (list of ' + DB.meta.fetched + '); position candidates: ' + CANDS.list.length +
        (CANDS.note ? ' (' + CANDS.note + ')' : ''));

    const handlers = {};
    handlers[SPEED.field] = (v) => {
        const raw = v && v.speedVehicleCentreOfGravity;
        if (typeof raw === 'number' && raw !== SPEED.invalid) { st.speed = raw * SPEED.factor; st.speedT = mono(); }
    };
    if (signals && signals.watch) Promise.resolve(signals.watch(SPEED.iface, '1', handlers, log)).catch((e) => log.warn('speed: ' + e));

    const pos = new PositionSource(signals, log, CANDS.list).start();
    const eng = new AlertEngine(list, () => ({ lead: settings.get('lead'), minWarn: settings.get('minWarn'), maxWarn: 1200, tolerance: settings.get('tolerance') }));
    const ov = new Overlay(bg.spec.id, log, () => ({
        hud: settings.get('showHud'), cluster: settings.get('showCluster'), clusterPlace: settings.get('clusterPlace'), units: 'kmh',
        socketPath: bg.spec.config && bg.spec.config.socketPath,
    })).start();

    const tick = () => {
        try {
            const speed = st.speed !== null && mono() - st.speedT < 5000 ? st.speed : 0;
            const fix = pos.fix();
            st.fix = fix;
            let alert = null;
            if (st.test && Date.now() - st.test.t0 < 14000) alert = testAlert(st.test, speed);
            else {
                st.test = null;
                if (settings.get('enabled') && fix && fix.t !== st.lastFixT) {
                    st.lastFixT = fix.t;
                    st.alert = eng.update(fix, speed);
                    st.heading = eng.track.heading;
                    if (st.alert && (!st.prev || st.prev.id !== st.alert.id)) { st.alerts++; log.info('camera ahead: #' + st.alert.id + ' ' + st.alert.label + ', ' + st.alert.dist + ' m'); }
                    st.prev = st.alert;
                } else if (!settings.get('enabled') || !fix) st.alert = null;
                alert = st.alert;
            }
            ov.show(alert, eng.warnDistance(speed));
        } catch (e) { log.warn('tick: ' + (e && e.stack || e)); }
    };
    setInterval(tick, 250);
    process.on('exit', () => ov.stop());
    return { st, pos, eng, ov, list };
}

function fmtAge(s) { return s === null ? '-' : s < 2 ? 'now' : s < 120 ? s + ' s ago' : Math.round(s / 60) + ' min ago'; }

mgu.run({
    background,
    async start(ctx) {
        const { ui, settings } = ctx;
        const core = ctx.background || background(ctx);
        const st = core.st;
        ui.onClick('BTN_TEST', () => { st.test = { t0: Date.now() }; ctx.log.info('test warning'); });

        const render = async () => {
            const t = ctx.theme(), cv = ctx.canvas(W, H).clear(t.bg);
            const L = (s, x, y, size, c, o) => cv.text(String(s), x, y, size, c || t.text || '#ffffff', Object.assign({ literal: true }, o || {}));
            const dim = t.dim || '#8a93a0', ok = '#2fd27a', warn = '#ffb31a', bad = '#ff4040';
            L('SpeedCam UA', 40, 56, 44, '#ffffff', { font: 'bold' });
            L(core.list.length + ' cameras, official list of ' + DB.meta.fetched + ' (patrolpolice.gov.ua)', 360, 54, 24, dim);

            // position
            const fix = st.fix, ps = core.pos.status();
            let y = 112;
            L('POSITION', 40, y, 22, dim, { font: 'bold' });
            if (fix) {
                L(fix.lat.toFixed(5) + ', ' + fix.lon.toFixed(5), 220, y, 30, ok, { font: 'bold' });
                L('from ' + fix.src + (st.heading !== null ? ', heading ' + Math.round(st.heading) + ' deg' : ', heading: drive a little'), 620, y, 24, dim);
            } else if (!CANDS.list.length) {
                L('No GPS source found on this unit', 220, y, 30, bad, { font: 'bold' });
                L(CANDS.note || 'run tools/find_position.js over SSH (README)', 700, y, 22, dim);
            } else {
                L('waiting for the navigation (' + CANDS.list.length + ' sources watched)', 220, y, 30, warn, { font: 'bold' });
            }
            y += 46;
            L('SPEED', 40, y, 22, dim, { font: 'bold' });
            L(st.speed === null ? '-' : Math.round(st.speed) + ' km/h', 220, y, 30, '#ffffff', { font: 'bold' });

            // nearest camera and the warning
            const n = core.eng.nearest(fix);
            L('NEAREST', 620, y, 22, dim, { font: 'bold' });
            L(n ? (n.d >= 10000 ? Math.round(n.d / 1000) + ' km' : n.d >= 1000 ? (n.d / 1000).toFixed(1) + ' km' : Math.round(n.d) + ' m') + '  ' + n.cam.limit + '  ' + n.cam.label : '-', 790, y, 26, '#ffffff');
            y += 46;
            const a = st.test ? null : st.alert;
            L('WARNING', 40, y, 22, dim, { font: 'bold' });
            L(st.test ? 'test running on the HUD / cluster' : a ? 'camera in ' + a.dist + ' m, limit ' + a.limit + ' - ' + a.label : settings.get('enabled') ? 'none (' + st.alerts + ' this drive)' : 'warnings are off (Settings)', 220, y, 28, st.test || a ? warn : '#ffffff', { font: 'bold' });

            // the screens
            y += 46;
            const ov = core.ov.status();
            L('DISPLAY', 40, y, 22, dim, { font: 'bold' });
            L(ov.connected ? 'cluster-render connected' : 'cluster-render not reachable (install it from the Store)', 220, y, 26, ov.connected ? ok : bad);
            L('HUD ' + (settings.get('showHud') ? ov.hud : 'off') + ' / cluster ' + (settings.get('showCluster') ? ov.cluster : 'off'), 820, y, 22, dim);

            // the candidates
            y += 52;
            L('GPS SOURCES ON THIS UNIT' + (CANDS.built ? ' (found ' + CANDS.built + ')' : ''), 40, y, 22, dim, { font: 'bold' });
            ps.slice(0, 5).forEach((c, i) => {
                const yy = y + 34 + i * 30;
                const col = c.inUse ? ok : c.count ? '#ffffff' : c.error ? bad : dim;
                L((c.inUse ? '> ' : '  ') + c.name, 40, yy, 22, col);
                L(c.error ? 'error: ' + c.error.slice(0, 50) : c.count ? c.count + ' fixes, ' + (c.scale || '?') + ', ' + fmtAge(c.age) : c.misses ? c.misses + ' values, no lat/lon' : 'nothing yet', 900, yy, 22, col);
            });
            await ui.image('MAIN_GFX', cv);
        };
        ctx.loop('MAIN', 2, render);
    },
});

