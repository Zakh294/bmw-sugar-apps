'use strict';
/**
 * SpeedCam - offline warnings for speed cameras on the HUD and the instrument cluster: Ukraine (the Patrol Police's
 * official list), Europe and the USA (OpenStreetMap), in eight languages.
 *
 * Runs in the background from start-up (app.json "autostart"): the car's position from its own navigation
 * (position.js), the camera packs built in and updated once a month (packs.js, updater.js), the warning logic
 * (alerts.js), the picture on the HUD / cluster through cluster-render (overlay.js) and a chime (chime.js).
 * Where a country does not allow camera warnings while driving, they are off unless the owner switches them on
 * (setting "banned"); in France only a danger zone is shown, never the camera's place.
 * The page on the center screen shows the state; "Camera databases" chooses the packs. Not needed for the warnings.
 * Plain Node 8 (the car's 8.16.2).
 */
const fs = require('fs');
const path = require('path');
const mgu = require('./kit/mgu');
const { PositionSource, mono } = require('./position');
const { AlertEngine } = require('./alerts');
const { Overlay } = require('./overlay');
const { Packs } = require('./packs');
const { Updater } = require('./updater');
const badge = require('./badge');
const lang = require('./lang');
const sun = require('./sun');
const sound = require('./sound');
const { Chime } = require('./chime');
const geo = require('./geo');

let CANDS;
try { CANDS = require('./position_candidates'); } catch (e) { CANDS = { list: [], note: 'position_candidates.js missing' }; }

const W = 1600, H = 520;
const SPEED = { iface: 'de.bmw.infotainment.vehicle.Vehicle2', field: 'statusCarSpeed2', factor: 0.015625, invalid: 65535 };
const BUTTONS = { BTN_TEST: 'btn_test', BTN_DB: 'btn_db', BTN_SOUND: 'btn_sound', BTN_AUDIO: 'btn_audio', BTN_SETTINGS: 'btn_settings' };
const GROUPS = ['ua', 'eu', 'us'];

/** A made-up camera run for the test button: 800 m to 0 in 12 s, then 2 s past it. */
function testAlert(test, speed, tr) {
    const t = (Date.now() - test.t0) / 1000;
    const dist = Math.max(0, 800 - t * 800 / 12);
    const sp = speed > 5 ? Math.round(speed) : 72;
    return { id: -1, dist: Math.round(dist / 10) * 10, limit: 50, speed: sp, over: sp > 70 ? 2 : sp > 50 ? 1 : 0, label: tr('test_label'), units: 'kmh', zone: false };
}

