'use strict';
/**
 * find_position.js - run on the head unit over SSH to see where its firmware publishes the car's position.
 * Reads the SOME/IP catalog only (no bus traffic, nothing written) and prints every field / event whose data type
 * has a latitude and a longitude, best first - the same ranking tools/store_build.py uses when the Store builds the app.
 *
 * From Windows (cmd), with the key from the MGU Store setup:
 *   ssh -i %USERPROFILE%\.ssh\mgu_root_key -o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa root@172.16.222.97 "node -" < tools\speedcam_ua\find_position.js
 * Optional: a name filter as the first argument (e.g. "posit") lists every interface whose name matches, with fields.
 * Plain Node 8 (the car's 8.16.2).
 */
const fs = require('fs');
const CATALOG = process.env.MGU_SOMEIP_CATALOG || '/etc/oap/someip/someip-interfaces.json';

const words = (n) => String(n).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
const isLat = (n) => { const w = words(n); return /(^|[^a-z])lat(itude)?([^a-z]|$)|latitude|wgs84lat/.test(w) && !/lateral|relat|plate|translat/.test(w); };
const isLon = (n) => { const w = words(n); return /(^|[^a-z])(lon|lng)(gitude)?([^a-z]|$)|longitude|wgs84lon/.test(w) && !/longitudinal/.test(w); };
const GOOD = /position|location|ccp|gnss|gps|geo|current|ownpos|carpos|vehiclepos|matched|ego|coordinate/i;
const BAD = /dest|poi|route|maneuver|manoeuvre|search|address|favo|history|weather|charg|parking|traffic|geofence|lastmile|waypoint|stopover|contact|photo|picture|sms|calendar|tile|map(?!matched)|camera|event|incident|hazard|warning|share|send|import|export|request|set[A-Z]/i;

function leaves(db, ref, path, depth, out, seen) {
    const types = db.datatypes || {};
    const d = typeof ref === 'string' ? types[ref] : null;
    if (!d || depth > 6 || seen[ref + '@' + depth]) return;
    seen[ref + '@' + depth] = 1;
    if (d.type === 'struct' || d.type === 'union') {
        let members = [], dd = d, guard = 0;
        while (dd && guard++ < 8) { members = (dd.members || []).concat(members); dd = dd.extends ? types[dd.extends] : null; }
        members.forEach((m) => { if (!m) return; out.push([path, m.name || '']); leaves(db, m.dataRef, path + '.' + (m.name || ''), depth + 1, out, seen); });
    } else if (d.type === 'typedef') leaves(db, d.dataRef || d.baseType, path, depth, out, seen);
    else if (d.type === 'array') leaves(db, d.elementDataRef, path + '[]', depth + 1, out, seen);
}
function refsIn(e) {
    const f = [];
    (function walk(x, d) {
        if (d > 5 || !x || typeof x !== 'object') return;
        Object.keys(x).forEach((k) => { if ((k === 'dataRef' || k === 'elementDataRef') && typeof x[k] === 'string') f.push(x[k]); else walk(x[k], d + 1); });
    })(e, 0);
    return f;
}
function entries(part) {
    if (Array.isArray(part)) return part.filter((e) => e && e.name).map((e) => [e.name, e]);
    return part && typeof part === 'object' ? Object.keys(part).map((k) => [k, part[k]]) : [];
}
const hasId = (x) => !!x && typeof x === 'object' && x.id !== 0;

function scan(db) {
    const found = [], ids = db.instanceIDs || {};
    Object.keys(db.interfaces || {}).forEach((iface) => {
        const d = db.interfaces[iface];
        const inst = ids[iface] && typeof ids[iface] === 'object' ? Object.keys(ids[iface]).filter((k) => ids[iface][k] !== null) : [];
        [['field', 'fields'], ['event', 'events'], ['event', 'broadcasts']].forEach((kp) => entries(d[kp[1]]).forEach((ne) => {
            const name = ne[0], e = ne[1], lv = [];
            refsIn(e).forEach((r) => leaves(db, r, '', 0, lv, {}));
            const par = {};
            lv.forEach((x) => { const s = par[x[0]] = par[x[0]] || [false, false]; s[0] = s[0] || isLat(x[1]); s[1] = s[1] || isLon(x[1]); });
            const pairs = Object.keys(par).filter((p) => par[p][0] && par[p][1]);
            if (!pairs.length) return;
            const path = pairs.sort((a, b) => a.length - b.length)[0];
            const text = iface + '.' + name + ' ' + path;
            let score = 50;
            if (GOOD.test(text)) score += 30;
            if (/current|ccp|ownpos|carpos|vehicleposition|egopos|matched/i.test(text)) score += 25;
            if (BAD.test(name) || BAD.test(path) || BAD.test(iface.split('.').pop())) score -= 120;
            if (/navigation|positioning|gnss|location/i.test(iface)) score += 15;
            if (path.indexOf('[]') >= 0) score -= 60;
            score -= 3 * (path.split('.').length - 1);
            let mode = 'event';
            if (kp[0] === 'field') {
                const n = hasId(e.notifier), g = hasId(e.getter);
                if (!n && !g) return;
                score += n ? 20 : 5;
                mode = (g ? 'r' : '') + (n ? 's' : '');
            } else score += 10;
            found.push({ score, iface, name, mode, path: path || '.', inst: inst.join(',') || '(no instance)' });
        }));
    });
    return found.sort((a, b) => b.score - a.score);
}

function main() {
    let db;
    try { db = JSON.parse(fs.readFileSync(CATALOG, 'utf8')); } catch (e) { console.log('cannot read ' + CATALOG + ': ' + e.message); process.exit(1); }
    const filter = process.argv[2];
    if (filter) {
        Object.keys(db.interfaces || {}).filter((i) => i.toLowerCase().indexOf(filter.toLowerCase()) >= 0).forEach((i) => {
            console.log(i + '  instances: ' + JSON.stringify((db.instanceIDs || {})[i] || null));
            entries(db.interfaces[i].fields).forEach((f) => console.log('   field ' + f[0] + (hasId(f[1].getter) ? ' get' : '') + (hasId(f[1].notifier) ? ' notify' : '') + '  ' + (f[1].dataRef || '')));
            entries(db.interfaces[i].events || db.interfaces[i].broadcasts).forEach((f) => console.log('   event ' + f[0]));
        });
        return;
    }
    const found = scan(db);
    console.log(Object.keys(db.interfaces || {}).length + ' interfaces in ' + CATALOG + '; ' + found.length + ' fields / events carry a latitude + longitude:');
    found.slice(0, 40).forEach((c) => console.log(('    ' + c.score).slice(-4) + '  ' + c.iface + '.' + c.name + '  [' + c.mode + '] at ' + c.path + '  inst ' + c.inst));
    if (!found.length) console.log('none: run with a filter, e.g.  node - posit   or   node - navi');
}

main();
