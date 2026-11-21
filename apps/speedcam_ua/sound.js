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

function rows(list, idKey) {
    return (Array.isArray(list) ? list : []).map((x) => ({
        id: x && (x[idKey] !== undefined ? x[idKey] : x.id),
        name: x && x.name !== undefined ? String(x.name) : '?',
        cls: x && (x.sourceClassID !== undefined ? x.sourceClassID : x.sinkClassID),
    }));
}

/** Starts the probe; returns the state object the page reads: { done, sources, sinks, error }. */
function probe(signals, log) {
    const st = { done: false, sources: [], sinks: [], error: null };
    if (!signals || !signals.proxy || !signals.call) { st.error = 'no method calls in this kit'; st.done = true; return st; }
    setTimeout(() => {
        Promise.resolve(signals.proxy(IFACE, '1'))
            .then((p) => Promise.all([
                signals.call(p, 'getListMainSources', {}).catch((e) => ({ error: String(e && e.message || e) })),
                signals.call(p, 'getListMainSinks', {}).catch((e) => ({ error: String(e && e.message || e) })),
            ]))
            .then((r) => {
                st.sources = rows(r[0] && r[0].listMainSources, 'sourceID');
                st.sinks = rows(r[1] && r[1].listMainSinks, 'sinkID');
                st.error = (r[0] && r[0].error) || (r[1] && r[1].error) || null;
                log.info('audio: sources ' + st.sources.map((s) => s.id + ' ' + JSON.stringify(s.name) + ' class ' + s.cls).join(', '));
                log.info('audio: sinks ' + st.sinks.map((s) => s.id + ' ' + JSON.stringify(s.name) + ' class ' + s.cls).join(', '));
                if (st.error) log.warn('audio: ' + st.error);
            })
            .catch((e) => { st.error = String(e && e.message || e); log.warn('audio probe: ' + st.error); })
            .then(() => { st.done = true; });
    }, DELAY_MS);
    return st;
}

module.exports = { probe, IFACE };
