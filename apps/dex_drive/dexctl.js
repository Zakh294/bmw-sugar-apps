'use strict';
/**
 * dexctl.js - the app's line to the dex-drive-d service (/run/dex-drive-d/ctl.sock, JSON lines; the service's
 * main.go lists the messages). Connects again every 2 s while the service is not there.
 *
 *   const d = new DexCtl(log);
 *   d.on('status', (st) => ...); d.on('stats', (s) => ...); d.on('up', ...); d.on('down', ...);
 *   d.connect(); d.send({ cmd: 'start', ... });
 */
const net = require('net');
const EventEmitter = require('events');

const SOCKET = '/run/dex-drive-d/ctl.sock';

class DexCtl extends EventEmitter {
    constructor(log, socket) {
        super();
        this.log = log || console;
        this.path = socket || process.env.DEX_DRIVE_CTL || SOCKET;
        this.sock = null;
        this.up = false;
        this.buf = '';
        this.closed = false;
        this.timer = null;
        this.lastErr = null;
        this.ping = null;
    }

    connect() {
        if (this.closed || this.sock) return this;
        const s = net.createConnection(this.path);
        this.sock = s;
        s.setEncoding('utf8');
        s.on('connect', () => {
            this.up = true;
            this.lastErr = null;
            this.log.info('dex-drive-d: connected');
            this.emit('up');
            this.ping = setInterval(() => this.send({ cmd: 'ping' }), 5000);
        });
        s.on('data', (d) => {
            this.buf += d;
            let i;
            while ((i = this.buf.indexOf('\n')) >= 0) {
                const line = this.buf.slice(0, i);
                this.buf = this.buf.slice(i + 1);
                let m = null;
                try { m = JSON.parse(line); } catch (e) { continue; }
                if (m && m.ev) this.emit(m.ev, m);
            }
        });
        s.on('error', (e) => {
            if (this.lastErr !== e.code) { this.lastErr = e.code; this.log.warn('dex-drive-d: ' + e.message); }
        });
        s.on('close', () => {
            const was = this.up;
            this.up = false;
            this.sock = null;
            this.buf = '';
            if (this.ping) { clearInterval(this.ping); this.ping = null; }
            if (was) this.emit('down');
            else this.emit('missing', this.lastErr);
            if (!this.closed) this.timer = setTimeout(() => { this.timer = null; this.connect(); }, 2000);
        });
        return this;
    }

    send(obj) {
        if (!this.up || !this.sock) return false;
        return this.sock.write(JSON.stringify(obj) + '\n');
    }

    close() {
        this.closed = true;
        if (this.timer) clearTimeout(this.timer);
        if (this.ping) clearInterval(this.ping);
        if (this.sock) this.sock.destroy();
    }
}

module.exports = { DexCtl, SOCKET };
