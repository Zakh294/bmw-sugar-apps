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
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const DB = require('./cameras');
const { PositionSource, mono } = require('./position');
const { AlertEngine } = require('./alerts');
const { Overlay } = require('./overlay');
const sun = require('./sun');
const sound = require('./sound');
const { Chime } = require('./chime');
const geo = require('./geo');
let CANDS;
try { CANDS = require('./position_candidates'); } catch (e) { CANDS = { list: [], note: 'position_candidates.js missing' }; }

const W = 1600, H = 520;
const SPEED = { iface: 'de.bmw.infotainment.vehicle.Vehicle2', field: 'statusCarSpeed2', factor: 0.015625, invalid: 65535 };

/** "М-06, км 21+730" on a road, "Львів, вул. Городоцька, 120" in a city (the kit's cyrillic atlas draws it). */
function cameras() {
    return DB.rows.map((r) => ({
        id: r[0], lat: r[1], lon: r[2], limit: r[3],
        label: r[4] ? r[4] + ', км ' + r[5] : String(r[6]).replace(/^м\.\s*/, '') + ', ' + r[7],
    }));
}

/** A made-up camera run for the test button: 800 m to 0 in 12 s, then 2 s past it. */
function testAlert(test, speed) {
    const t = (Date.now() - test.t0) / 1000;
    const dist = Math.max(0, 800 - t * 800 / 12);
    const sp = speed > 5 ? Math.round(speed) : 72;
    return { id: -1, dist: Math.round(dist / 10) * 10, limit: 50, speed: sp, over: sp > 70 ? 2 : sp > 50 ? 1 : 0, label: 'Тест: Львів, вул. Городоцька, 120' };
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
        hud: settings.get('showHud'), cluster: settings.get('showCluster'), clusterPlace: settings.get('clusterPlace'),
        inMap: settings.get('inMap'), mapPlace: settings.get('mapPlace'),
        size: settings.get('size'), hudBright: settings.get('hudBright'), night: !!settings.get('nightDim') && st.night,
        socketPath: bg.spec.config && bg.spec.config.socketPath,
    })).start();

    // night: the sun below civil twilight where the car is (the middle of Ukraine until the first fix), once a minute
    st.night = false;
    const nightCheck = () => {
        const f = st.fix || st.lastPlace || { lat: 49.0, lon: 31.0 };
        if (st.fix) st.lastPlace = { lat: st.fix.lat, lon: st.fix.lon };
        const n = sun.isNight(f.lat, f.lon, Date.now());
        if (n !== st.night) log.info('night: ' + n);
        st.night = n;
    };
    nightCheck();
    setInterval(nightCheck, 60000);
    st.audio = sound.probe(signals, log);
    st.alsa = sound.alsaInfo();
    const chime = new Chime(signals, log, { dataDir: bg.dataDir });
    st.chime = chime;
    setTimeout(() => { chime.sweep().catch(() => {}); }, 25000);
    st.ding = (why) => {
        const route = settings.get('sound');
        if (route === 'off' && why !== 'button') return;
        const style = why === 'over' && settings.get('soundOver') ? 'alarm' : settings.get('soundStyle') || 'ding';
        chime.play(route === 'off' ? 'overlay' : route, (settings.get('soundVol') || 70) / 100, style);
    };
    st.chimed = { key: null, over: false };
    // what the installer left out because this unit lacks it (kit/missing-interfaces.json)
    try {
        const miss = JSON.parse(fs.readFileSync(path.join(__dirname, 'kit', 'missing-interfaces.json'), 'utf8'));
        st.mpMissing = Object.keys(miss).filter((k) => /mediaplayer|commandcontrol/i.test(k)).map((k) => k.replace(/^.*\.(\w+:?)/, '$1')).join('; ') || null;
    } catch (e) { st.mpMissing = null; }
    log.info('audio: alsa cards ' + JSON.stringify(st.alsa.cards) + ', pcm ' + JSON.stringify(st.alsa.pcm)
        + ', asound.conf ' + JSON.stringify(st.alsa.confPcm) + ', players ' + JSON.stringify(st.alsa.players));

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
                // "only when I'm over the limit": the warning stays off while the speed is within it (+ tolerance)
                if (alert && settings.get('showWhen') === 'over' && !alert.over) alert = null;
            }
            ov.show(alert, eng.warnDistance(speed));
            // the chime: when a warning appears, and again when the speed goes over its limit
            const key = alert ? (alert.id === -1 ? 'test' + st.test.t0 : alert.id) : null;
            if (key !== st.chimed.key) { if (key !== null) st.ding('alert'); st.chimed = { key, over: !!(alert && alert.over) }; }
            else if (alert && alert.over && !st.chimed.over) { st.chimed.over = true; st.ding('over'); }
        } catch (e) { log.warn('tick: ' + (e && e.stack || e)); }
    };
    setInterval(tick, 250);
    process.on('exit', () => ov.stop());
    return { st, pos, eng, ov, list };
}

