'use strict';
/**
 * DeX Drive unit tests (plain Node, no head unit): the picture's geometry and touch mapping, the knob, the draw
 * ops as mgu-render reads them, the page's texts in both languages, what Open asks the service for.
 *   node test/dex_drive/unit.js
 */
const assert = require('assert');
const path = require('path');
const app = path.join(__dirname, '..', '..', 'apps', 'dex_drive');
const ov = require(path.join(app, 'overlay'));
const { Ops } = require(path.join(app, 'render'));
const lang = require(path.join(app, 'lang'));
const { statusText, startCmd, STREAM_KEYS } = require(path.join(app, 'status'));
const spec = require(path.join(app, 'app.json'));
const { Pad, fingers } = require(path.join(app, 'pad'));

let n = 0;
function test(name, fn) { fn(); n++; console.log('ok  ' + name); }

test('virtual display fills the picture area in multiples of 8', () => {
    const d = ov.displaySize();
    assert.deepStrictEqual(d, { w: 1832, h: 720 });
    assert.strictEqual(ov.PICTURE.x, 84);
    assert.strictEqual(ov.PICTURE.x + ov.PICTURE.w, 1920);
});

test('touches map to the fitted video', () => {
    // 1832 x 720 in 1836 x 720: 2 px bars left and right
    let p = ov.toVideo(84 + 2, 0, 1832, 720);
    assert.ok(Math.abs(p.nx) < 1e-9 && p.ny === 0 && p.inside);
    p = ov.toVideo(84 + 2 + 1832, 720, 1832, 720);
    assert.ok(Math.abs(p.nx - 1) < 1e-9 && p.ny === 1 && p.inside);
    p = ov.toVideo(84 + 918, 360, 1832, 720);
    assert.ok(Math.abs(p.nx - 0.5) < 1e-3 && Math.abs(p.ny - 0.5) < 1e-3);
    // a 16:9 video pillarboxed in the 1836 x 720 area: left of it is outside, clamped to the edge
    p = ov.toVideo(100, 360, 1920, 1080);
    assert.strictEqual(p.inside, false);
    assert.strictEqual(p.nx, 0);
    const f = ov.fitted(1920, 1080, ov.PICTURE);
    assert.ok(Math.abs(f.h - 720) < 1e-9 && Math.abs(f.w - 1280) < 1e-9 && Math.abs(f.x - (84 + 278)) < 1e-9);
});

test('knob steps wrap at 16 bits; a counter reset is no turn', () => {
    assert.strictEqual(ov.knobDelta(10, 12), 2);
    assert.strictEqual(ov.knobDelta(12, 10), -2);
    assert.strictEqual(ov.knobDelta(0xffff, 1), 2);
    assert.strictEqual(ov.knobDelta(1, 0xffff), -2);
    assert.strictEqual(ov.knobDelta(500, 0), 0);
});

// a pad sample as the car sends it
const S = (x1, y1, x2, y2, z1) => ({ statusSystemModeFrontSide: 3, touchCoordinatesX1FrontSide: x1, touchCoordinatesY1FrontSide: y1,
    touchCcoordinatesX2FrontSide: x2 || 0, touchCoordinatesY2FrontSide: y2 || 0, touchCoordinatesZ1FrontSide: z1 || 0 });
function padLog() {
    const ev = [];
    return { ev, pad: new Pad({ move: (dx, dy) => ev.push(['move', dx, dy]), click: (b) => ev.push(['click', b]), scroll: (n) => ev.push(['scroll', n]) }) };
}

test('touchpad: fingers, no finger, not touch mode', () => {
    assert.strictEqual(fingers(S(100, 200)).length, 1);
    assert.strictEqual(fingers(S(100, 200, 150, 210)).length, 2);
    assert.strictEqual(fingers(S(100, 200, 0, 0, 2)).length, 0);
    assert.strictEqual(fingers(Object.assign(S(100, 200), { statusSystemModeFrontSide: 1 })).length, 0);
    assert.strictEqual(fingers(null).length, 0);
});

test('touchpad: a short still touch clicks, two fingers right-click', () => {
    let { ev, pad } = padLog();
    pad.feed(S(200, 200), 1000); pad.feed(S(200, 200), 1010); pad.feed(S(202, 201), 1050); pad.feed(S(0, 0, 0, 0, 2), 1100);
    assert.deepStrictEqual(ev, [['click', 'left']]);
    ({ ev, pad } = padLog());
    pad.feed(S(200, 200, 260, 200), 1000); pad.feed(S(201, 200, 261, 200), 1040); pad.feed(null, 1100);
    assert.deepStrictEqual(ev, [['click', 'right']]);
    ({ ev, pad } = padLog());
    pad.feed(S(200, 200), 1000); pad.feed(null, 1600);             // held too long: no click
    assert.deepStrictEqual(ev, []);
});

