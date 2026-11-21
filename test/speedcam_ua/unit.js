'use strict';
/** Unit checks for the parts that need no head unit: node test/speedcam_ua/unit.js */
const assert = require('assert');
const path = require('path');
const A = path.join(__dirname, '..', '..', 'apps', 'speedcam_ua');
const { findPair, scaleOf, isLatKey, isLonKey } = require(path.join(A, 'position'));
const geo = require(path.join(A, 'geo'));
let n = 0;
const ok = (c, m) => { assert(c, m); n++; };

// keys
ok(isLatKey('latitude') && isLatKey('wgs84Latitude') && isLatKey('lat') && isLatKey('positionLatitudeWGS84'), 'latitude keys');
ok(!isLatKey('lateralAccelerationCentreOfGravity') && !isLatKey('plateNumber') && !isLatKey('translation'), 'not latitude');
ok(isLonKey('longitude') && isLonKey('lon') && isLonKey('lng') && !isLonKey('longitudinalAcceleration'), 'longitude keys');

// pairs inside replies
ok(findPair({ a: { latitude: 1, longitude: 2 } }).path === 'a', 'nested pair');
ok(findPair({ destination: { lat: 1, lon: 2 }, currentPosition: { lat: 3, lon: 4 } }).lat === 3, 'current wins over destination');
ok(findPair({ pos: { latitude: { value: 5 }, longitude: { value: 6 } } }).lon === 6, 'wrapped numbers');
ok(findPair({ lateral: 1, longitudinal: 2 }) === null, 'no false pair');

// units: Lviv 49.8397, 24.0297
const L = [49.8397, 24.0297];
[[1, 'deg'], [1e7, '1e-7 deg'], [1e6, '1e-6 deg'], [4294967296 / 360, '2^32/turn'], [Math.PI / 180, 'rad'], [3600000, 'mas']].forEach((s) => {
    const q = (v) => (s[0] > 100 ? Math.round(v) : v);      // integer units arrive as integers
    const r = scaleOf(q(L[0] * s[0]), q(L[1] * s[0]));
    ok(r && r.ua && Math.abs(L[0] - q(L[0] * s[0]) * r.k) < 1e-4, 'scale ' + s[1] + ' -> ' + (r && r.name));
});
ok(scaleOf(0, 0) === null, '0,0 is no fix');

// geometry
ok(Math.abs(geo.distance(50.45, 30.52, 49.84, 24.03) - 467000) < 3000, 'Kyiv-Lviv ~467 km');
ok(Math.abs(geo.bearing(50, 30, 51, 30)) < 0.01, 'due north');
ok(geo.angleDiff(350, 10) === 20 && geo.angleDiff(10, 350) === -20, 'angle wrap');
const p = geo.offset(50, 30, 90, 1000);
ok(Math.abs(geo.distance(50, 30, p.lat, p.lon) - 1000) < 0.5, 'offset');

// the sun (Lviv): high at noon in June, dark at 18:48 local in November, light at noon in November
const sun = require(path.join(A, 'sun'));
ok(Math.abs(sun.elevation(49.84, 24.03, Date.UTC(2026, 5, 21, 10, 13)) - 63.6) < 1, 'sun at noon, June');
ok(sun.isNight(49.84, 24.03, Date.UTC(2026, 10, 20, 16, 48)) && !sun.isNight(49.84, 24.03, Date.UTC(2026, 10, 21, 10, 0)), 'night in the evening, day at noon');