/** The sound probe in full: every source and sink of the audio manager, likely chime carriers in yellow, ALSA below. */
function audioPage(st, L, c) {
    const au = st.audio || {};
    L('АУДІО-ДЖЕРЕЛА', 40, 50, 36);
    L('жовтим: можуть підійти для сигналу · ще раз «Аудіо-джерела» — назад', 400, 48, 22, c.dim);
    if (!au.done) { L(au.tries ? 'аудіосистема ще не готова, спроба ' + au.tries + '…' : 'чекаю на аудіосистему…', 40, 110, 28, c.warn); }
    else if (!au.sources.length) { L('немає відповіді: ' + String(au.error || '').slice(0, 90), 40, 110, 26, c.bad); }
    const sinks = (au.sinks || []).map((s) => s.id + ' ' + s.name).join(' · ');
    L('ВИХОДИ (' + (au.sinks || []).length + ')', 40, 92, 20, c.dim);
    L(sinks.slice(0, 120), 200, 92, 20);
    const src = au.sources || [], ROWS = 16, COLW = 390;
    L('ДЖЕРЕЛА (' + src.length + ')', 40, 124, 20, c.dim);
    src.slice(0, ROWS * 4).forEach((s, i) => {
        const x = 40 + Math.floor(i / ROWS) * COLW, y = 146 + (i % ROWS) * 20;
        L(s.id + ' ' + String(s.name).slice(0, 26) + (s.cls !== undefined ? ' ·' + s.cls : ''), x, y, 18, sound.CANDIDATE.test(s.name) ? c.warn : '#ffffff');
    });
    if (src.length > ROWS * 4) L('+ ще ' + (src.length - ROWS * 4) + ' (повний список у лозі)', 40 + 3 * COLW, 146 + ROWS * 20, 18, c.dim);
    const yy = 146 + ROWS * 20 + 4, ch = st.chime && st.chime.last;
    L('ТЕСТ ЗВУКУ', 40, yy, 20, c.dim);
    if (!ch) L('ще не було · кнопка «Тест звуку» внизу (маршрут — у Налаштуваннях: «Звук попередження»)', 200, yy, 20);
    else {
        L(ROUTE_UA[ch.route] + ' · «' + (STYLE_UA[ch.style] || ch.style) + '»' + (ch.done ? '' : ' · грає…') + ' · ' + new Date(ch.at).toTimeString().slice(0, 8), 200, yy, 20, ch.done ? (ch.ok ? c.ok : c.bad) : c.warn);
        L(ch.steps.join(' · ').slice(0, 150), 200, yy + 24, 18);
    }
    if (st.mpMissing) L('немає на блоці: ' + st.mpMissing.slice(0, 60), 900, yy, 18, c.bad);
}

const STYLE_UA = { ding: 'дзень', gong: 'гонг', beep3: 'три біпи', soft: 'м\'який', radar: 'радар', alarm: 'тривога' };
const ROUTE_UA = { overlay: 'поверх музики (OAPGenericOverlay)', interrupt: 'перериває музику (OAPGenericInterrupt)', media: 'через медіаплеєр (OAPGenericMedia)' };

function fmtAge(s) { return s === null ? '–' : s < 2 ? 'щойно' : s < 120 ? s + ' с тому' : Math.round(s / 60) + ' хв тому'; }

