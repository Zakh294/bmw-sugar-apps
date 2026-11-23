'use strict';
/**
 * badge.js - the picture of a camera warning, as straight RGBA for a cluster-render image layer.
 *
 *   draw(alert, kind, { warnDist, blink, tr, units, noSpeed, noLimit, style, phase }) -> kit Canvas (cv.w x cv.h, cv.d = RGBA)
 *   style: 'classic' (here), 'bmw' or 'minimal' (styles.js)
 *   tr: the language (lang.make), units: 'kmh' | 'mph' | 'auto' (as the camera's country: alert.units)
 *   kind: 'hud'     the windshield HUD: no background (black is see-through on a projection); noSpeed / noLimit leave
 *                   out the car's speed / the limit sign there, which BMW's own HUD panel already shows
 *         'cluster' the instrument cluster without a phone map: a compact dark card
 *         'map'     inside the Waze / Google map on the cluster (Maps on cluster): a wide banner like a navigation
 *                   alert - the limit sign, "КАМЕРА" with the distance, where the camera is, the car's speed, a bar
 *
 * Every kind: the speed-limit sign (red ring, white disc, the limit), the distance (m / km, or ft / mi with mph), the
 * car's speed (white within the limit, amber over it, red and blinking past the fine threshold) and a bar that runs
 * out at the camera. A danger zone (France: alert.zone) shows the zone instead of the distance, and no bar.
 * Text in any of the app's languages: the kit picks its "cyrillic" atlas for Cyrillic, the Latin atlases carry the
 * European letters (tools/bake_fonts_i18n.py).
 * Plain Node 8.
 */
// the kit beside the app when built, the repository's kit/ for the tests
let Canvas;
try { Canvas = require('./kit/canvas').Canvas; } catch (e) { Canvas = require('../../kit/runtime/canvas').Canvas; }
const lang = require('./lang');
const styles = require('./styles');

const MPH = 1.609344;

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

/** A distance as { v, u }: m / km (1,2 km), or with mph ft / mi (0.4 mi). */
function fmtDist(m, units, tr) {
    tr = tr || lang.make('uk');
    if (units === 'mph') {
        const ft = m / 0.3048;
        if (ft < 1000) return { v: String(Math.max(0, Math.round(ft / 50) * 50)), u: tr('ft') };
        return { v: (Math.round(m / MPH / 100) / 10).toFixed(1), u: tr('mi') };
    }
    const comma = tr.lang !== 'en';
    if (m >= 1000) { const v = (Math.round(m / 100) / 10).toFixed(1); return { v: comma ? v.replace('.', ',') : v, u: tr('km') }; }
    return { v: String(Math.max(0, Math.round(m / 10) * 10)), u: tr('m') };
}

/** km/h in the units: a whole number (a limit in mph comes back to its round value). */
function inUnits(kmh, units) { return kmh === null || kmh === undefined ? null : Math.round(units === 'mph' ? kmh / MPH : kmh); }

function unitsOf(a, opts) { return opts.units === 'kmh' || opts.units === 'mph' ? opts.units : a.units === 'mph' ? 'mph' : 'kmh'; }

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
    const W = cv.w, H = cv.h, tr = opts.tr || lang.make('uk'), u = unitsOf(a, opts);
    // a red left edge: the red card, the dark one over it from x 10
    cv.roundRect(0, 0, W, H, 22, RED);
    cv.roundRect(10, 0, W - 10, H, 22, [14, 16, 20, 255]);
    if (a.over === 2 && !opts.blink) cv.strokeRoundRect(1, 1, W - 2, H - 2, 21, 4, RED);
    sign(cv, 30 + 50, H / 2, 50, inUnits(a.limit, u));
    const x0 = 152;
    // line 1: the camera, "CAMERA", the distance (a zone: its name)
    camera(cv, x0, 18, 30, RED, CARD);
    if (a.zone) {
        cv.text(fit(cv, tr('zone'), 34, W - x0 - 160), x0 + 50, 50, 34, WHITE, { font: 'bold', literal: true });
    } else {
        const head = tr('camera');
        cv.text(head, x0 + 50, 44, 24, GREY, { literal: true });
        const lw = cv.textWidth(head, 24, { literal: true });
        const d = fmtDist(a.dist, u, tr);
        const dx = x0 + 50 + lw + 16;
        const dw = cv.text(d.v, dx, 50, 50, WHITE, { font: 'num', literal: true });
        cv.text(d.u, dx + dw + 6, 50, 30, GREY, { literal: true });
    }
    // the car's speed, right
    const right = W - 22;
    if (a.speed > 0 && !(a.over === 2 && opts.blink)) {
        cv.text(String(inUnits(a.speed, u)), right, 50, 46, speedColour(a, WHITE), { font: 'bold', align: 'right', literal: true });
        cv.text(tr(u), right, 74, 18, GREY, { align: 'right', literal: true });
    }
    // line 2: where it is (a zone: what it is, not where)
    cv.text(fit(cv, a.zone ? tr('zone_hint') : a.label || '', 22, right - x0 - (a.speed > 0 ? 90 : 0)), x0, 92, 22, '#dfe5ec', { literal: true });
    // the bar
    if (!a.zone) bar(cv, x0, H - 22, right - x0, 8, Math.max(0, Math.min(1, a.dist / (opts.warnDist || 800))), a, [60, 64, 72, 255]);
}

/**
 * The HUD: no background. opts.noSpeed leaves out the car's speed (BMW shows it beside), opts.noLimit the limit sign
 * (the car shows the same one): without the speed the camera goes beside the bar, without the sign a big camera
 * takes its place.
 */
