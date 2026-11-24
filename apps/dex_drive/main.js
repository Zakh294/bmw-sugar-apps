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
const { Pad, TouchMode, TOUCH_MODE } = require('./pad');
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
            mouse: (a, b, nx, ny) => ctl.send({ cmd: 'mouse', a, b, x: nx, y: ny }),
            key: (code) => ctl.send({ cmd: 'key', code }),
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
                problem: st.state === 'streaming' ? ov.problem() : null, hidden: st.state === 'streaming' && !ov.shown ? ov.why : null,
                renderError: st.state === 'streaming' ? ov.lastError : null,
                noController: st.state === 'streaming' && settings.get('knob') !== false && !ov.controllerReachable() && ov.ccuSource !== 'signals',
                ccuSignals: st.state === 'streaming' && ov.ccuSource === 'signals',
                noPad: st.state === 'streaming' && padOn() && padShownAt && Date.now() - padShownAt > 15000 && !padSamples });
            if (text !== lastText) {
                lastText = text;
                ui.text('STATUS', text);
            }
        }

        Object.keys(BUTTONS).forEach((b) => ui.text(b, tr(BUTTONS[b])));
        settings.onChange((k) => {
            if (k === 'lang') { Object.keys(BUTTONS).forEach((b) => ui.text(b, tr(BUTTONS[b]))); lastText = null; }
            if (k === 'knob') ov.setKnob(settings.get('knob') !== false);
            if (k === 'touchpad' && touchMode) touchMode.want(padOn());
            // DeX running or on its way: start it again with the new display
            if (STREAM_KEYS.indexOf(k) >= 0 && st.state !== 'idle' && st.state !== 'nosvc') ctl.send(startCmd(settings));
            refresh();
        });

        ui.onClick('BTN_OPEN', () => {
            if (ov.shown) return;
            // a press on the page: it is on screen, whatever the HMI said last
            mainVisible = true;
            mainFocus = true;
            wantShow = true;
            if (st.state !== 'streaming') ctl.send(startCmd(settings));
            refresh();
        });
        // without the controller gate, a press on the knob also presses the (hidden) page button under the picture:
        // while DeX shows, those do nothing
        const underPicture = (b) => { if (ov.shown) { log.info(b + ' pressed under the picture: ignored'); return true; } return false; };
        ui.onClick('BTN_STOP', () => {
            if (underPicture('BTN_STOP')) return;
            wantShow = false; phoneOffSent = false; ctl.send({ cmd: 'stop' }); refresh();
        });
        ui.onClick('BTN_PHONE', () => { if (!underPicture('BTN_PHONE')) ctl.send({ cmd: 'phone-screen', on: false }); });
        ui.onClick('BTN_FORGET', () => {
            if (underPicture('BTN_FORGET')) return;
            wantShow = false; ctl.send({ cmd: 'forget-key' }); refresh();
        });

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
            if (s.state === 'streaming' && was !== 'streaming') ov.videoReady();
            if (s.state === 'streaming' && was !== 'streaming') {
                log.info('DeX on ' + (s.device || '?') + ' over ' + (s.via || '?'));
                if (settings.get('phoneOff') && !phoneOffSent) { phoneOffSent = true; setTimeout(() => ctl.send({ cmd: 'phone-screen', on: false }), 1500); }
            }
            if (s.state !== 'streaming') { fps = 0; if (was === 'streaming') phoneOffSent = false; }
            refresh();
        });
        ctl.on('stats', (s) => { if (typeof s.fps === 'number') fps = s.fps; refresh(); });
        ctl.on('decoder-error', (s) => log.warn('decoder: ' + s.msg));
        // the decoder made (or remade, at a new size) the video file: the renderer must open it again
        ctl.on('frames', (s) => { log.info('video file ' + s.w + 'x' + s.h); ov.videoReady(); refresh(); });
        ctl.on('missing', () => { if (st.state !== 'nosvc') { st = { state: 'nosvc' }; refresh(); } });
        ctl.on('down', () => { st = { state: 'nosvc' }; refresh(); });
        ctl.on('up', () => ctl.send({ cmd: 'status' }));

        /* ---------- the controller's touchpad: DeX's pointer, taps click, two fingers scroll (pad.js) ---------- */
        const padOn = () => ov.shown && settings.get('touchpad') !== false;
        let padSamples = 0, padShownAt = 0;    // touchpad samples seen, and since when the picture shows (no signal: say so)
        const pad = new Pad({ move: (dx, dy) => ov.padMove(dx, dy), click: (b) => ov.padClick(b), scroll: (n) => ov.padScroll(n) });
        const touchMode = ctx.signals && ctx.signals.proxy && ctx.signals.set ? new TouchMode(ctx.signals, log) : null;
        if (ctx.signals && ctx.signals.watch) {
            Promise.resolve(ctx.signals.watch('de.bmw.infotainment.ControllerElements', '1', {
                ZBETouchFrontSide: (v) => {
                    padSamples++;
                    if (!padOn()) { pad.reset(); return; }
                    if (v && v.statusSystemModeFrontSide !== TOUCH_MODE && touchMode) touchMode.lost();
                    pad.feed(v, Date.now());
                },
            }, log)).catch((e) => log.warn('touchpad: ' + e));
        }
        // the knob without the controller gate: the car's own controller signal (the iDrive menu gets it too)
        if (ctx.signals && ctx.signals.watch) {
            Promise.resolve(ctx.signals.watch('de.bmw.infotainment.controlelements.FrontCCU', '1', {
                statusRotaryEncoderState: (v) => ov.signalCcu(v),
            }, log)).catch((e) => log.warn('controller signal: ' + e));
        }
        if (touchMode) {
            setInterval(() => {
                if (padOn() && !padShownAt) padShownAt = Date.now();
                if (!padOn()) padShownAt = 0;
                touchMode.want(padOn());
            }, 500);
            if (ctx.app && ctx.app.on) ctx.app.on('shutdown', () => touchMode.want(false));
        }

        ov.start();
        ctl.connect();
        // parked / driving changes, the renderer coming and going
        setInterval(refresh, 1000);
        refresh();
    },
});
