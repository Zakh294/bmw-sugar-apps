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

test('knob steps wrap at 16 bits', () => {
    assert.strictEqual(ov.knobDelta(10, 12), 2);
    assert.strictEqual(ov.knobDelta(12, 10), -2);
    assert.strictEqual(ov.knobDelta(0xffff, 1), 2);
    assert.strictEqual(ov.knobDelta(1, 0xffff), -2);
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
    assert.ok(spec.requires['dex-drive-d'] && spec.requires['mgu-render']);
    const comp = require(path.join(__dirname, '..', '..', 'native', 'dex_drive', 'prebuilt', 'component.json'));
    assert.strictEqual(comp.version, spec.requires['dex-drive-d'], 'the app requires the service version in the repo');
});

console.log(n + ' tests passed');
