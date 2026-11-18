'use strict';
/**
 * translit.js - Ukrainian to Latin letters (the official 2010 table of the Cabinet of Ministers, resolution 55),
 * so place names show in the kit's Latin fonts on the center screen. Plain Node 8.
 */
const MAP = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'h', 'ґ': 'g', 'д': 'd', 'е': 'e', 'є': 'ie', 'ж': 'zh', 'з': 'z', 'и': 'y',
    'і': 'i', 'ї': 'i', 'й': 'i', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's',
    'т': 't', 'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ь': '', 'ю': 'iu',
    'я': 'ia', '\'': '', '’': '', 'ʼ': '', 'ы': 'y', 'э': 'e', 'ё': 'io', 'ъ': '',
};
// at the start of a word
const FIRST = { 'є': 'ye', 'ї': 'yi', 'й': 'y', 'ю': 'yu', 'я': 'ya' };

function translit(s) {
    s = String(s || '');
    let out = '', prevLetter = false;
    for (let i = 0; i < s.length; i++) {
        const ch = s[i], lo = ch.toLowerCase(), upper = ch !== lo;
        let t;
        if (lo === 'г' && i > 0 && s[i - 1].toLowerCase() === 'з') t = 'gh';
        else if (!prevLetter && FIRST[lo]) t = FIRST[lo];
        else if (MAP[lo] !== undefined) t = MAP[lo];
        else t = ch;
        if (upper && t) t = t[0].toUpperCase() + t.slice(1);
        out += t;
        prevLetter = /[Ѐ-ӿA-Za-z’ʼ']/.test(ch);
    }
    // anything still outside printable ASCII (dashes, quotes) as plain ASCII
    return out.replace(/[–—]/g, '-').replace(/[«»“”„]/g, '"').replace(/[^\x20-\x7e]/g, '');
}

module.exports = { translit };