// the camera list
const fs = require('fs'), os = require('os'), crypto = require('crypto');
const { Packs } = require(path.join(A, 'packs'));
const P0 = new Packs({ dir: path.join(A, 'packs') });
const UA = P0.cameras(['ua']);
ok(UA.length === P0.meta('ua').count && UA.length > 400, 'ua pack: ' + UA.length + ' cameras');
ok(UA.every((c) => c.lat > 44 && c.lat < 53 && c.lon > 22 && c.lon < 41 && c.limit >= 30 && c.limit <= 130 && c.legal === 'ok' && /^ua:u\d+$/.test(c.id)), 'every Ukrainian camera in Ukraine, with a sane limit and an id');
ok(P0.at(49.84, 24.03).indexOf('ua') >= 0 && P0.at(38.9, -77.0).indexOf('ua') < 0, 'Lviv is in the ua pack\'s area, Washington is not');
// the audio probe: the provider says "Service unavailable" twice, then answers
const sound = require(path.join(A, 'sound'));
let calls = 0;
const fakeSignals = {
    proxy: () => Promise.resolve({}),
    onAvailable: (p, fn) => { setTimeout(() => fn(true), 10); return Promise.resolve(); },
    call: (p, m) => (++calls <= 4 ? Promise.reject(new Error('Service unavailable for call ' + m + '()'))
        : Promise.resolve(m === 'getListMainSources' ? { listMainSources: [{ sourceID: 1046, name: 'MediaPlayer', sourceClassID: 1 }] }
            : { listMainSinks: [{ sinkID: 1024, name: 'Main', sinkClassID: 1 }] })),
};
const quietLog = { info: () => {}, warn: () => {} };
// ALSA facts from a fake root
// (fs, os: above)
const R = fs.mkdtempSync(path.join(os.tmpdir(), 'alsa-'));
['/proc/asound', '/etc', '/usr/bin'].forEach((d) => d.split('/').reduce((a, b) => { a += '/' + b; try { fs.mkdirSync(R + a); } catch (e) { /* exists */ } return a; }, ''));
fs.writeFileSync(R + '/proc/asound/cards', ' 0 [dirana3       ]: Dirana - Dirana3\n                      Dirana3\n 1 [dummy ]: x - y\n');
fs.writeFileSync(R + '/proc/asound/pcm', '00-00: dirana3 Main : : playback 1\n00-01: dirana3 Navi : : playback 1\n');
fs.writeFileSync(R + '/etc/asound.conf', 'pcm.!default { type plug }\npcm.entNavi {\n type dmix }\n# pcm.off\n');
fs.writeFileSync(R + '/usr/bin/aplay', '');
const al = sound.alsaInfo(R);
ok(al.cards.join() === '0 dirana3,1 dummy' && al.pcm.length === 2 && al.confPcm.join() === 'default,entNavi' && al.players.join() === 'aplay',
    'alsaInfo reads cards, pcm devices, asound.conf names and players');
ok(sound.CANDIDATE.test('NaviAnnouncement') && sound.CANDIDATE.test('Gong_1') && !sound.CANDIDATE.test('TelRing_Inband_1') && !sound.CANDIDATE.test('FmDABCombined'),
    'chime candidates: navigation and gongs yes, phone ring and radio no');
const pr = sound.probe(fakeSignals, quietLog, { delayMs: 0, retryMs: 20, tries: 5 });
// packs: a made-up built-in set and a data folder; the choice, automatic, a downloaded pack wins when newer
const PD = fs.mkdtempSync(path.join(os.tmpdir(), 'packs-'));
const packFile = (code, legal, rows, updated) => [Object.assign({ code, iso: code.toUpperCase(), name: code, en: code, uk: code, group: 'eu', units: 'kmh', legal, updated, count: rows.length,
    bbox: [rows[0][1], rows[0][2], rows[0][1], rows[0][2]] })].concat(rows);
const bundle = { de: packFile('de', 'banned', [['o1', 52.5, 13.4, 50, 'Berlin', null]], '2026-11-01'), pl: packFile('pl', 'ok', [['o2', 52.2, 21.0, null, 'Warszawa', null]], '2026-11-01') };
const fakeBundled = { json: (n) => (n === 'index.json' ? { checked: '2026-11-01', packs: { de: Object.assign({ sha256: 'x' }, bundle.de[0]), pl: Object.assign({ sha256: 'y' }, bundle.pl[0]) } } : bundle[n.replace('.json', '')]) };
const P1 = new Packs({ bundled: fakeBundled, dataDir: PD });
ok(P1.active(null).join() === '' && P1.active({ lat: 52.5, lon: 13.4 }).join() === 'de', 'automatic: the pack where the car is (and "ua" chosen but not here: left out)');
P1.toggle('pl');
ok(P1.active(null).join() === 'pl' && JSON.parse(fs.readFileSync(path.join(PD, 'packs.json'), 'utf8')).chosen.indexOf('pl') >= 0, 'a chosen pack is in use and kept');
P1.setAuto(false);
ok(P1.active({ lat: 52.5, lon: 13.4 }).join() === 'pl', 'automatic off: only the chosen ones');
const de = P1.cameras(['de'])[0];
ok(de.id === 'de:o1' && de.legal === 'banned' && de.limit === 50 && P1.cameras(['pl'])[0].limit === null, 'cameras carry the pack, its legal mode, a missing limit as null');
const newDe = Buffer.from(JSON.stringify(packFile('de', 'banned', [['o1', 52.5, 13.4, 50, 'Berlin', null], ['o5', 52.6, 13.5, 30, 'Pankow', null]], '2026-12-02')));
const shaDe = crypto.createHash('sha256').update(newDe).digest('hex');
let threw = false;
try { P1.store('de', newDe, Object.assign({}, bundle.de[0], { sha256: 'bad' })); } catch (e) { threw = /checksum/.test(e.message); }
ok(threw && !fs.existsSync(path.join(PD, 'packs', 'de.json')), 'a download with the wrong checksum is refused and not written');

