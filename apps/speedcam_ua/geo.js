'use strict';
/**
 * geo.js - small spherical helpers and a grid index over the cameras.
 * Plain Node 8 (the car's 8.16.2): no optional chaining, no ??, no dependencies.
 */
const R = 6371008.8;               // mean Earth radius, m
const RAD = Math.PI / 180;

/** Great-circle distance in metres. */
function distance(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * RAD, p2 = lat2 * RAD, dp = (lat2 - lat1) * RAD, dl = (lon2 - lon1) * RAD;
    const a = Math.sin(dp / 2) * Math.sin(dp / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Initial bearing from 1 to 2, degrees clockwise from north, 0..360. */
function bearing(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) / RAD + 360) % 360;
}

/** Smallest signed difference b - a in degrees, -180..180. */
function angleDiff(a, b) {
    let d = ((b - a) % 360 + 540) % 360 - 180;
    if (d === -180) d = 180;
    return d;
}

/** The point d metres from (lat, lon) along bearing brg (for tests and the demo drive). */
function offset(lat, lon, brg, d) {
    const p1 = lat * RAD, l1 = lon * RAD, th = brg * RAD, dr = d / R;
    const p2 = Math.asin(Math.sin(p1) * Math.cos(dr) + Math.cos(p1) * Math.sin(dr) * Math.cos(th));
    const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(dr) * Math.cos(p1), Math.cos(dr) - Math.sin(p1) * Math.sin(p2));
    return { lat: p2 / RAD, lon: ((l2 / RAD + 540) % 360) - 180 };
}

/**
 * Grid of ~2 km cells over the cameras: near(lat, lon, radius) looks only at the cells around the point.
 * items: [{ lat, lon, ... }].
 */
class GridIndex {
    constructor(items, cellDeg) {
        this.cell = cellDeg || 0.02;
        this.cells = new Map();
        this.items = items;
        items.forEach((it) => {
            const k = this._key(Math.floor(it.lat / this.cell), Math.floor(it.lon / this.cell));
            if (!this.cells.has(k)) this.cells.set(k, []);
            this.cells.get(k).push(it);
        });
    }

    _key(i, j) { return i * 100000 + j; }

    /** Items within radius metres, each as { item, d } sorted by distance. */
    near(lat, lon, radius) {
        const dLat = radius / 111320, dLon = radius / (111320 * Math.max(0.2, Math.cos(lat * RAD)));
        const i0 = Math.floor((lat - dLat) / this.cell), i1 = Math.floor((lat + dLat) / this.cell);
        const j0 = Math.floor((lon - dLon) / this.cell), j1 = Math.floor((lon + dLon) / this.cell);
        const out = [];
        for (let i = i0; i <= i1; i++) {
            for (let j = j0; j <= j1; j++) {
                const list = this.cells.get(this._key(i, j));
                if (!list) continue;
                for (const it of list) {
                    const d = distance(lat, lon, it.lat, it.lon);
                    if (d <= radius) out.push({ item: it, d });
                }
            }
        }
        out.sort((a, b) => a.d - b.d);
        return out;
    }

    /** The nearest item at any distance: { item, d } or null (a full scan; the page's "nearest camera"). */
    nearest(lat, lon) {
        let best = null;
        for (const it of this.items) {
            const d = distance(lat, lon, it.lat, it.lon);
            if (!best || d < best.d) best = { item: it, d };
        }
        return best;
    }
}

module.exports = { distance, bearing, angleDiff, offset, GridIndex, RAD };
