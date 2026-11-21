'use strict';
/**
 * badge.js - the picture of a camera warning, as straight RGBA for a cluster-render image layer.
 *
 *   draw(alert, kind, { warnDist, blink }) -> kit Canvas (cv.w x cv.h, cv.d = RGBA bytes)
 *   kind: 'hud'     the windshield HUD: no background (black is see-through on a projection)
 *         'cluster' the instrument cluster without a phone map: a compact dark card
 *         'map'     inside the Waze / Google map on the cluster (Maps on cluster): a wide banner like a navigation
 *                   alert - the limit sign, "КАМЕРА" with the distance, where the camera is, the car's speed, a bar
 *
 * Every kind: the speed-limit sign (red ring, white disc, the limit), the distance (м / км), the car's speed (white
 * within the limit, amber over it, red and blinking past the fine threshold) and a bar that runs out at the camera.
 * Ukrainian text draws with the kit's "cyrillic" atlas (kit/runtime/fonts/cyrillic.json, tools/bake_ukrainian_font.py).
 * Plain Node 8.
 */
const { Canvas } = require('./kit/canvas');

const SIZE = { hud: [300, 150], cluster: [440, 168], map: [640, 132] };
const RED = '#e3141b', AMBER = '#ffb31a', WHITE = '#ffffff', GREY = '#a7b0ba', CARD = [14, 16, 20, 238];

function camera(cv, x, y, s, c, hole) {
    // a box camera on a pole with a lens: s = height in px
    cv.roundRect(x, y + s * 0.18, s * 1.25, s * 0.62, s * 0.12, c);
    cv.circle(x + s * 1.25, y + s * 0.49, s * 0.2, c);
    cv.circle(x + s * 1.25, y + s * 0.49, s * 0.09, hole || [0, 0, 0, 255]);
    cv.fillRect(x + s * 0.5, y + s * 0.8, s * 0.14, s * 0.2, c);
    cv.fillRect(x + s * 0.2, y + s * 0.96, s * 0.74, s * 0.08, c);
}

function sign(cv, cx, cy, r, limit) {
    cv.circle(cx, cy, r, RED);
    cv.circle(cx, cy, r * 0.76, WHITE);
    const lim = String(limit || '?');
    const fs = lim.length >= 3 ? r * 0.82 : r * 1.0;
    cv.text(lim, cx, cy + fs * 0.36, fs, [0, 0, 0, 255], { font: 'bold', align: 'center', literal: true });
}

function fmtDist(m) {
    if (m >= 1000) return { v: (Math.round(m / 100) / 10).toFixed(1).replace('.', ','), u: 'км' };
    return { v: String(Math.max(0, Math.round(m / 10) * 10)), u: 'м' };
}

function speedColour(a, plain) { return a.over === 2 ? RED : a.over === 1 ? AMBER : plain; }

/** str cut with an ellipsis to fit w px. */
function fit(cv, str, size, w) {
    str = String(str || '');
    if (cv.textWidth(str, size, { literal: true }) <= w) return str;
    while (str.length > 1 && cv.textWidth(str + '…', size, { literal: true }) > w) str = str.slice(0, -1);
    return str.replace(/[\s,]+$/, '') + '…';
}

function bar(cv, x, y, w, h, f, a, track) {
    cv.roundRect(x, y, w, h, h / 2, track);
    if (f > 0) cv.roundRect(x, y, Math.max(h, w * f), h, h / 2, a.over ? speedColour(a) : WHITE);
}