// the updater, with a made-up GitHub
const { Updater } = require(path.join(A, 'updater'));
const remoteIdx = { checked: '2026-12-02', packs: { de: Object.assign({}, bundle.de[0], { updated: '2026-12-02', sha256: shaDe }), pl: Object.assign({ sha256: 'y' }, bundle.pl[0]),
    'us-ny': { iso: 'US-NY', name: 'New York', en: 'New York', group: 'us', units: 'mph', legal: 'ok', count: 9, bbox: [40, -74, 41, -73], updated: '2026-12-02', sha256: 'z' } } };
const fetched = [];
const fakeGet = (url) => { fetched.push(url.replace(/^.*\//, '')); return /index\.json$/.test(url) ? Promise.resolve(Buffer.from(JSON.stringify(remoteIdx))) : /de\.json$/.test(url) ? Promise.resolve(newDe) : Promise.reject(new Error('HTTP 404')); };
P1.toggle('de', true);
const U = new Updater({ packs: P1, base: 'https://example/packs', dataDir: PD, log: quietLogU(), wanted: () => P1.wanted([]), get: fakeGet });
function quietLogU() { return { info: () => {}, warn: () => {} }; }
const upd = U.check(false).then((st1) => {
    ok(st1.updated === 1 && fetched.join() === 'index.json,de.json' && !st1.error, 'update: only the changed pack in use is downloaded (de; pl unchanged)');
    ok(P1.meta('de').src === 'update' && P1.cameras(['de']).length === 2 && P1.meta('us-ny').src === 'remote', 'the downloaded pack is used; a pack only on GitHub is listed');
    ok(!U.due(Date.now() + 1000) && U.due(Date.now() + 31 * 24 * 3600 * 1000), 'next check in a month');
    const U2 = new Updater({ packs: P1, base: 'https://example/packs', dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'upd-')), log: quietLogU(), get: () => Promise.reject(new Error('getaddrinfo ENOTFOUND')) });
    return U2.check(true).then((st2) => ok(/ENOTFOUND/.test(st2.error) && U2.due(Date.now() + 1000), 'offline: the error is kept and the check is due again (no month lost)'));
});

// languages: every text in all eight, the settings translated in place
const lang = require(path.join(A, 'lang'));
ok(Object.keys(lang.T).every((k) => lang.T[k].length === 8 && lang.T[k].every((x) => typeof x === 'string' && x)), 'every text in all 8 languages');
ok(Object.keys(lang.SETTINGS).every((k) => Object.keys(lang.SETTINGS[k]).every((o) => lang.SETTINGS[k][o].length === 8)), 'every setting in all 8 languages');
const spec = JSON.parse(fs.readFileSync(path.join(A, 'app.json'), 'utf8'));
ok(spec.settings.every((s) => lang.SETTINGS[s.key] && (s.options || []).every((o) => s.key === 'lang' || lang.SETTINGS[s.key][o[0]])), 'every setting of app.json (and its choices) has its translations');
const sch = JSON.parse(JSON.stringify(spec.settings));
lang.settings(sch, 'de');
ok(sch.find((s) => s.key === 'sound').label === 'Warnton' && sch.find((s) => s.key === 'banned').options[0][1] === 'Aus (wie vorgeschrieben)', 'settings in German');
ok(lang.make('pl')('in_dist', { d: '300 m', l: 50, label: 'A4' }) === 'za 300 m, limit 50 · A4' && lang.make('xx')('camera') === 'КАМЕРА', 'filling in; an unknown language falls back to Ukrainian');

// units and zones
const badge = require(path.join(A, 'badge'));
ok(badge.fmtDist(1240, 'kmh', lang.make('de')).v === '1,2' && badge.fmtDist(1240, 'kmh', lang.make('en')).v === '1.2' && badge.fmtDist(250, 'mph', lang.make('en')).u === 'ft'
    && badge.fmtDist(3218, 'mph', lang.make('en')).v === '2.0' && badge.inUnits(40.2, 'mph') === 25, 'distances and speeds in km / mi, limit 40.2 km/h = 25 mph');
const { AlertEngine } = require(path.join(A, 'alerts'));
const eng = new AlertEngine([{ id: 'fr:1', lat: 48.85, lon: 2.35, limit: 50, legal: 'zones' }, { id: 'pl:1', lat: 52.2, lon: 21, limit: 50, legal: 'ok' }], () => ({ lead: 20, minWarn: 300 }));
ok(eng.warnFor({ legal: 'zones' }, 90) === 2000 && eng.warnFor({ legal: 'zones' }, 130) === 4000 && eng.warnFor({ legal: 'ok' }, 90) === 500, 'a danger zone starts 2 km (4 km on a motorway) before the camera');
['ok', 'banned', 'zones'].forEach((m) => ok(fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'speedcam_ua', 'countries.py'), 'utf8').indexOf("'" + m + "'") > 0, 'countries.py uses legal mode ' + m));