function drawHud(cv, a, opts) {
    const W = cv.w, H = cv.h, tr = opts.tr || lang.make('uk'), u = unitsOf(a, opts), pad = 4, BLACK = [0, 0, 0, 255];
    const withSign = !opts.noLimit, withSpeed = !opts.noSpeed;
    let x0;
    if (withSign) { sign(cv, pad + 64, 70, 62, inUnits(a.limit, u)); x0 = pad + 142; }
    else { camera(cv, pad + 2, 44, 46, RED, BLACK); x0 = pad + 84; }
    // line 1: the distance, big (a zone: its name in two lines)
    if (a.zone) {
        const words = tr('zone').split(' ');
        const top = words.length > 1 ? words.slice(0, -1).join(' ') : words[0], bottom = words.length > 1 ? words[words.length - 1] : '';
        cv.text(fit(cv, top, 30, W - pad - x0), x0, 34, 30, WHITE, { font: 'bold', literal: true });
        if (bottom) cv.text(fit(cv, bottom, 30, W - pad - x0), x0, 68, 30, WHITE, { font: 'bold', literal: true });
    } else {
        const d = fmtDist(a.dist, u, tr);
        const w = cv.text(d.v, x0, 64, 62, WHITE, { font: 'num', literal: true });
        cv.text(d.u, x0 + w + 6, 64, 30, GREY, { literal: true });
    }
    // line 2: the camera (beside the sign) and the car's speed; without the speed the bar comes up to this line
    let barX = x0, barY = H - 18;
    if (withSign && withSpeed) camera(cv, x0, 82, 30, RED, BLACK);
    else if (withSign) { camera(cv, x0, 84, 28, RED, BLACK); barX = x0 + 48; barY = 94; }
    else if (!withSpeed) barY = 94;
    if (withSpeed && a.speed > 0 && !(a.over === 2 && opts.blink)) {
        const sx = withSign ? x0 + 52 : x0;
        const sw = cv.text(String(inUnits(a.speed, u)), sx, 112, 36, speedColour(a, '#d9e4ee'), { font: 'bold', literal: true });
        cv.text(tr(u), sx + sw + 5, 112, 18, GREY, { literal: true });
    }
    if (a.zone) return cv;
    bar(cv, barX, barY, W - pad - barX, 8, Math.max(0, Math.min(1, a.dist / (opts.warnDist || 800))), a, [80, 80, 80, 255]);
    return cv;
}

/** The cluster card (dark, red edge). */
function drawCard(cv, alert, opts) {
    const W = cv.w, H = cv.h, tr = opts.tr || lang.make('uk'), u = unitsOf(alert, opts), pad = 14;
    cv.roundRect(0, 0, W, H, 22, CARD);
    cv.strokeRoundRect(1, 1, W - 2, H - 2, 21, 4, RED);
    const r = 64, cx = pad + r + 2, cy = H / 2 - 6;
    sign(cv, cx, cy, r, inUnits(alert.limit, u));
    const x0 = cx + r + 22;
    if (alert.zone) {
        const words = tr('zone').split(' ');
        const top = words.length > 1 ? words.slice(0, -1).join(' ') : words[0], bottom = words.length > 1 ? words[words.length - 1] : '';
        cv.text(fit(cv, top, 32, W - pad - x0), x0, 40, 32, WHITE, { font: 'bold', literal: true });
        if (bottom) cv.text(fit(cv, bottom, 32, W - pad - x0), x0, 76, 32, WHITE, { font: 'bold', literal: true });
    } else {
        const d = fmtDist(alert.dist, u, tr);
        const w = cv.text(d.v, x0, 70, 64, WHITE, { font: 'num', literal: true });
        cv.text(d.u, x0 + w + 6, 70, 32, GREY, { literal: true });
    }
    const blinkOff = alert.over === 2 && opts.blink;
    camera(cv, x0, 88, 32, RED, CARD);
    if (alert.speed > 0 && !blinkOff) {
        const sx = x0 + 56;
        const sw = cv.text(String(inUnits(alert.speed, u)), sx, 120, 40, speedColour(alert, WHITE), { font: 'bold', literal: true });
        cv.text(tr(u), sx + sw + 5, 120, 20, GREY, { literal: true });
    }
    if (alert.zone) return cv;
    const f = Math.max(0, Math.min(1, alert.dist / (opts.warnDist || 800)));
    bar(cv, x0, H - 24, W - pad - x0, 9, f, alert, [60, 64, 72, 255]);
    return cv;
}

/**
 * opts: { warnDist, blink, tr, units, noSpeed, noLimit (the last two: the HUD only), style ('classic' | 'bmw' |
 * 'minimal', styles.js), phase (0..1, the bmw style's breathing) }.
 */
function draw(alert, kind, opts) {
    opts = opts || {};
    const sz = SIZE[kind] || SIZE.hud;
    const cv = new Canvas(sz[0], sz[1]).clear([0, 0, 0, 0]);
    if (opts.style && styles.has(opts.style)) {
        return styles.draw(cv, alert, kind === 'map' || kind === 'cluster' ? kind : 'hud', Object.assign({}, opts, { tr: opts.tr || lang.make('uk') }), HELP);
    }
    if (kind === 'map') drawMap(cv, alert, opts);
    else if (kind === 'cluster') drawCard(cv, alert, opts);
    else drawHud(cv, alert, opts);
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

const HELP = { camera, fmtDist, inUnits, unitsOf, fit };

module.exports = { draw, dim, SIZE, fmtDist, inUnits };
