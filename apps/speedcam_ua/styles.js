'use strict';
/**
 * styles.js - the warning's other looks (setting "style"); badge.js draws the classic one.
 *
 *   'bmw'      close to BMW's own HUD panel: a thin red-ringed sign, white light type, a white camera; a ring round
 *              the sign closes as the camera comes near (instead of the bar); red only over the limit, where the
 *              ring and a halo "breathe" (opts.phase 0..1, the overlay repaints a few times a second)
 *   'minimal'  the sign and the distance; the camera and the car's speed only while over the limit
 *
 *   draw(cv, a, kind, opts, h) - h: badge.js's helpers { camera, fmtDist, inUnits, unitsOf, fit, lang, colours }
 *
 * Same sizes and options as badge.js (noSpeed / noLimit on the HUD, zones without a distance). Plain Node 8.
 */
const RED = '#e3141b', AMBER = '#ffb31a', WHITE = '#ffffff', GREY = '#a7b0ba';
const TRACK = [72, 78, 86, 255], PANEL = [10, 12, 16, 238], EDGE = [62, 68, 78, 255];

function rgb(hex) { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; }

/** over 2: RED, over 1: AMBER, else plain. */
function tone(a, plain) { return a.over === 2 ? RED : a.over === 1 ? AMBER : plain; }

/** 0..1 for the halo: a soft breath once a second. */
function breath(opts) { const p = typeof opts.phase === 'number' ? opts.phase : 0.5; return 0.5 - 0.5 * Math.cos(2 * Math.PI * p); }

/** How far along the warning is: 0 when it starts, 1 at the camera. */
function done(a, opts) { return Math.max(0, Math.min(1, 1 - a.dist / (opts.warnDist || 800))); }

/** BMW's sign: a thinner ring than the classic one. */
function sign(cv, cx, cy, r, limit) {
    cv.circle(cx, cy, r, RED);
    cv.circle(cx, cy, r * 0.82, WHITE);
    const lim = String(limit || '?');
    const fs = lim.length >= 3 ? r * 0.86 : r * 1.06;
    cv.text(lim, cx, cy + fs * 0.36, fs, [0, 0, 0, 255], { font: 'bold', align: 'center', literal: true });
}

/** The countdown ring round (cx, cy) outside radius r, and the breathing halo over the limit. */
function ring(cv, cx, cy, r, a, opts, w) {
    w = w || 5;
    const r0 = r + 6, r1 = r0 + w;
    if (a.over === 2) {
        // a soft glow outside the ring, breathing
        const b = breath(opts), c = rgb(RED);
        for (let i = 0; i < 3; i++) cv.arc(cx, cy, r1 + 1 + i * 2, r1 + 3 + i * 2, 0, 360, [c[0], c[1], c[2], Math.round((20 + 90 * b) * (1 - i * 0.3))]);
    }
    if (a.zone) { cv.arc(cx, cy, r0, r1, 0, 360, tone(a, AMBER)); return; }
    cv.arc(cx, cy, r0, r1, 0, 360, TRACK);
    const f = done(a, opts);
    if (f > 0.01) cv.arc(cx, cy, r0, r1, 0, 360 * f, tone(a, WHITE), { round: true });
}

/** The zone's name in two lines (the last word below). */
function zoneLines(tr) {
    const words = tr('zone').split(' ');
    return words.length > 1 ? [words.slice(0, -1).join(' '), words[words.length - 1]] : [words[0], ''];
}

function distance(cv, a, u, tr, h, x, y, size, c) {
    const d = h.fmtDist(a.dist, u, tr);
    const w = cv.text(d.v, x, y, size, c || WHITE, { font: 'light', literal: true });
    cv.text(d.u, x + w + 6, y, Math.round(size * 0.42), GREY, { literal: true });
    return w;
}

function speed(cv, a, u, tr, h, x, y, size, align) {
    const s = String(h.inUnits(a.speed, u));
    if (align === 'right') {
        cv.text(s, x, y, size, tone(a, WHITE), { font: 'bold', align: 'right', literal: true });
        cv.text(tr(u), x, y + Math.round(size * 0.55), 18, GREY, { align: 'right', literal: true });
        return;
    }
    const w = cv.text(s, x, y, size, tone(a, WHITE), { font: 'bold', literal: true });
    cv.text(tr(u), x + w + 5, y, 18, GREY, { literal: true });
}

