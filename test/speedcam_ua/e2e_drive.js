'use strict';
/**
 * End-to-end test on the PC: the Store's build step with a made-up interface catalog, the built app in the kit's
 * stubbed head unit, a fake cluster-render, and a drive past a real camera from the list.
 *
 *   node test/speedcam_ua/e2e_drive.js [outDir]      (exit code 1 on a failed check; pictures in outDir, default preview/)
 *
 * Checks: the build finds the position field (and not the destination / POI decoys), the app reads 1e-7 degree
 * integers, the warning comes up ahead of the camera on the HUD and the cluster, counts down, goes after the camera,
 * stays off when driving away from a camera, and the test button shows a warning.
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'preview', 'speedcam_ua'));
const TMP = fs.mkdtempSync('/tmp/speedcam-e2e-');
const POS_IFACE = 'de.bmw.infotainment.navigation.positioning.Positioning';
const fails = [];
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails.push(what); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const catalog = {
    interfaces: {
        [POS_IFACE]: { serviceId: 1, version: 1, fields: {
            currentPositionWGS84: { dataRef: 'PosInfo', getter: { id: 1 }, notifier: { id: 2 } },
            destinationPosition: { dataRef: 'GeoPos', getter: { id: 3 }, notifier: { id: 4 } },
        } },
        'de.bmw.infotainment.navigation.poi.PoiSearch': { serviceId: 2, version: 1, fields: { results: { dataRef: 'PoiList', getter: { id: 6 } } } },
        'de.bmw.infotainment.vehicle.CDS2': { serviceId: 3, version: 1, fields: { statusLateralAccelerationMassCenter: { dataRef: 'Acc', notifier: { id: 5 } } } },
        'de.bmw.infotainment.vehicle.Vehicle2': { serviceId: 4, version: 1, fields: { statusCarSpeed2: { dataRef: 'Spd', getter: { id: 7 }, notifier: { id: 8 } } } },
    },
    instanceIDs: {
        [POS_IFACE]: { Main_Instance: 1 }, 'de.bmw.infotainment.navigation.poi.PoiSearch': { Main_Instance: 1 },
        'de.bmw.infotainment.vehicle.CDS2': { 1: 1 }, 'de.bmw.infotainment.vehicle.Vehicle2': { 1: 1 },
    },
    datatypes: {
        PosInfo: { type: 'struct', members: [{ name: 'position', dataRef: 'GeoPos' }, { name: 'heading', dataRef: 'UInt16' }] },
        GeoPos: { type: 'struct', members: [{ name: 'latitude', dataRef: 'Int32' }, { name: 'longitude', dataRef: 'Int32' }] },
        Acc: { type: 'struct', members: [{ name: 'lateralAccelerationCentreOfGravity', dataRef: 'UInt16' }] },
        PoiList: { type: 'array', elementDataRef: 'Poi' },
        Poi: { type: 'struct', members: [{ name: 'name', dataRef: 'String' }, { name: 'geo', dataRef: 'GeoPos' }] },
        Spd: { type: 'struct', members: [{ name: 'speedVehicleCentreOfGravity', dataRef: 'UInt16' }] },
    },
};

async function main() {
    fs.mkdirSync(OUT, { recursive: true });
    cp.execSync('tar -C "' + ROOT + '" --exclude=.git --exclude=dist --exclude=preview --exclude="apps/*/kit" -cf - . | tar -C "' + TMP + '" -xf -');
    fs.writeFileSync(path.join(TMP, 'catalog.json'), JSON.stringify(catalog));
    const build = cp.execSync('python3 tools/store_build.py --preview-only speedcam_ua', {
        cwd: TMP, env: Object.assign({}, process.env, { MGU_SOMEIP_CATALOG: path.join(TMP, 'catalog.json') }) }).toString();
    console.log(build.trim().split('\n').map((l) => '  | ' + l).join('\n'));
    const cands = require(path.join(TMP, 'apps', 'speedcam_ua', 'position_candidates.js')).list;
    check(cands.length >= 1 && cands[0].name === 'currentPositionWGS84', 'store_build ranks currentPositionWGS84 first');
    check(!cands.some((c) => /destination|results/.test(c.name)), 'store_build leaves out the destination and POI decoys');
    const spec = JSON.parse(fs.readFileSync(path.join(TMP, 'apps', 'speedcam_ua', 'app.json'), 'utf8'));
    check(spec.signals[POS_IFACE] && spec.signals[POS_IFACE].currentPositionWGS84 === 'rs' && spec.signals[POS_IFACE]._optional, 'app.json gets the field, read + subscribe, optional');

    const stage = path.join(TMP, 'dist', 'speedcam_ua');
    const specPath = path.join(stage, 'source', 'javascript', 'kit', 'app-spec.json');
    const rt = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    const sockPath = path.join(TMP, 'render.sock');
    rt.config.socketPath = sockPath;
    fs.writeFileSync(specPath, JSON.stringify(rt));

    const srv = await require('../lib/fake_cluster_render').start(sockPath);
    const js = path.join(stage, 'source', 'javascript');
    const { Canvas } = require(path.join(js, 'kit', 'canvas'));
    const geo = require(path.join(js, 'geo'));
    const DB = require(path.join(js, 'cameras'));
    const { headUnit } = require(path.join(TMP, 'kit', 'tools', 'hu-stub'));
    let page = null;
    const quiet = { info: () => {}, warn: (m) => console.log('  warn: ' + m), error: (m, e) => console.log('  error: ' + m + ' ' + (e && e.stack || e || '')), debug: () => {} };
    const logLines = [];
    const log = { info: (m) => logLines.push(m), warn: quiet.warn, error: quiet.error, debug: () => {} };
    const hu = headUnit(stage, { dataDir: path.join(TMP, 'data'), fresh: true, image: (name, cv) => { page = cv; }, log });
    fs.mkdirSync(path.join(TMP, 'data'), { recursive: true });
    const subs = {};
    hu.ctx.signals = {
        watch: async (iface, inst, handlers) => { (subs[iface] = subs[iface] || []).push(handlers); return { iface, available: true, error: null, shutdown: () => Promise.resolve() }; },
    };
    hu.ctx.log = log;
    const feed = (iface, field, v) => (subs[iface] || []).forEach((h) => { if (h[field]) h[field](v); });
    hu.start();
    await sleep(600);

    // the compact cluster card is 440 wide, the banner in the phone map 640
    const layerOf = (target, w) => Array.from(srv.layers.values()).find((l) => l.target === target && (!w || l.iw === w) && (w || target !== 'panel' || l.iw === 440));
    const snap = (name, which) => {
        (which || [['hud', '#000000'], ['panel', '#2b2f36']]).forEach((t) => {
            const l = t[2] || layerOf(t[0]);
            if (!l) return;
            const cv = new Canvas(l.iw + 40, l.ih + 40).clear(t[1]);
            // the layer over the background, by its alpha
            for (let y = 0; y < l.ih; y++) for (let x = 0; x < l.iw; x++) {
                const i = (y * l.iw + x) * 4, a = l.px[i + 3] / 255, o = ((y + 20) * cv.w + x + 20) * 4;
                for (let c = 0; c < 3; c++) cv.d[o + c] = Math.round(l.px[i + c] * a + cv.d[o + c] * (1 - a));
            }
            fs.writeFileSync(path.join(OUT, name + '_' + (t[3] || (t[0] === 'panel' ? 'cluster' : 'hud')) + '.png'), cv.png());
        });
    };
    const vis = (t, w) => { const l = layerOf(t, w); return !!(l && l.visible); };
    check(srv.log.some((m) => m.op === 'hello'), 'the app connected to cluster-render');
    check(!Array.from(srv.layers.values()).some((l) => l.visible), 'nothing on the glass while no camera is near');

    // a highway camera: drive 2.5 km towards it at 90 km/h, then 600 m past it (one fix = 25 m, every 250 ms)
    const row = DB.rows.find((r) => r[4] === 'М-06');
    const cam = { id: row[0], lat: row[1], lon: row[2], limit: row[3] };
    const brg = 75;
    const start = geo.offset(cam.lat, cam.lon, (brg + 180) % 360, 2500);
    const put = (p, kmh) => {
        feed(POS_IFACE, 'currentPositionWGS84', { position: { latitude: Math.round(p.lat * 1e7), longitude: Math.round(p.lon * 1e7) }, heading: 0 });
        feed('de.bmw.infotainment.vehicle.Vehicle2', 'statusCarSpeed2', { speedVehicleCentreOfGravity: Math.round(kmh / 0.015625) });
    };
    let firstOn = null, onCount = 0, offAfter = null, snaps = 0, distances = [];
    for (let s = 0; s <= 3100; s += 25) {
        const p = geo.offset(start.lat, start.lon, brg, s);
        const toCam = 2500 - s;
        put(p, toCam < 400 && toCam > -100 ? 78 : 90);
        await sleep(260);
        const vis2 = vis('hud') && vis('panel');
        if (vis2) {
            onCount++;
            if (firstOn === null) firstOn = toCam;
            distances.push(toCam);
            if ((snaps === 0 && toCam <= 450) || (snaps === 1 && toCam <= 160)) { snap('drive_' + (snaps ? 'close' : 'approach')); snaps++; }
        } else if (firstOn !== null && offAfter === null) offAfter = toCam;
        if (s === 400) { page = null; await hu.loopFn(); if (page) fs.writeFileSync(path.join(OUT, 'page_driving.png'), page.png()); }
    }
    console.log('  warning on from ' + firstOn + ' m before the camera, off ' + (offAfter === null ? 'never' : -offAfter + ' m after it') + ', on for ' + onCount + ' fixes');
    check(firstOn !== null && firstOn <= 520 && firstOn >= 400, 'the warning starts about 20 s ahead at 90 km/h (500 m)');
    check(offAfter !== null && offAfter <= 0 && offAfter > -150, 'the warning goes once the camera is passed');
    check(snaps === 2, 'pictures taken on the way in');
    const lines = logLines.filter((l) => /camera ahead/.test(l));
    check(lines.length === 1 && lines[0].indexOf('#' + cam.id) >= 0, 'one "camera ahead" for camera #' + cam.id + ' in the log');

    // driving away from a camera with no other camera within 3 km: no warning
    await sleep(500);
    const lonely = DB.rows.map((r) => ({ lat: r[1], lon: r[2], id: r[0] })).find((a) => !DB.rows.some((b) => b[0] !== a.id && geo.distance(a.lat, a.lon, b[1], b[2]) < 3000));
    const away0 = geo.offset(lonely.lat, lonely.lon, brg, 40);
    let awayOn = false;
    for (let s = 0; s <= 1000; s += 25) {
        put(geo.offset(away0.lat, away0.lon, brg, s), 90);
        await sleep(120);
        if (vis('hud')) awayOn = true;
    }
    check(!awayOn, 'no warning while driving away from the camera');

    // standing still near a camera, then the test button
    put(away0, 0);
    await sleep(400);
    hu.handlers.BTN_TEST();
    await sleep(1200);
    check(vis('hud') && vis('panel'), 'the test button shows a warning on both screens');
    check(layerOf('hud').class === 'alert' && layerOf('panel').class === 'alert', 'layers are in the alert class');
    snap('test_button');
    page = null; await hu.loopFn(); if (page) fs.writeFileSync(path.join(OUT, 'page_test.png'), page.png());
    check(!!page, 'the page draws');
    await sleep(13500);
    check(!vis('hud') && !vis('panel'), 'the test warning goes after 14 s');

    // Maps on cluster shows Waze / Google on the cluster's map target: the warning becomes a banner inside it
    srv.emit({ ev: 'target', target: 'map', state: 'shown', holder: 'none', reason: '', retry_in_ms: -1, rendering: 'verified' });
    await sleep(300);
    hu.handlers.BTN_TEST();
    await sleep(1500);
    const mapL = layerOf('map', 640);
    check(!!mapL && mapL.visible && mapL.class === 'alert', 'with the phone map on the cluster: a banner on the map target');
    check(!vis('panel') && vis('hud'), '... instead of the cluster card, the HUD as before');
    check(mapL && mapL.x + mapL.w <= 1088 && mapL.y >= 0 && mapL.y + mapL.h <= 480, '... inside the 1088x480 map');
    page = null; await hu.loopFn(); if (page) fs.writeFileSync(path.join(OUT, 'page_map.png'), page.png());
    snap('in_map', [['map', '#4a6b52', mapL, 'banner']]);
    await sleep(13000);
    check(!mapL.visible, 'the banner goes with the warning');

    // a cluster theme hosts the map in its own scene on the panel: the banner goes to the top of that rect
    srv.emit({ ev: 'target', target: 'map', state: 'idle', holder: 'none', reason: '', retry_in_ms: -1, rendering: 'none' });
    srv.emit({ ev: 'host', target: 'map', into: 'panel', shown: 1, x: 420, y: 160, w: 1080, h: 476 });
    await sleep(300);
    hu.handlers.BTN_TEST();
    await sleep(1500);
    const hostL = layerOf('panel', 640);
    check(!!hostL && hostL.visible && hostL.x >= 420 && hostL.x + hostL.w <= 1500 && hostL.y >= 160 && hostL.y < 200, 'map hosted by a theme: the banner on the panel, at the top of the hosted map');
    check(!mapL.visible && !vis('panel'), '... and nothing on the map target or the cluster card');

    // "only when I'm over the limit": the next camera warns only while the speed is above its limit
    srv.emit({ ev: 'host', target: 'map', into: '', shown: 0 });
    await sleep(14000);
    hu.ctx.settings.set('showWhen', 'over');
    const cam2 = DB.rows.find((r) => r[4] && r[0] !== cam.id && !DB.rows.some((b) => b[0] !== r[0] && geo.distance(r[1], r[2], b[1], b[2]) < 3000));
    const c2 = { lat: cam2[1], lon: cam2[2], limit: cam2[3] };
    const s2 = geo.offset(c2.lat, c2.lon, (brg + 180) % 360, 1500);
    let quietOn = false, overOn = false;
    for (let s = 0; s <= 1400; s += 25) {
        const kmh = s < 900 ? c2.limit - 10 : c2.limit + 15;
        put(geo.offset(s2.lat, s2.lon, brg, s), kmh);
        await sleep(150);
        if (s < 900 && vis('hud')) quietOn = true;
        if (s > 950 && vis('hud')) overOn = true;
    }
    check(!quietOn, '"only when over": no warning within the limit (' + (c2.limit - 10) + ' km/h at a ' + c2.limit + ' camera)');
    check(overOn, '"only when over": the warning comes once over the limit (' + (c2.limit + 15) + ' km/h)');
    hu.ctx.settings.set('showWhen', 'always');

    // size 70 %: the layers shrink, the image keeps its pixels; the HUD dims to its brightness setting
    hu.ctx.settings.set('size', 70);
    hu.ctx.settings.set('hudBright', 50);
    hu.ctx.settings.set('nightDim', false);
    await sleep(600);
    hu.handlers.BTN_TEST();
    await sleep(1500);
    const hl = layerOf('hud'), cl = layerOf('panel');
    check(hl.w === 210 && hl.h === 105 && hl.iw === 300, 'size 70 %: the HUD layer 210x105 from a 300x150 image');
    check(cl.w === 308 && cl.y + cl.h === 468 + 168, 'size 70 %: the cluster card keeps its bottom edge');
    let maxR = 0;
    for (let i = 0; i < hl.px.length; i += 4) maxR = Math.max(maxR, hl.px[i]);
    check(maxR > 100 && maxR <= 130, 'HUD brightness 50 %: the brightest red at half (' + maxR + ')');
    snap('small_dim', [['hud', '#000000'], ['panel', '#2b2f36']]);

    srv.close();
    console.log(fails.length ? '\n' + fails.length + ' check(s) failed' : '\nall checks passed; pictures in ' + OUT);
    process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error(e && e.stack || e); process.exit(2); });
