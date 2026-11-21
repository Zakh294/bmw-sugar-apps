'use strict';
/**
 * find_sound.js - run on the head unit over SSH to see what could play a short chime: every SOME/IP interface whose
 * name, methods, fields or events mention a gong, chime, tone, beep, sound, announcement or speech. Reads the catalog
 * only (no bus traffic, nothing written). Pair it with the app log's "audio: sources …" / "audio: sinks …" lines.
 *
 * From Windows (cmd), in the repository folder:
 *   ssh -i %USERPROFILE%\.ssh\mgu_root_key -o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa root@172.16.222.97 "node -" < tools\speedcam_ua\find_sound.js
 * Plain Node 8.
 */
const fs = require('fs');
const CATALOG = process.env.MGU_SOMEIP_CATALOG || '/etc/oap/someip/someip-interfaces.json';
const WORDS = /gong|chime|tone|beep|sound|acoustic|announce|prompt|speech|tts|voice|audio|jingle|signal[_ ]?tone|warning[_ ]?sound|notification/i;

function names(part) {
    if (Array.isArray(part)) return part.filter((e) => e && e.name).map((e) => e.name);
    return part && typeof part === 'object' ? Object.keys(part) : [];
}

function main() {
    let db;
    try { db = JSON.parse(fs.readFileSync(CATALOG, 'utf8')); } catch (e) { console.log('cannot read ' + CATALOG + ': ' + e.message); process.exit(1); }
    const ifs = db.interfaces || {}, ids = db.instanceIDs || {};
    let n = 0;
    Object.keys(ifs).sort().forEach((iface) => {
        const d = ifs[iface] || {};
        const members = [['method', names(d.methods)], ['field', names(d.fields)], ['event', names(d.events).concat(names(d.broadcasts))]];
        const hits = [];
        members.forEach((m) => m[1].forEach((x) => { if (WORDS.test(x)) hits.push(m[0] + ' ' + x); }));
        if (!WORDS.test(iface) && !hits.length) return;
        n++;
        const inst = ids[iface] && typeof ids[iface] === 'object' ? Object.keys(ids[iface]).join(',') : '-';
        console.log(iface + '  (instances ' + inst + ')');
        (hits.length ? hits : members.reduce((a, m) => a.concat(m[1].slice(0, 12).map((x) => m[0] + ' ' + x)), [])).slice(0, 25)
            .forEach((h) => console.log('    ' + h));
    });
    console.log(n + ' interfaces of ' + Object.keys(ifs).length + ' in ' + CATALOG);
}

main();
