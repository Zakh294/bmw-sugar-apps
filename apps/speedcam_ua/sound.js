'use strict';
/**
 * sound.js - first step towards a chime: finds out what the car's audio manager offers, read-only.
 *
 * The head unit routes sound through the GENIVI audio manager (org.genivi.am.commandinterface.CommandControl, the
 * one RideTube talks to). Playing a file through BMW's media player would take the audio source away from the radio
 * or CarPlay, so it is no good for a short chime; the audio manager may have a source that mixes over the music
 * (navigation prompts, gongs). This only asks for its lists of sources and sinks (getListMainSources,
 * getListMainSinks: two reads, nothing connected or played), logs them and keeps them for the page, so the next
 * version can use the right one. Plain Node 8.
 */
const IFACE = 'org.genivi.am.commandinterface.CommandControl';
const DELAY_MS = 20000;            // after start: the audio manager comes up late in a boot
const RETRY_MS = 30000;            // then again while it answers "Service unavailable"
const TRIES = 20;                  // ... for up to 10 minutes

function rows(list, idKey) {
    return (Array.isArray(list) ? list : []).map((x) => ({
        id: x && (x[idKey] !== undefined ? x[idKey] : x.id),
        name: x && x.name !== undefined ? String(x.name) : '?',
        cls: x && (x.sourceClassID !== undefined ? x.sourceClassID : x.sinkClassID),
    }));
}

/**
 * Starts the probe; returns the state object the page reads: { done, sources, sinks, error, tries }.
 * The audio manager comes up well after the app (a first try 20 s in said "Service unavailable"), so this waits for
 * the provider's availability and asks each list on its own, again every RETRY_MS while it fails, up to TRIES times.
 */
function probe(signals, log, opts) {
    opts = opts || {};
    const delay = opts.delayMs !== undefined ? opts.delayMs : DELAY_MS;
    const retry = opts.retryMs || RETRY_MS, tries = opts.tries || TRIES;
    const st = { done: false, sources: [], sinks: [], error: null, tries: 0, available: false };
    if (!signals || !signals.proxy || !signals.call) { st.error = 'no method calls in this kit'; st.done = true; return st; }
    let p = null, timer = null;
    const ask = (method, key, idKey) => signals.call(p, method, {}, 8000)
        .then((r) => { st[key] = rows(r && r[key === 'sources' ? 'listMainSources' : 'listMainSinks'], idKey); return null; })
        .catch((e) => String(e && e.message || e));
    const attempt = () => {
        timer = null;
        if (st.done) return;
        st.tries++;
        Promise.all([
            st.sources.length ? null : ask('getListMainSources', 'sources', 'sourceID'),
            st.sinks.length ? null : ask('getListMainSinks', 'sinks', 'sinkID'),
        ]).then((errs) => {
            const err = errs.filter((e) => e).join('; ');
            st.error = err || null;
            if (!err || st.tries >= tries) {
                st.done = true;
                log.info('audio: sources ' + st.sources.map((s) => s.id + ' ' + JSON.stringify(s.name) + ' class ' + s.cls).join(', '));
                log.info('audio: sinks ' + st.sinks.map((s) => s.id + ' ' + JSON.stringify(s.name) + ' class ' + s.cls).join(', '));
                if (err) log.warn('audio: gave up after ' + st.tries + ' tries: ' + err);
            } else if (!timer) timer = setTimeout(attempt, retry);
        });
    };
    setTimeout(() => {
        Promise.resolve(signals.proxy(IFACE, '1'))
            .then((px) => {
                p = px;
                const kick = (a) => { st.available = a; if (a && !st.done && !timer) timer = setTimeout(attempt, 500); };
                if (signals.onAvailable) return signals.onAvailable(p, kick);
                kick(true);
                return null;
            })
            .then(() => { if (!st.available && !st.done && !timer) timer = setTimeout(attempt, retry); })   // no availability news: try anyway
            .catch((e) => { st.error = String(e && e.message || e); st.done = true; log.warn('audio probe: ' + st.error); });
    }, delay);
    return st;
}

module.exports = { probe, IFACE };
