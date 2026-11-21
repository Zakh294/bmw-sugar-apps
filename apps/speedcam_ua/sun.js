'use strict';
/**
 * sun.js - the sun's height over the horizon at a place and time (NOAA's simplified solar position), for the
 * night dimming: night when the sun is below CIVIL (-6 deg, civil twilight). Needs no time zone: Date is UTC inside.
 * Accurate to about a tenth of a degree, plenty for "is it dark". Plain Node 8.
 */
const RAD = Math.PI / 180;
const CIVIL = -6;

/** Degrees above the horizon (negative below) at lat, lon (degrees, east positive) and date (Date or ms). */
function elevation(lat, lon, date) {
    const t = date instanceof Date ? date.getTime() : date;
    const jd = t / 86400000 + 2440587.5;
    const n = jd - 2451545.0;                                    // days since J2000
    const L = (280.460 + 0.9856474 * n) % 360;                    // mean longitude
    const g = ((357.528 + 0.9856003 * n) % 360) * RAD;            // mean anomaly
    const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;   // ecliptic longitude
    const eps = (23.439 - 0.0000004 * n) * RAD;                   // obliquity
    const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
    const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
    const gmst = (18.697374558 + 24.06570982441908 * n) % 24;     // hours
    const lst = (gmst * 15 + lon) * RAD;                          // local sidereal time, radians
    const ha = lst - ra;                                          // hour angle
    const phi = lat * RAD;
    const sinAlt = Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha);
    return Math.asin(Math.max(-1, Math.min(1, sinAlt))) / RAD;
}

/** True after dusk / before dawn (the sun below civil twilight). */
function isNight(lat, lon, date) { return elevation(lat, lon, date) < CIVIL; }

module.exports = { elevation, isNight, CIVIL };