test('touchpad: one finger moves the pointer (pad Y up = screen up), faster when quick', () => {
    const { ev, pad } = padLog();
    let t = 1000;
    pad.feed(S(100, 100), t);
    for (let i = 1; i <= 20; i++) pad.feed(S(100 + i * 2, 100 + i * 2), t += 20);     // slow, up-right
    const moves = ev.filter((e) => e[0] === 'move');
    const sx = moves.reduce((a, e) => a + e[1], 0), sy = moves.reduce((a, e) => a + e[2], 0);
    assert.ok(sx > 0 && sy < 0, 'right and up: ' + sx + ',' + sy);
    const slow = sx;
    const q = padLog();
    t = 1000;
    q.pad.feed(S(100, 100), t);
    for (let i = 1; i <= 4; i++) q.pad.feed(S(100 + i * 10, 100), t += 10);            // the same 40 units, quick
    const fast = q.ev.filter((e) => e[0] === 'move').reduce((a, e) => a + e[1], 0);
    assert.ok(fast > slow, 'acceleration: ' + fast + ' > ' + slow);
    assert.ok(!q.ev.some((e) => e[0] === 'click'));
});

test('touchpad: two fingers up scroll the content up (negative notches), no click after', () => {
    const { ev, pad } = padLog();
    let t = 1000;
    pad.feed(S(200, 100, 260, 100), t);
    for (let i = 1; i <= 10; i++) pad.feed(S(200, 100 + i * 10, 260, 100 + i * 10), t += 20);
    pad.feed(null, t + 20);
    const n = ev.filter((e) => e[0] === 'scroll').reduce((a, e) => a + e[1], 0);
    assert.strictEqual(n, -4);
    assert.ok(!ev.some((e) => e[0] === 'click' || e[0] === 'move'));
});

test('controller: press clicks where the pointer is, tilt = arrows, knob scrolls, only while shown', () => {
    const ev = [];
    const o = Object.create(ov.Overlay.prototype);
    Object.assign(o, { knobOn: true, shown: true, ccuLast: null, pressHeld: false, ptr: { nx: 0.25, ny: 0.75 }, vw: 1832, vh: 720,
        h: { scroll: (x, y, d) => ev.push(['scroll', d]), mouse: (a, b, x, y) => ev.push(['mouse', a, b, x, y]), key: (k) => ev.push(['key', k]) } });
    const c = (knob, press, tilt) => o._ccu({ knob, press, tilt });
    c(100, 0, 0);                    // the first event only sets the base
    c(102, 0, 0);                    // two steps clockwise
    c(102, 1, 0); c(102, 1, 0);      // press (held: one down)
    o.padMove(183.2, 0);             // drag right by a tenth of the picture (1832 px wide)
    c(102, 0, 0);                    // release
    c(102, 0, 1); c(102, 0, 1); c(102, 0, 0); c(102, 0, 10);   // tilt N (once), W
    assert.deepStrictEqual(ev.map((e) => e.map((v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v))),
        [['scroll', -2], ['mouse', 'down', 'left', 0.25, 0.75], ['mouse', 'move', 'left', 0.35, 0.75],
        ['mouse', 'up', 'left', 0.35, 0.75], ['key', 19], ['key', 21]], JSON.stringify(ev));
    ev.length = 0;
    o.padMove(10, 0);
    assert.deepStrictEqual(ev[0].slice(0, 2), ['mouse', 'hover']);
    o.shown = false;
    ev.length = 0;
    c(110, 1, 4); o.padClick('left'); o.padScroll(3);
    assert.deepStrictEqual(ev, []);
    assert.strictEqual(ov.TILT_KEY[4], 22);
    assert.strictEqual(ov.TILT_KEY[7], 20);
});