/* ---- BMW ---- */

function bmwHud(cv, a, opts, h) {
    const W = cv.w, tr = opts.tr, u = h.unitsOf(a, opts), pad = 4;
    const r = 46, cx = pad + r + 17, cy = 72, x0 = cx + r + 30;
    ring(cv, cx, cy, r, a, opts);
    if (opts.noLimit) h.camera(cv, cx - 28, cy - 20, 40, tone(a, WHITE), [0, 0, 0, 255]);
    else sign(cv, cx, cy, r, h.inUnits(a.limit, u));
    if (a.zone) {
        const z = zoneLines(tr);
        cv.text(h.fit(cv, z[0], 24, W - pad - x0), x0, 44, 24, WHITE, { literal: true });
        if (z[1]) cv.text(h.fit(cv, z[1], 24, W - pad - x0), x0, 74, 24, WHITE, { literal: true });
    } else distance(cv, a, u, tr, h, x0, 72, 60);
    const showSpeed = !opts.noSpeed && a.speed > 0;
    if (!opts.noLimit || showSpeed) {
        if (!opts.noLimit) h.camera(cv, x0, 90, 24, tone(a, WHITE), [0, 0, 0, 255]);
        if (showSpeed) speed(cv, a, u, tr, h, opts.noLimit ? x0 : x0 + 42, 116, 32);
    }
    return cv;
}

function bmwCard(cv, a, opts, h) {
    const W = cv.w, H = cv.h, tr = opts.tr, u = h.unitsOf(a, opts);
    cv.roundRect(0, 0, W, H, 22, PANEL);
    if (a.over === 2) {
        const c = rgb(RED);
        cv.strokeRoundRect(1, 1, W - 2, H - 2, 21, 3, [c[0], c[1], c[2], Math.round(90 + 165 * breath(opts))]);
    } else cv.strokeRoundRect(1, 1, W - 2, H - 2, 21, 2, EDGE);
    const r = 52, cx = 18 + r + 10, cy = H / 2, x0 = cx + r + 30, right = W - 20;
    ring(cv, cx, cy, r, a, opts);
    sign(cv, cx, cy, r, h.inUnits(a.limit, u));
    if (a.zone) {
        const z = zoneLines(tr);
        cv.text(h.fit(cv, z[0], 30, right - x0 - 70), x0, 52, 30, WHITE, { literal: true });
        if (z[1]) cv.text(h.fit(cv, z[1], 30, right - x0 - 70), x0, 86, 30, WHITE, { literal: true });
    } else distance(cv, a, u, tr, h, x0, 82, 64);
    if (a.speed > 0) speed(cv, a, u, tr, h, right, 70, 40, 'right');
    h.camera(cv, x0, 110, 24, tone(a, WHITE), PANEL);
    cv.text(h.fit(cv, a.zone ? tr('zone_hint') : a.label || '', 20, right - x0 - 42), x0 + 42, 130, 20, GREY, { literal: true });
    return cv;
}

function bmwMap(cv, a, opts, h) {
    const W = cv.w, H = cv.h, tr = opts.tr, u = h.unitsOf(a, opts);
    cv.roundRect(0, 0, W, H, 22, [14, 16, 20, 255]);
    if (a.over === 2) {
        const c = rgb(RED);
        cv.strokeRoundRect(1, 1, W - 2, H - 2, 21, 3, [c[0], c[1], c[2], Math.round(90 + 165 * breath(opts))]);
    } else cv.strokeRoundRect(1, 1, W - 2, H - 2, 21, 2, EDGE);
    const r = 42, cx = 20 + r + 10, cy = H / 2, x0 = cx + r + 30, right = W - 22;
    ring(cv, cx, cy, r, a, opts, 4);
    sign(cv, cx, cy, r, h.inUnits(a.limit, u));
    h.camera(cv, x0, 22, 26, tone(a, WHITE), [14, 16, 20, 255]);
    if (a.zone) cv.text(h.fit(cv, tr('zone'), 32, right - x0 - 150), x0 + 50, 50, 32, WHITE, { literal: true });
    else distance(cv, a, u, tr, h, x0 + 50, 52, 50);
    if (a.speed > 0) speed(cv, a, u, tr, h, right, 50, 44, 'right');
    cv.text(h.fit(cv, a.zone ? tr('zone_hint') : a.label || '', 22, right - x0 - (a.speed > 0 ? 90 : 0)), x0, 96, 22, GREY, { literal: true });
    return cv;
}

