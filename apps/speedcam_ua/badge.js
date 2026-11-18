'use strict';
/**
 * badge.js - the picture of a camera warning, as straight RGBA for a cluster-render image layer.
 *
 *   draw(alert, 'hud' | 'cluster', { warnDist, blink, units }) -> kit Canvas (cv.w x cv.h, cv.d = RGBA bytes)
 *
 * Left: the speed-limit sign (red ring, white disc, the limit). Right: the distance to the camera, big, a camera
 * pictogram, the car's speed (amber over the limit, red past the fine threshold) and a bar that runs out at the
 * camera. The HUD is a projection: black is see-through there, so the HUD badge has no background. The cluster badge
 * sits on a dark card with a red edge.
 * Plain Node 8.
 */
const { Canvas } = require('./kit/canvas');

const SIZE = { hud: [300, 150], cluster: [440, 168] };
const RED = '#e3141b', AMBER = '#ffb31a', WHITE = '#ffffff', GREY = '#9aa3ad', CARD = [10, 12, 16, 235];

function camera(cv, x, y, s, c) {
    // a pole-mounted box camera with a lens: s = height in px
    cv.roundRect(x, y + s * 0.18, s * 1.25, s * 0.62, s * 0.12, c);
    cv.circle(x + s * 1.25, y + s * 0.49, s * 0.2, c);
    cv.circle(x + s * 1.25, y + s * 0.49, s * 0.09, [0, 0, 0, 255]);
    cv.fillRect(x + s * 0.5, y + s * 0.8, s * 0.14, s * 0.2, c);
    cv.fillRect(x + s * 0.2, y + s * 0.96, s * 0.74, s * 0.08, c);
}

function fmtDist(m) {
    if (m >= 1000) return { v: (Math.round(m / 100) / 10).toFixed(1), u: 'km' };
    return { v: String(Math.max(0, Math.round(m / 10) * 10)), u: 'm' };
}

function draw(alert, kind, opts) {
    opts = opts || {};
    const sz = SIZE[kind] || SIZE.hud, W = sz[0], H = sz[1];
    const cv = new Canvas(W, H).clear([0, 0, 0, 0]);
    const hud = kind === 'hud';
    const pad = hud ? 4 : 14;
    if (!hud) {
        cv.roundRect(0, 0, W, H, 22, CARD);
        cv.strokeRoundRect(1, 1, W - 2, H - 2, 21, 4, RED);
    }
    // the sign
    const r = hud ? 62 : 64, cx = pad + r + 2, cy = hud ? 70 : H / 2 - 6;
    cv.circle(cx, cy, r, RED);
    cv.circle(cx, cy, r * 0.76, WHITE);
    const lim = String(alert.limit || '?');
    const fs = lim.length >= 3 ? r * 0.82 : r * 1.0;
    cv.text(lim, cx, cy + fs * 0.36, fs, [0, 0, 0, 255], { font: 'bold', align: 'center', literal: true });

    // distance, big
    const x0 = cx + r + (hud ? 16 : 22);
    const d = fmtDist(alert.dist);
    const dv = hud ? 62 : 64;
    const w = cv.text(d.v, x0, hud ? 64 : 70, dv, WHITE, { font: 'num', literal: true });
    cv.text(d.u, x0 + w + 6, hud ? 64 : 70, hud ? 30 : 32, GREY, { font: 'bold', literal: true });

    // the camera and the car's speed
    const blinkOff = alert.over === 2 && opts.blink;
    camera(cv, x0, hud ? 82 : 88, hud ? 30 : 32, RED);
    if (alert.speed > 0 && !blinkOff) {
        const sc = alert.over === 2 ? RED : alert.over === 1 ? AMBER : (hud ? '#d9e4ee' : WHITE);
        const sw = cv.text(String(alert.speed), x0 + (hud ? 52 : 56), hud ? 112 : 120, hud ? 36 : 40, sc, { font: 'bold', literal: true });
        cv.text(opts.units === 'mph' ? 'mph' : 'km/h', x0 + (hud ? 52 : 56) + sw + 5, hud ? 112 : 120, hud ? 20 : 22, GREY, { font: 'label', literal: true });
    }
    // the bar: full at the warning distance, empty at the camera
    const warn = opts.warnDist || 800;
    const f = Math.max(0, Math.min(1, alert.dist / warn));
    const bx = x0, bw = W - pad - x0, by = H - (hud ? 18 : 24), bh = hud ? 8 : 9;
    cv.roundRect(bx, by, bw, bh, bh / 2, hud ? [80, 80, 80, 255] : [60, 64, 72, 255]);
    if (f > 0) cv.roundRect(bx, by, Math.max(bh, bw * f), bh, bh / 2, alert.over ? (alert.over === 2 ? RED : AMBER) : WHITE);
    return cv;
}

module.exports = { draw, SIZE, fmtDist };