/** Everything that runs with or without the page. */
function background(bg) {
    const { settings, signals, log } = bg;
    const packs = new Packs({ dir: path.join(__dirname, 'packs'), dataDir: bg.dataDir, log });
    const st = { speed: null, speedT: 0, fix: null, lastFixT: -1, alert: null, test: null, heading: null, alerts: 0, codes: [], count: 0, banned: null };
    // the language: chosen, or "automatic" = the language of the country the car is in (the last one kept for the
    // next start, so the page does not come up in another language before the first fix)
    const langFile = bg.dataDir ? path.join(bg.dataDir, 'lang.txt') : null;
    try { st.autoLang = fs.readFileSync(langFile, 'utf8').trim() || null; } catch (e) { st.autoLang = null; }
    const curLang = () => (settings.get('lang') === 'auto' || !settings.get('lang') ? st.autoLang || 'uk' : settings.get('lang'));
    const tr = () => lang.make(curLang());
    // the settings in that language; the "Made in Ukraine" row is a text, its value set here (never a choice)
    const applyLang = (l) => {
        lang.settings(settings.schema, l);
        const u = settings.item('ukraine');
        if (u) settings.values.ukraine = u.default;
    };
    st.langNow = curLang();
    applyLang(st.langNow);
    const langCheck = () => {
        const l = curLang();
        if (l === st.langNow) return;
        st.langNow = l;
        applyLang(l);
        log.info('language: ' + l);
        if (st.onLang) st.onLang();
    };
    settings.onChange((k) => { if (k === 'lang') langCheck(); });

    const handlers = {};
    handlers[SPEED.field] = (v) => {
        const raw = v && v.speedVehicleCentreOfGravity;
        if (typeof raw === 'number' && raw !== SPEED.invalid) { st.speed = raw * SPEED.factor; st.speedT = mono(); }
    };
    if (signals && signals.watch) Promise.resolve(signals.watch(SPEED.iface, '1', handlers, log)).catch((e) => log.warn('speed: ' + e));

    const pos = new PositionSource(signals, log, CANDS.list).start();
    const eng = new AlertEngine([], () => ({ lead: settings.get('lead'), minWarn: settings.get('minWarn'), maxWarn: 1200, tolerance: settings.get('tolerance') }));

    // the packs in use: the chosen ones + (automatic) the ones where the car is; looked at every 30 s and every 2 km
    const refreshPacks = (force) => {
        // the country the car is in (its nearest camera's pack): the language for "automatic"
        const here = st.fix ? packs.here(st.fix.lat, st.fix.lon) : null;
        if (here) {
            const al = lang.forCountry(here);
            if (al !== st.autoLang) { st.autoLang = al; try { if (langFile) fs.writeFileSync(langFile, al); } catch (e) { /* read-only */ } langCheck(); }
        }
        const codes = packs.active(st.fix);
        if (!force && codes.join() === st.codes.join()) return;
        const list = packs.cameras(codes);
        eng.setCameras(list);
        st.codes = codes;
        st.count = list.length;
        log.info('packs in use: ' + (codes.join(', ') || 'none') + ' (' + list.length + ' cameras)');
    };
    refreshPacks(true);
    setInterval(() => { try { refreshPacks(false); } catch (e) { log.warn('packs: ' + e); } }, 30000);
    const updater = new Updater({
        packs, base: bg.spec.config && bg.spec.config.packsUrl, dataDir: bg.dataDir, log,
        wanted: () => packs.wanted(st.codes), enabled: () => settings.get('autoUpdate') !== false,
        onChange: () => { refreshPacks(true); if (st.onDb) st.onDb(); },
    }).start();
    log.info('cameras: ' + st.count + ' in ' + st.codes.join(', ') + '; position candidates: ' + CANDS.list.length + (CANDS.note ? ' (' + CANDS.note + ')' : ''));

    const ov = new Overlay(bg.spec.id, log, () => ({
        hud: settings.get('showHud'), cluster: settings.get('showCluster'), clusterPlace: settings.get('clusterPlace'),
        inMap: settings.get('inMap'), mapPlace: settings.get('mapPlace'),
        size: settings.get('size'), hudBright: settings.get('hudBright'), night: !!settings.get('nightDim') && st.night,
        socketPath: bg.spec.config && bg.spec.config.socketPath, tr: tr(), units: settings.get('units') || 'auto',
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

    // the chime (chime.js) and the audio manager probe behind the diagnostics page (sound.js)
    st.audio = sound.probe(signals, log);
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

    const tick = () => {
        try {
            const speed = st.speed !== null && mono() - st.speedT < 5000 ? st.speed : 0;
            const fix = pos.fix();
            st.fix = fix;
            // moved 2 km since the packs were last looked at (or crossed into another country): look again
            if (fix && (!st.packFix || geo.distance(fix.lat, fix.lon, st.packFix.lat, st.packFix.lon) > 2000)) { st.packFix = fix; refreshPacks(false); }
            let alert = null;
            if (st.test && Date.now() - st.test.t0 < 14000) alert = testAlert(st.test, speed, tr());
            else {
                st.test = null;
                if (settings.get('enabled') && fix && fix.t !== st.lastFixT) {
                    st.lastFixT = fix.t;
                    st.alert = eng.update(fix, speed);
                    st.heading = eng.track.heading;
                    if (st.alert && (!st.prev || st.prev.id !== st.alert.id)) { st.alerts++; log.info('camera ahead: ' + st.alert.id + ' ' + st.alert.label + ', ' + st.alert.dist + ' m'); }
                    st.prev = st.alert;
                } else if (!settings.get('enabled') || !fix) st.alert = null;
                alert = st.alert;
                // a country that does not allow the warnings while driving: nothing shown, unless the owner chose so
                if (alert && alert.cam && alert.cam.legal === 'banned' && settings.get('banned') !== 'on') {
                    st.banned = { pack: alert.cam.pack, t: Date.now() };
                    alert = null;
                }
                // "only when I'm over the limit": the warning stays off while the speed is within it (+ tolerance);
                // a camera with no known limit is always shown
                if (alert && settings.get('showWhen') === 'over' && !alert.over && alert.limit > 0) alert = null;
            }
            const warn = alert && alert.cam ? eng.warnFor(alert.cam, speed) : eng.warnDistance(speed);
            ov.show(alert, warn);
            st.shown = alert;
            // the chime: when a warning appears, and again when the speed goes over its limit
            const key = alert ? (alert.id === -1 ? 'test' + st.test.t0 : alert.id) : null;
            if (key !== st.chimed.key) { if (key !== null) st.ding('alert'); st.chimed = { key, over: !!(alert && alert.over) }; }
            else if (alert && alert.over && !st.chimed.over) { st.chimed.over = true; st.ding('over'); }
        } catch (e) { log.warn('tick: ' + (e && e.stack || e)); }
    };
    setInterval(tick, 250);
    process.on('exit', () => ov.stop());
    return { st, pos, eng, ov, packs, updater, refreshPacks, tr };
}

function fmtAge(s, tr) { return s === null ? '–' : s < 2 ? tr('now') : s < 120 ? tr('s_ago', { n: s }) : tr('min_ago', { n: Math.round(s / 60) }); }

function packName(m, tr) { return !m ? '' : m.group === 'eu' ? m.name : m.group === 'us' ? m.en : tr('group_ua'); }

/** The diagnostics page: every source and sink of the audio manager, likely chime carriers in yellow, the last chime. */
function audioPage(st, L, c, tr) {
    const au = st.audio || {};
    L(tr('diag'), 40, 50, 36);
    L(tr('diag_hint'), 520, 48, 22, c.dim);
    if (!au.done) L(au.tries ? tr('audio_try', { n: au.tries }) : tr('audio_wait'), 40, 110, 28, c.warn);
    else if (!au.sources.length) L(tr('audio_none', { e: String(au.error || '').slice(0, 90) }), 40, 110, 26, c.bad);
    const sinks = (au.sinks || []).map((s) => s.id + ' ' + s.name).join(' · ');
    L(tr('sinks') + ' (' + (au.sinks || []).length + ')', 40, 92, 20, c.dim);
    L(sinks.slice(0, 120), 220, 92, 20);
    const src = au.sources || [], ROWS = 16, COLW = 390;
    L(tr('sources') + ' (' + src.length + ')', 40, 124, 20, c.dim);
    src.slice(0, ROWS * 4).forEach((s, i) => {
        const x = 40 + Math.floor(i / ROWS) * COLW, y = 146 + (i % ROWS) * 20;
        L(s.id + ' ' + String(s.name).slice(0, 26) + (s.cls !== undefined ? ' ·' + s.cls : ''), x, y, 18, sound.CANDIDATE.test(s.name) ? c.warn : '#ffffff');
    });
    if (src.length > ROWS * 4) L(tr('more_in_log', { n: src.length - ROWS * 4 }), 40 + 3 * COLW, 146 + ROWS * 20, 18, c.dim);
    const yy = 146 + ROWS * 20 + 4, ch = st.chime && st.chime.last;
    L(tr('sound_test'), 40, yy, 20, c.dim);
    if (!ch) L(tr('sound_test_none'), 220, yy, 20);
    else {
        L(tr('route_' + ch.route) + ' · ' + ch.style + (ch.done ? '' : ' · ' + tr('chime_playing')) + ' · ' + new Date(ch.at).toTimeString().slice(0, 8), 220, yy, 20, ch.done ? (ch.ok ? c.ok : c.bad) : c.warn);
        L(ch.steps.join(' · ').slice(0, 150), 220, yy + 24, 18);
    }
    if (st.mpMissing) L(tr('unit_lacks', { x: st.mpMissing.slice(0, 60) }), 900, yy, 18, c.bad);
}

/** The "Camera databases" screen: the active packs, automatic, the update, the groups and the packs of one group. */
function dbScreen(ctx, core) {
    const { ui } = ctx, { packs, updater, st } = core;
    let group = 'ua';
    let rows = [];                  // the DB_LIST rows: { all: true } or { code }
    const legalTxt = (m, tr) => (m.legal === 'banned' ? ' · ' + tr('legal_banned') : m.legal === 'zones' ? ' · ' + tr('legal_zones') : '');
    const date = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '–');
    const render = () => {
        const tr = core.tr(), all = packs.list();
        const ust = updater.state;
        ui.cells('DB_INFO', 0, { Text1stCol: tr('db_active', { list: st.codes.map((c) => c.toUpperCase()).join(', ') || '–' }), Text2ndCol: tr('db_cams', { n: st.count }) });
        ui.text('DB_AUTO', tr('db_auto'));
        ui.checked('DB_AUTO', !!packs.choice.auto);
        ui.text('DB_UPDATE', ust.checking ? tr('db_checking') : tr('db_update'));
        ui.text('DB_STATUS', ust.error && !ust.ok ? tr('db_offline', { e: String(ust.error).slice(0, 40) })
            : ust.last ? tr('db_checked', { d: date(ust.last), n: date(updater.next()) }) + (ust.updated ? ' · ' + tr('db_result', { n: ust.updated }) : '')
                + (ust.error ? ' · ' + tr('db_offline', { e: String(ust.error).slice(0, 30) }) : '')
                : tr('db_never'));
        ui.rows('DB_GROUPS', GROUPS.length);
        GROUPS.forEach((g, i) => {
            const inG = all.filter((m) => m.group === g), on = inG.filter((m) => packs.chosen(m.code)).length;
            ui.text('DB_GROUPS', (g === group ? '▸ ' : '') + tr('group_' + g) + ' · ' + tr('db_none_sel', { k: on, n: inG.length }), i);
        });
        const inGroup = all.filter((m) => m.group === group);
        rows = (inGroup.length > 1 ? [{ all: true }] : []).concat(inGroup.map((m) => ({ code: m.code })));
        ui.rows('DB_LIST', rows.length);
        rows.forEach((r, i) => {
            if (r.all) {
                const allOn = inGroup.every((m) => packs.chosen(m.code));
                ui.text('DB_LIST', tr('db_all') + ' (' + inGroup.length + ')', i);
                ui.checked('DB_LIST', allOn, i);
                return;
            }
            const m = packs.meta(r.code);
            ui.text('DB_LIST', packName(m, tr) + ' · ' + (m.count || 0) + legalTxt(m, tr), i);
            ui.checked('DB_LIST', packs.chosen(r.code), i);
        });
    };
    st.onDb = () => { if (ui.isVisible('DB')) render(); };
    ui.onClick('DB_AUTO', () => { packs.setAuto(!packs.choice.auto); core.refreshPacks(true); render(); });
    ui.onClick('DB_UPDATE', () => { updater.check(true).then(render); render(); });
    ui.onClick('DB_GROUPS', (ev) => { group = GROUPS[ev && ev.row] || group; render(); });
    ui.onClick('DB_LIST', (ev) => {
        const r = rows[ev && ev.row];
        if (!r) return;
        let get = [];
        if (r.all) {
            const inGroup = packs.list().filter((m) => m.group === group);
            const on = !inGroup.every((m) => packs.chosen(m.code));
            inGroup.forEach((m) => packs.toggle(m.code, on));
            if (on) get = inGroup.filter((m) => m.src === 'remote').map((m) => m.code);
        } else if (packs.toggle(r.code) && packs.meta(r.code).src === 'remote') get = [r.code];
        core.refreshPacks(true);
        render();
        if (get.length) updater.check(true, get).then(render);
    });
    return render;
}

mgu.run({
    background,
    async start(ctx) {
        const { ui, settings } = ctx;
        const core = ctx.background || background(ctx);
        const st = core.st;
        const labels = () => {
            const tr = core.tr();
            lang.settings(settings.schema, tr.lang);
            const uk = settings.item('ukraine');
            if (uk) { settings.values.ukraine = uk.default; if (ui.comp('SET_UKRAINE')) ui.cells('SET_UKRAINE', 0, { Text1stRow: uk.label, Text2ndRow: uk.default }); }
            Object.keys(BUTTONS).forEach((b) => ui.text(b, tr(BUTTONS[b])));
            // the HMI's own settings screen: the drop-downs' header and rows (the kit writes the check boxes' labels)
            settings.schema.forEach((s) => {
                const comp = 'SET_' + s.key.toUpperCase();
                if (s.type === 'choice' && ui.comp(comp)) {
                    ui.cells(comp, 0, { HeaderText: s.label });
                    (s.options || []).forEach((o, i) => ui.cells(comp, i, { ItemText: o[1] }));
                } else if (s.type === 'number' && ui.comp(comp)) ui.cells(comp, 0, { HeaderText: s.label });
            });
        };
        labels();
        st.onLang = labels;
        const renderDb = dbScreen(ctx, core);
        ui.onClick('BTN_TEST', () => { st.page = null; st.test = { t0: Date.now() }; ctx.log.info('test warning'); });
        ui.onClick('BTN_SOUND', () => { st.page = 'audio'; st.ding('button'); });
        ui.onClick('BTN_AUDIO', () => { st.page = st.page === 'audio' ? null : 'audio'; });
        ui.onClick('BTN_DB', () => { renderDb(); return ui.open('DB'); });

        const render = async () => {
            const tr = core.tr();
            const t = ctx.theme(), cv = ctx.canvas(W, H).clear(t.bg);
            const L = (s, x, y, size, c) => cv.text(String(s), x, y, size, c || '#ffffff', { literal: true });
            const dim = '#8a93a0', ok = '#2fd27a', warn = '#ffb31a', bad = '#ff4040';
            if (st.page === 'audio') { audioPage(st, L, { dim, ok, warn, bad }, tr); await ui.image('MAIN_GFX', cv); return; }
            const unitsFor = (cam) => (settings.get('units') === 'kmh' || settings.get('units') === 'mph' ? settings.get('units') : cam && cam.units === 'mph' ? 'mph' : 'kmh');
            const dist = (d, u) => { const f = badge.fmtDist(d, u, tr); return f.v + ' ' + f.u; };
            L('SpeedCam', 40, 56, 44);
            const names = st.codes.map((c) => packName(core.packs.meta(c), tr)).join(', ');
            L(tr('cams_info', { n: st.count, packs: names.length > 70 ? st.codes.map((c) => c.toUpperCase()).join(', ') : names }).slice(0, 110), 300, 54, 24, dim);

            const fix = st.fix, ps = core.pos.status();
            let y = 112;
            L(tr('position'), 40, y, 22, dim);
            if (fix) {
                L(fix.lat.toFixed(5) + ', ' + fix.lon.toFixed(5), 250, y, 30, ok);
                L(tr('from_src', { src: fix.src }) + ', ' + (st.heading !== null ? tr('heading', { deg: Math.round(st.heading) }) : tr('heading_wait')), 650, y, 24, dim);
            } else if (!CANDS.list.length) {
                L(tr('no_gps'), 250, y, 30, bad);
                L(tr('see_docs'), 900, y, 22, dim);
            } else {
                L(tr('waiting_nav', { n: CANDS.list.length }), 250, y, 30, warn);
            }
            y += 46;
            const n = core.eng.nearest(fix);
            const nu = unitsFor(n && n.cam);
            L(tr('speed'), 40, y, 22, dim);
            L(st.speed === null ? '–' : badge.inUnits(st.speed, nu) + ' ' + tr(nu), 250, y, 30);
            L(tr('nearest'), 560, y, 22, dim);
            if (n) {
                const u = unitsFor(n.cam);
                L(dist(n.d, u) + ' · ' + (n.cam.limit ? badge.inUnits(n.cam.limit, u) : '?') + ' · ' + (n.cam.legal === 'zones' ? tr('zone_hint') : n.cam.label), 760, y, 26);
            } else L('–', 760, y, 26);
            y += 46;
            const a = st.test ? null : st.shown;
            L(tr('camera_row'), 40, y, 22, dim);
            const banned = st.banned && Date.now() - st.banned.t < 60000 ? packName(core.packs.meta(st.banned.pack), tr) : null;
            L(st.test ? tr('test_look')
                : a && a.zone ? tr('in_zone', { label: packName(core.packs.meta(a.cam.pack), tr) })
                    : a ? tr('in_dist', { d: dist(a.dist, unitsFor(a.cam)), l: a.limit ? badge.inUnits(a.limit, unitsFor(a.cam)) : '?', label: a.label })
                        : banned ? tr('banned_here', { country: banned })
                            : settings.get('enabled') ? tr('none_near', { n: st.alerts }) : tr('disabled'), 250, y, 28, st.test || a ? warn : banned ? dim : '#ffffff');
            y += 46;
            const ov = core.ov.status();
            L(tr('screens'), 40, y, 22, dim);
            L(ov.connected ? tr('cr_ok') : tr('cr_missing'), 250, y, 26, ov.connected ? ok : bad);
            L(ov.phoneMap ? tr('phone_map') + (settings.get('inMap') ? tr('banner_in_map') : '') : tr('no_phone_map'), 820, y, 22, ov.phoneMap ? ok : dim);
            y += 46;
            const ust = core.updater.state;
            L(tr('databases'), 40, y, 22, dim);
            L((st.codes.map((c) => c.toUpperCase()).join(', ') || '–') + ' · ' + (ust.checking ? tr('db_checking')
                : ust.last ? tr('db_checked', { d: new Date(ust.last).toISOString().slice(0, 10), n: new Date(core.updater.next()).toISOString().slice(0, 10) }) : tr('db_never')), 250, y, 24);
            y += 52;
            L(tr('gps_sources') + (CANDS.built ? ' (' + tr('found_on', { d: CANDS.built }) + ')' : ''), 40, y, 22, dim);
            ps.slice(0, 3).forEach((c, i) => {
                const yy = y + 34 + i * 30;
                const col = c.inUse ? ok : c.count ? '#ffffff' : c.error ? bad : dim;
                L((c.inUse ? '> ' : '  ') + c.name, 40, yy, 22, col);
                L(c.error ? tr('error', { e: c.error.slice(0, 50) }) : c.count ? tr('fixes', { n: c.count, scale: c.scale || '?', age: fmtAge(c.age, tr) })
                    : c.misses ? tr('no_coords', { n: c.misses }) : tr('nothing_yet'), 900, yy, 22, col);
            });
            const au = st.audio || {};
            const ch = st.chime && st.chime.last;
            const auLine = !ch ? null : (ch.done ? (ch.ok ? tr('chime_sent') : tr('chime_failed')) : tr('chime_playing')) + ': ' + ch.steps.slice(-1).join('').slice(0, 70) + ' · ' + tr('details_audio');
            const sy = y + 34 + 3 * 30 + 14;
            L(tr('sound'), 40, sy, 22, dim);
            L(auLine ? auLine : !au.done ? (au.tries ? tr('audio_try', { n: au.tries }) : tr('audio_wait')) : au.error && !au.sources.length ? tr('audio_none', { e: String(au.error).slice(0, 60) })
                : tr('audio_count', { s: au.sources.length, k: au.sinks.length }), 250, sy, 22, au.done && au.sources.length ? '#ffffff' : dim);
            await ui.image('MAIN_GFX', cv);
        };
        ctx.loop('MAIN', 2, render);
    },
});