function drawMap(cv, a, opts) {
    const W = cv.w, H = cv.h;
    // a red left edge: the red card, the dark one over it from x 10
    cv.roundRect(0, 0, W, H, 22, RED);
    cv.roundRect(10, 0, W - 10, H, 22, [14, 16, 20, 255]);
    if (a.over === 2 && !opts.blink) cv.strokeRoundRect(1, 1, W - 2, H - 2, 21, 4, RED);
    sign(cv, 30 + 50, H / 2, 50, a.limit);
    const x0 = 152;
    // line 1: the camera, "КАМЕРА", the distance
    camera(cv, x0, 18, 30, RED, CARD);
    cv.text('КАМЕРА', x0 + 50, 44, 24, GREY, { literal: true });
    const lw = cv.textWidth('КАМЕРА', 24, { literal: true });
    const d = fmtDist(a.dist);
    const dx = x0 + 50 + lw + 16;
    const dw = cv.text(d.v, dx, 50, 50, WHITE, { font: 'num', literal: true });
    cv.text(d.u, dx + dw + 6, 50, 30, GREY, { literal: true });
    // the car's speed, right
    const right = W - 22;
    if (a.speed > 0 && !(a.over === 2 && opts.blink)) {
        cv.text(String(a.speed), right, 50, 46, speedColour(a, WHITE), { font: 'bold', align: 'right', literal: true });
        cv.text('км/год', right, 74, 18, GREY, { align: 'right', literal: true });
    }
    // line 2: where it is
    cv.text(fit(cv, a.label || '', 22, right - x0 - (a.speed > 0 ? 90 : 0)), x0, 92, 22, '#dfe5ec', { literal: true });
    // the bar
    bar(cv, x0, H - 22, right - x0, 8, Math.max(0, Math.min(1, a.dist / (opts.warnDist || 800))), a, [60, 64, 72, 255]);
}

function draw(alert, kind, opts) {
    opts = opts || {};
    const sz = SIZE[kind] || SIZE.hud, W = sz[0], H = sz[1];
    const cv = new Canvas(W, H).clear([0, 0, 0, 0]);
    if (kind === 'map') { drawMap(cv, alert, opts); return cv; }
    const hud = kind === 'hud';
    const pad = hud ? 4 : 14;
    if (!hud) {
        cv.roundRect(0, 0, W, H, 22, CARD);
        cv.strokeRoundRect(1, 1, W - 2, H - 2, 21, 4, RED);
    }
    const r = hud ? 62 : 64, cx = pad + r + 2, cy = hud ? 70 : H / 2 - 6;
    sign(cv, cx, cy, r, alert.limit);

    // distance, big
    const x0 = cx + r + (hud ? 16 : 22);
    const d = fmtDist(alert.dist);
    const w = cv.text(d.v, x0, hud ? 64 : 70, hud ? 62 : 64, WHITE, { font: 'num', literal: true });
    cv.text(d.u, x0 + w + 6, hud ? 64 : 70, hud ? 30 : 32, GREY, { literal: true });

    // the camera and the car's speed
    const blinkOff = alert.over === 2 && opts.blink;
    camera(cv, x0, hud ? 82 : 88, hud ? 30 : 32, RED, hud ? [0, 0, 0, 255] : CARD);
    if (alert.speed > 0 && !blinkOff) {
        const sx = x0 + (hud ? 52 : 56);
        const sw = cv.text(String(alert.speed), sx, hud ? 112 : 120, hud ? 36 : 40, speedColour(alert, hud ? '#d9e4ee' : WHITE), { font: 'bold', literal: true });
        cv.text('км/год', sx + sw + 5, hud ? 112 : 120, hud ? 18 : 20, GREY, { literal: true });
    }
    const f = Math.max(0, Math.min(1, alert.dist / (opts.warnDist || 800)));
    const bh = hud ? 8 : 9;
    bar(cv, x0, H - (hud ? 18 : 24), W - pad - x0, bh, f, alert, hud ? [80, 80, 80, 255] : [60, 64, 72, 255]);
    return cv;
}

/** The picture at k brightness (0..1): colours scaled, alpha kept. */
function dim(cv, k) {
    const d = cv.d;
    for (let i = 0; i < d.length; i += 4) {
        d[i] = Math.round(d[i] * k); d[i + 1] = Math.round(d[i + 1] * k); d[i + 2] = Math.round(d[i + 2] * k);
    }
    return cv;
}

module.exports = { draw, dim, SIZE, fmtDist };