mgu.run({
    background,
    async start(ctx) {
        const { ui, settings } = ctx;
        const core = ctx.background || background(ctx);
        const st = core.st;
        ui.onClick('BTN_TEST', () => { st.page = null; st.test = { t0: Date.now() }; ctx.log.info('test warning'); });
        ui.onClick('BTN_SOUND', () => { st.page = 'audio'; st.ding('button'); });
        ui.onClick('BTN_AUDIO', () => { st.page = st.page === 'audio' ? null : 'audio'; });

        const render = async () => {
            const t = ctx.theme(), cv = ctx.canvas(W, H).clear(t.bg);
            const L = (s, x, y, size, c) => cv.text(String(s), x, y, size, c || '#ffffff', { literal: true });
            const dim = '#8a93a0', ok = '#2fd27a', warn = '#ffb31a', bad = '#ff4040';
            if (st.page === 'audio') { audioPage(st, L, { dim, ok, warn, bad }); await ui.image('MAIN_GFX', cv); return; }
            const km = (d) => (d >= 10000 ? Math.round(d / 1000) + ' км' : d >= 1000 ? (d / 1000).toFixed(1).replace('.', ',') + ' км' : Math.round(d) + ' м');
            L('SpeedCam UA', 40, 56, 44);
            L(core.list.length + ' камер · офіційний список від ' + DB.meta.fetched + ' (patrolpolice.gov.ua)', 360, 54, 24, dim);

            const fix = st.fix, ps = core.pos.status();
            let y = 112;
            L('ПОЗИЦІЯ', 40, y, 22, dim);
            if (fix) {
                L(fix.lat.toFixed(5) + ', ' + fix.lon.toFixed(5), 250, y, 30, ok);
                L('з ' + fix.src + (st.heading !== null ? ', курс ' + Math.round(st.heading) + '°' : ', курс: проїдьте трохи'), 650, y, 24, dim);
            } else if (!CANDS.list.length) {
                L('GPS-джерело не знайдено на цьому блоці', 250, y, 30, bad);
                L('див. docs/speedcam_ua: find_position.js', 900, y, 22, dim);
            } else {
                L('чекаю на навігацію (джерел: ' + CANDS.list.length + ')', 250, y, 30, warn);
            }
            y += 46;
            L('ШВИДКІСТЬ', 40, y, 22, dim);
            L(st.speed === null ? '–' : Math.round(st.speed) + ' км/год', 250, y, 30);
            const n = core.eng.nearest(fix);
            L('НАЙБЛИЖЧА', 560, y, 22, dim);
            L(n ? km(n.d) + ' · ' + n.cam.limit + ' · ' + n.cam.label : '–', 720, y, 26);
            y += 46;
            const a = st.test ? null : st.alert;
            L('КАМЕРА', 40, y, 22, dim);
            L(st.test ? 'тест: дивіться на HUD і приладку' : a ? 'через ' + a.dist + ' м, ліміт ' + a.limit + ' · ' + a.label
                : settings.get('enabled') ? 'немає поруч (за поїздку: ' + st.alerts + ')' : 'попередження вимкнені (Налаштування)', 250, y, 28, st.test || a ? warn : '#ffffff');
            y += 46;
            const ov = core.ov.status();
            L('ЕКРАНИ', 40, y, 22, dim);
            L(ov.connected ? 'cluster-render підключено' : 'cluster-render недоступний (встановіть зі Store)', 250, y, 26, ov.connected ? ok : bad);
            L(ov.phoneMap ? 'мапа телефона ' + (ov.phoneMap === 'on the cluster' ? 'на приладці' : 'в темі приладки') + (settings.get('inMap') ? ': банер у мапі' : '') : 'мапи телефона на приладці немає', 820, y, 22, ov.phoneMap ? ok : dim);
            y += 52;
            L('ДЖЕРЕЛА GPS НА БЛОЦІ' + (CANDS.built ? ' (знайдено ' + CANDS.built + ')' : ''), 40, y, 22, dim);
            ps.slice(0, 3).forEach((c, i) => {
                const yy = y + 34 + i * 30;
                const col = c.inUse ? ok : c.count ? '#ffffff' : c.error ? bad : dim;
                L((c.inUse ? '> ' : '  ') + c.name, 40, yy, 22, col);
                L(c.error ? 'помилка: ' + c.error.slice(0, 50) : c.count ? c.count + ' фіксів, ' + (c.scale || '?') + ', ' + fmtAge(c.age) : c.misses ? c.misses + ' значень без координат' : 'ще нічого', 900, yy, 22, col);
            });
            const au = st.audio || {};
            const ch = st.chime && st.chime.last;
            const auLine = !ch ? null : 'сигнал ' + (ch.done ? (ch.ok ? 'надіслано' : 'не пройшов') : 'грає…') + ': ' + ch.steps.slice(-1).join('').slice(0, 70) + ' · деталі: «Аудіо-джерела»';
            L('ЗВУК', 40, y + 34 + 3 * 30 + 14, 22, dim);
            L(auLine ? auLine : !au.done ? (au.tries ? 'аудіосистема ще не готова, спроба ' + au.tries + '…' : 'чекаю на аудіосистему…') : au.error && !au.sources.length ? 'немає відповіді: ' + String(au.error).slice(0, 60)
                : au.sources.length + ' джерел, ' + au.sinks.length + ' виходів · повний список: кнопка «Аудіо-джерела» внизу', 330, y + 34 + 3 * 30 + 14, 22, au.done && au.sources.length ? '#ffffff' : dim);
            await ui.image('MAIN_GFX', cv);
        };
        ctx.loop('MAIN', 2, render);
    },
});