/* ---- minimal ---- */

function minHud(cv, a, opts, h) {
    const W = cv.w, tr = opts.tr, u = h.unitsOf(a, opts), pad = 4;
    const r = 52, cx = pad + r + 4, cy = 70, x0 = opts.noLimit ? pad + 84 : cx + r + 18;
    if (opts.noLimit) h.camera(cv, pad, cy - 24, 46, tone(a, WHITE), [0, 0, 0, 255]);
    else sign(cv, cx, cy, r, h.inUnits(a.limit, u));
    if (a.zone) {
        const z = zoneLines(tr);
        cv.text(h.fit(cv, z[0], 28, W - pad - x0), x0, 62, 28, WHITE, { literal: true });
        if (z[1]) cv.text(h.fit(cv, z[1], 28, W - pad - x0), x0, 96, 28, WHITE, { literal: true });
        return cv;
    }
    distance(cv, a, u, tr, h, x0, a.over ? 70 : 92, 64);
    if (a.over) {
        if (!opts.noLimit) h.camera(cv, x0, 86, 26, tone(a), [0, 0, 0, 255]);
        if (!opts.noSpeed && a.speed > 0) speed(cv, a, u, tr, h, opts.noLimit ? x0 : x0 + 46, 114, 32);
    }
    return cv;
}

function minCard(cv, a, opts, h) {
    const W = cv.w, H = cv.h, tr = opts.tr, u = h.unitsOf(a, opts);
    // a lower, quieter card at the bottom of the image (its place is anchored at the bottom)
    const top = 32, ch = H - top;
    cv.roundRect(0, top, W, ch, 20, PANEL);
    if (a.over) cv.strokeRoundRect(1, top + 1, W - 2, ch - 2, 19, 3, tone(a));
    const r = 46, cx = 18 + r, cy = top + ch / 2, x0 = cx + r + 22, right = W - 20;
    sign(cv, cx, cy, r, h.inUnits(a.limit, u));
    if (a.zone) cv.text(h.fit(cv, tr('zone'), 32, right - x0 - (a.over && a.speed > 0 ? 80 : 0)), x0, cy + 12, 32, WHITE, { literal: true });
    else distance(cv, a, u, tr, h, x0, cy + 22, 60);
    if (a.over && a.speed > 0) speed(cv, a, u, tr, h, right, cy + 8, 40, 'right');
    return cv;
}

function minMap(cv, a, opts, h) {
    const W = cv.w, H = cv.h, tr = opts.tr, u = h.unitsOf(a, opts);
    cv.roundRect(0, 0, W, H, 22, [14, 16, 20, 255]);
    if (a.over) cv.strokeRoundRect(1, 1, W - 2, H - 2, 21, 3, tone(a));
    const r = 44, cx = 22 + r, cy = H / 2, x0 = cx + r + 24, right = W - 22;
    sign(cv, cx, cy, r, h.inUnits(a.limit, u));
    if (a.zone) cv.text(h.fit(cv, tr('zone'), 34, right - x0 - (a.over && a.speed > 0 ? 80 : 0)), x0, 56, 34, WHITE, { literal: true });
    else distance(cv, a, u, tr, h, x0, 64, 56);
    if (a.over && a.speed > 0) speed(cv, a, u, tr, h, right, 54, 44, 'right');
    cv.text(h.fit(cv, a.zone ? tr('zone_hint') : a.label || '', 22, right - x0 - (a.over ? 90 : 0)), x0, 102, 22, GREY, { literal: true });
    return cv;
}

const STYLES = {
    bmw: { hud: bmwHud, cluster: bmwCard, map: bmwMap },
    minimal: { hud: minHud, cluster: minCard, map: minMap },
};

function draw(cv, a, kind, opts, h) { return STYLES[opts.style][kind](cv, a, opts, h); }

/** Whether the style moves (repaints a few times a second) for this alert. */
function animated(style, a) { return style === 'bmw' && !!a && a.over === 2; }

module.exports = { draw, animated, has: (s) => !!STYLES[s], breath };