test('draw ops are words as PROTOCOL.md lists them', () => {
    const b = new Ops().clear(0x11223344).video(1, 84, 0, 1836, 720, 0).buffer();
    assert.strictEqual(b.length, (2 + 7) * 4);
    assert.strictEqual(b.readUInt32LE(0), 1);             // CLEAR
    assert.strictEqual(b.readUInt32LE(4), 0x11223344);
    assert.strictEqual(b.readUInt32LE(8), 19);            // VIDEO x y w h r id
    assert.strictEqual(b.readFloatLE(12), 84);
    assert.strictEqual(b.readFloatLE(20), 1836);
    assert.strictEqual(b.readUInt32LE(32), 1);
    const f = ov.frameOps().buffer();
    assert.ok(f.length > 0 && f.length % 4 === 0);
});

test('every text has both languages', () => {
    Object.keys(lang.T).forEach((k) => {
        assert.strictEqual(lang.T[k].length, lang.LANGS.length, k);
        lang.T[k].forEach((s) => assert.ok(typeof s === 'string' && s.length > 0, k));
    });
    assert.strictEqual(lang.t('en', 'fps', { n: 30 }), '30 fps');
    assert.strictEqual(lang.t('uk', 'fps', { n: 30 }), '30 к/с');
});

test('the page says what goes on', () => {
    const tr = (k, a) => lang.t('uk', k, a);
    assert.ok(/dex-drive-d/.test(statusText({ state: 'nosvc' }, { tr })));
    assert.ok(/Дозволити/.test(statusText({ state: 'auth' }, { tr })));
    assert.ok(/Wi‑Fi/.test(statusText({ state: 'searching' }, { tr, wifi: true })));
    const s = statusText({ state: 'streaming', device: 'SM-S938B', w: 1832, h: 720, via: 'usb' }, { tr, fps: 29.6, moving: true });
    assert.ok(s.indexOf('SM-S938B') >= 0 && s.indexOf('1832×720') >= 0 && s.indexOf('30 к/с') >= 0 && s.indexOf('стоянці') >= 0, s);
    assert.ok(/Помилка: boom/.test(statusText({ state: 'error', msg: 'boom' }, { tr })));
    assert.ok(/Остання помилка 17:40:01 decoder: no GPU/.test(statusText({ state: 'searching', last: '17:40:01 decoder: no GPU' }, { tr })));
    assert.ok(!/Остання/.test(statusText({ state: 'streaming', w: 1, h: 1, last: 'x' }, { tr })));
    assert.ok(/дотиком до меню/.test(statusText({ state: 'streaming', w: 1, h: 1 }, { tr, hidden: 'hmi' })));
    assert.ok(/mgu-render: video 1: cannot open/.test(statusText({ state: 'streaming', w: 1, h: 1 }, { tr, renderError: 'video 1: cannot open x' })));
    assert.ok(/no video|не показує/.test(statusText({ state: 'streaming', w: 1, h: 1 }, { tr, problem: 'no_video' })));
});

test('Open asks for the display the settings describe', () => {
    const vals = { dpi: 180, fps: '60', bitrate: '16', conn: 'usb' };
    const c = startCmd({ get: (k) => vals[k] });
    assert.deepStrictEqual(c, { cmd: 'start', w: 1832, h: 720, dpi: 180, fps: 60, bitrate: 16000000, tcp: '' });
    vals.conn = 'usbwifi';
    assert.strictEqual(startCmd({ get: (k) => vals[k] }).tcp, 'auto');
    STREAM_KEYS.forEach((k) => assert.ok(spec.settings.some((s) => s.key === k), k));
});

test('app.json: version named in the Store texts, ids, requirements', () => {
    assert.ok(spec.description.indexOf(spec.version) >= 0);
    assert.ok(spec.texts.uk.description.indexOf(spec.version) >= 0);
    assert.ok(spec.description.length <= 1000 && spec.texts.uk.description.length <= 1000);
    const ids = spec.screens[0].items.map((i) => i[1]);
    ['BTN_OPEN', 'STATUS', 'BTN_STOP', 'BTN_PHONE', 'BTN_FORGET'].forEach((id) => assert.ok(ids.indexOf(id) >= 0, id));
    assert.ok(spec.signals['de.bmw.infotainment.ControllerElements']._optional && spec.signals['de.bmw.infotainment.controlelements.FrontCCU']._optional,
        'the controller signals are optional: the app installs without them');
    assert.ok(spec.requires['dex-drive-d'] && spec.requires['mgu-render']);
    const comp = require(path.join(__dirname, '..', '..', 'native', 'dex_drive', 'prebuilt', 'component.json'));
    assert.strictEqual(comp.version, spec.requires['dex-drive-d'], 'the app requires the service version in the repo');
});

console.log(n + ' tests passed');
