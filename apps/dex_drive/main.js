'use strict';
/**
 * DeX Drive - Samsung DeX (One UI 8) on the BMW iDrive 7 centre screen.
 *
 * The dex-drive-d service (native/dex_drive, a Store tool) does the work: ADB to the phone over USB or Wi-Fi,
 * scrcpy-server on the phone with a virtual display that DeX takes, the H.264 video decoded on the unit's GPU into
 * mgu-render's video file. This app is the page and the picture: its page (DeX Drive's menu in the HMI) starts and
 * stops DeX and shows how it goes; while DeX runs and the page is open, the picture covers the screen (overlay.js)
 * and the touches go to the phone. Parked only, unless switched off in the settings.
 * Plain Node 8 (the car's 8.16.2).
 */
const mgu = require('./kit/mgu');
const parkedWatch = require('./kit/parked');
const { DexCtl } = require('./dexctl');
const { Overlay } = require('./overlay');
const lang = require('./lang');
const { statusText, startCmd, STREAM_KEYS } = require('./status');

const BUTTONS = { BTN_OPEN: 'btn_open', BTN_STOP: 'btn_stop', BTN_PHONE: 'btn_phone', BTN_FORGET: 'btn_forget' };

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;
        const tr = (k, a) => lang.t(settings.get('lang'), k, a);
        const parked = parkedWatch.watch(ctx, log);
        const ctl = new DexCtl(log);
        let st = { state: 'nosvc' };
        let fps = 0;
        let wantShow = false;          // the picture over the page (Open pressed, or the page opened while DeX runs)
        let mainVisible = ui.isVisible('MAIN');
        let mainFocus = true;
        let phoneOffSent = false;
        let lastText = null;

        const ov = new Overlay(log, {
            touch: (a, id, nx, ny) => ctl.send({ cmd: 'touch', a, id, x: nx, y: ny }),
            scroll: (nx, ny, dy) => ctl.send({ cmd: 'scroll', x: nx, y: ny, dy }),
            menu: () => { wantShow = false; refresh(); },
            closed: () => { wantShow = false; refresh(); },
        });
        ov.setKnob(settings.get('knob') !== false);

        const moving = () => settings.get('parkedOnly') !== false && parked.moving();
        function refresh() {
            const show = wantShow && mainVisible && mainFocus && st.state === 'streaming' && st.w > 0 && !moving();
            ov.want(show);
            const text = statusText(st, { tr, wifi: settings.get('conn') === 'usbwifi', fps, moving: moving() && st.state === 'streaming',
                problem: st.state === 'streaming' ? ov.problem() : null });
            if (text !== lastText) {
                lastText = text;
                ui.text('STATUS', text);
            }
        }

        Object.keys(BUTTONS).forEach((b) => ui.text(b, tr(BUTTONS[b])));
        settings.onChange((k) => {
            if (k === 'lang') { Object.keys(BUTTONS).forEach((b) => ui.text(b, tr(BUTTONS[b]))); lastText = null; }
            if (k === 'knob') ov.setKnob(settings.get('knob') !== false);
            // DeX running or on its way: start it again with the new display
            if (STREAM_KEYS.indexOf(k) >= 0 && st.state !== 'idle' && st.state !== 'nosvc') ctl.send(startCmd(settings));
            refresh();
        });

        ui.onClick('BTN_OPEN', () => {
            // a press on the page: it is on screen, whatever the HMI said last
            mainVisible = true;
            mainFocus = true;
            wantShow = true;
            if (st.state !== 'streaming') ctl.send(startCmd(settings));
            refresh();
        });
        ui.onClick('BTN_STOP', () => { wantShow = false; phoneOffSent = false; ctl.send({ cmd: 'stop' }); refresh(); });
        ui.onClick('BTN_PHONE', () => ctl.send({ cmd: 'phone-screen', on: false }));
        ui.onClick('BTN_FORGET', () => { wantShow = false; ctl.send({ cmd: 'forget-key' }); refresh(); });

        ui.onVisible((name, v) => {
            if (name !== 'MAIN') return;
            // back on the page (the tile, or back from elsewhere) while DeX runs: straight to the picture
            if (v && !mainVisible && st.state === 'streaming') wantShow = true;
            mainVisible = v;
            refresh();
        });
        if (ui.onFocus) ui.onFocus((name, on) => { if (name === 'MAIN') { mainFocus = on; refresh(); } });

        ctl.on('status', (s) => {
            const was = st.state;
            st = s;
            if (s.w && s.h) ov.setVideo(s.w, s.h);
            if (s.state === 'streaming' && was !== 'streaming') {
                log.info('DeX on ' + (s.device || '?') + ' over ' + (s.via || '?'));
                if (settings.get('phoneOff') && !phoneOffSent) { phoneOffSent = true; setTimeout(() => ctl.send({ cmd: 'phone-screen', on: false }), 1500); }
            }
            if (s.state !== 'streaming') { fps = 0; if (was === 'streaming') phoneOffSent = false; }
            refresh();
        });
        ctl.on('stats', (s) => { if (typeof s.fps === 'number') fps = s.fps; refresh(); });
        ctl.on('decoder-error', (s) => log.warn('decoder: ' + s.msg));
        ctl.on('missing', () => { if (st.state !== 'nosvc') { st = { state: 'nosvc' }; refresh(); } });
        ctl.on('down', () => { st = { state: 'nosvc' }; refresh(); });
        ctl.on('up', () => ctl.send({ cmd: 'status' }));

        ov.start();
        ctl.connect();
        // parked / driving changes, the renderer coming and going
        setInterval(refresh, 1000);
        refresh();
    },
});
