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

// the camera list
const DB = require(path.join(A, 'cameras'));
ok(DB.rows.length === DB.meta.count && DB.rows.length > 400, 'cameras: ' + DB.rows.length);
ok(DB.rows.every((r) => r[1] > 44 && r[1] < 53 && r[2] > 22 && r[2] < 41 && r[3] >= 30 && r[3] <= 130), 'every camera in Ukraine with a sane limit');
console.log('unit: ' + n + ' checks passed');
