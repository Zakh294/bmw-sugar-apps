'use strict';
/**
 * status.js - what the page says and what Open asks the service for (no HMI here: unit-tested on a PC).
 */
const { displaySize } = require('./overlay');

// settings that change the virtual display or the stream: DeX starts again with them
const STREAM_KEYS = ['dpi', 'fps', 'bitrate', 'conn'];

function startCmd(settings) {
    const d = displaySize();
    return {
        cmd: 'start', w: d.w, h: d.h, dpi: Number(settings.get('dpi')) || 160, fps: Number(settings.get('fps')) || 30,
        bitrate: (Number(settings.get('bitrate')) || 8) * 1000000, tcp: settings.get('conn') === 'usbwifi' ? 'auto' : '',
    };
}

/** The status line for the page. */
function statusText(st, ctx) {
    const tr = ctx.tr;
    let s;
    switch (st.state) {
    case 'nosvc': s = tr('nosvc'); break;
    case 'idle': s = st.msg === 'key forgotten' ? tr('key_forgotten') : tr('idle'); break;
    case 'searching': s = tr(ctx.wifi ? 'searching_wifi' : 'searching_usb'); break;
    case 'connecting': s = tr('connecting', { msg: st.msg || '' }); break;
    case 'auth': s = tr('auth'); break;
    case 'streaming':
        s = st.w ? tr('streaming', {
            device: st.device || '?', size: st.w + '×' + st.h, fps: ctx.fps ? tr('fps', { n: Math.round(ctx.fps) }) : '…',
            via: tr(st.via === 'tcp' ? 'via_tcp' : 'via_usb'),
        }) : tr('streaming_wait', { device: st.device || '?' });
        break;
    case 'error': s = tr('error', { msg: st.msg || '?' }); break;
    default: s = st.state || '…';
    }
    if (ctx.moving) s += tr('moving');
    if (ctx.problem) s += tr(ctx.problem);
    return s;
}

module.exports = { statusText, startCmd, STREAM_KEYS };