// the chime: a WAV, and the AudioManager / MediaPlayer steps with a fake bus
const { Chime, wav, STYLES } = require(path.join(A, 'chime'));
Object.keys(STYLES).forEach((k) => {
    const b = wav(1, k);
    let pk = 0;
    for (let i = 44; i < b.length; i += 4) pk = Math.max(pk, Math.abs(b.readInt16LE(i)));
    ok(b.length === 44 + Math.round(48000 * STYLES[k].len) * 4 && pk > 26000 && pk <= 26214, 'sound "' + k + '": ' + STYLES[k].len + ' s, peak ' + pk);
});
const w = wav(0.5);
let peak = 0;
for (let i = 44; i < w.length; i += 2) peak = Math.max(peak, Math.abs(w.readInt16LE(i)));
ok(w.toString('ascii', 0, 4) === 'RIFF' && w.readUInt32LE(24) === 48000 && w.length === 44 + 24000 * 4 && peak > 5000 && peak <= 32767 * 0.8 * 0.5 + 1,
    'chime WAV: 0.5 s, 48 kHz stereo, at the volume (peak ' + peak + ')');
function fakeBus(o) {
    const calls = [];
    let conns = (o.prev || []).slice();
    return {
        calls,
        proxy: (iface, inst) => Promise.resolve({ iface, inst }),
        onAvailable: (p, fn) => { if (!(o.noPlayer && /MediaPlayer/.test(p.iface))) setTimeout(() => fn(true), 1); return Promise.resolve(); },
        call: (p, m, a) => {
            calls.push(m + (a && a.sourceID !== undefined ? ' ' + a.sourceID + '>' + a.sinkID : '') + (a && a.mainConnectionID !== undefined ? ' ' + a.mainConnectionID : '')
                + (m === 'playFile' ? ' ' + p.inst : ''));
            if (m === 'getListMainSources') return Promise.resolve({ listMainSources: [{ sourceID: 1048, name: 'OAPGenericOverlay' }, { sourceID: 1046, name: 'OAPGenericMedia' }] });
            if (m === 'getListMainConnections') return Promise.resolve({ listMainConnections: conns });
            if (m === 'connect') {
                if (o.refuse) return Promise.resolve({ amError: 'E_NOT_POSSIBLE' });
                conns = conns.filter((c) => c.sinkID !== a.sinkID).concat([{ mainConnectionID: 77, sourceID: a.sourceID, sinkID: a.sinkID, connectionState: 2 }]);
                return Promise.resolve({ amError: 'E_OK', mainConnectionID: 77 });
            }
            if (m === 'disconnect') { conns = conns.filter((c) => c.mainConnectionID !== a.mainConnectionID); return Promise.resolve({ amError: 'E_OK' }); }
            return Promise.resolve({});
        },
    };
}
const tmpD = fs.mkdtempSync(path.join(os.tmpdir(), 'chime-'));
const chimeRuns = [
    ['overlay', {}, (c, l) => c.join() === 'getListMainSources,getListMainConnections,connect 1048>1024,getListMainConnections,playFile OapGenericOverlay,disconnect 77' && l.ok],
    ['media', { prev: [{ mainConnectionID: 5, sourceID: 1, sinkID: 1024, connectionState: 2 }] },
        (c, l) => /connect 1046>1024,.*playFile OapGenericMedia,disconnect 77,connect 1>1024$/.test(c.join()) && l.ok],
    ['overlay', { refuse: true }, (c, l) => !/playFile|disconnect/.test(c.join()) && !l.ok && /refused/.test(l.steps[0])],
    ['interrupt', { noPlayer: true }, (c, l) => /connect 1047>1024/.test(c.join()) && /disconnect 77$/.test(c.join()) && !l.ok && /not offered/.test(l.steps.join())],
];
const chimeDone = chimeRuns.map((r) => {
    const bus = fakeBus(r[1]);
    const dd = fs.mkdtempSync(path.join(tmpD, 'd-'));
    const ch = new Chime(bus, quietLog, { scale: 0.01, tmpDir: tmpD, dataDir: dd });
    return ch.play(r[0], 0.7).then((last) => {
        ok(r[2](bus.calls, last) && !fs.existsSync(path.join(dd, 'chime-connection.json')),
            'chime ' + r[0] + (r[1].refuse ? ' refused' : r[1].noPlayer ? ' without its player' : '') + ': ' + bus.calls.join(', '));
    });
});
setTimeout(() => {
    ok(pr.done && pr.sources.length === 1 && pr.sources[0].name === 'MediaPlayer' && pr.sinks[0].id === 1024 && pr.tries === 3 && !pr.error,
        'audio probe retries until the audio manager answers (' + pr.tries + ' tries)');
    Promise.all(chimeDone.concat([upd])).then(() => console.log('unit: ' + n + ' checks passed'));
}, 400);
