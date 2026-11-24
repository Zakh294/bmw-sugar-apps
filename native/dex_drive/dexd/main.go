// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Zakhar Vityk
//
// dex-drive-d - the car side of DeX Drive: Samsung DeX (One UI 8) on the BMW iDrive 7 centre screen.
//
// Runs as root (a tool installed by mgu-deploy). Idle until the DeX Drive app asks over /run/dex-drive-d/ctl.sock;
// then finds the phone (USB first, else ADB over Wi-Fi at the address the app gives), connects with the unit's own
// ADB key, starts scrcpy-server on it with a new virtual display (DeX), decodes the video with dexdec on the GPU
// into /dev/shm/mgu-video-dexdrive, which the app shows through mgu-render, and passes the app's touches back.
// Ends the session when the app says stop, or 15 s after the app is gone.
//
// ctl.sock (root:tm_oap_app 0660), JSON lines.
//
//	app -> daemon: {"cmd":"start","w":1832,"h":720,"dpi":160,"fps":30,"bitrate":8000000,"tcp":"192.168.1.5:5555"}
//	               {"cmd":"stop"} {"cmd":"touch","a":"down|move|up|cancel","id":0,"x":0.5,"y":0.5}
//	               {"cmd":"mouse","a":"hover|down|move|up","b":"left|right","x":0.5,"y":0.5}
//	               {"cmd":"scroll","x":0.5,"y":0.5,"dy":-1} {"cmd":"key","code":4} {"cmd":"text","text":"..."}
//	               {"cmd":"phone-screen","on":false} {"cmd":"status"} {"cmd":"forget-key"}
//	daemon -> app: {"ev":"status","state":"idle|searching|auth|connecting|streaming|error","msg":"...","device":"...",
//	               "via":"usb|tcp","w":..,"h":..,"video":"/dev/shm/mgu-video-dexdrive","version":"..."}
//	               {"ev":"stats","fps":..} {"ev":"video","w":..,"h":..}
package main

import (
	"errors"
	"flag"
	"fmt"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// Version is the tool's version (component.json).
const Version = "0.2.4"

// Logger writes to a file (kept under 1 MB, one old copy) and to stderr (the journal).
type Logger struct {
	mu   sync.Mutex
	path string
	f    *os.File
	n    int64
}

func NewLogger(path string) *Logger {
	l := &Logger{path: path}
	l.open()
	return l
}

func (l *Logger) open() {
	if l.path == "" {
		return
	}
	os.MkdirAll(filepath.Dir(l.path), 0o700)
	f, err := os.OpenFile(l.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err == nil {
		l.f = f
		if st, err := f.Stat(); err == nil {
			l.n = st.Size()
		}
	}
}

func (l *Logger) Printf(format string, a ...interface{}) {
	line := time.Now().Format("2006-01-02 15:04:05.000") + " " + fmt.Sprintf(format, a...) + "\n"
	l.mu.Lock()
	defer l.mu.Unlock()
	os.Stderr.WriteString(line)
	if l.f == nil {
		return
	}
	if l.n > 1<<20 {
		l.f.Close()
		os.Rename(l.path, l.path+".1")
		l.open()
		l.n = 0
		if l.f == nil {
			return
		}
	}
	k, _ := l.f.WriteString(line)
	l.n += int64(k)
}

type config struct {
	sock        string
	group       int
	state       string
	server      string
	decoder     string
	video       string
	sysUsb      string
	keyName     string
	idleAfter   time.Duration
	arp         string
	wifiOverTCP bool                           // tests: open port 5555 on a phone met over TCP too (in the car only over USB)
	nets        func() ([]net.IPNet, []string) // the unit's own networks (tests: fixed)
}

func main() {
	cfg := config{}
	self, _ := os.Executable()
	dir := filepath.Dir(self)
	flag.StringVar(&cfg.sock, "socket", "/run/dex-drive-d/ctl.sock", "control socket")
	flag.IntVar(&cfg.group, "group", 12202, "group of the control socket (the apps' tm_oap_app)")
	flag.StringVar(&cfg.state, "state", "/var/opt/dex-drive-data", "folder for the ADB key and logs (kept across updates)")
	flag.StringVar(&cfg.server, "server", filepath.Join(dir, "scrcpy-server"), "scrcpy-server "+scrcpyVersion)
	flag.StringVar(&cfg.decoder, "decoder", filepath.Join(dir, "dexdec"), "the decoder")
	flag.StringVar(&cfg.video, "video", "/dev/shm/mgu-video-dexdrive", "mgu-render video file")
	flag.StringVar(&cfg.sysUsb, "sysfs", "/sys/bus/usb/devices", "sysfs USB devices")
	flag.StringVar(&cfg.keyName, "key-name", "BMW-iDrive@dex-drive", "the name the phone shows for this unit's key")
	flag.DurationVar(&cfg.idleAfter, "idle-after", 15*time.Second, "stop a session this long after the app is gone")
	flag.StringVar(&cfg.arp, "arp", "/proc/net/arp", "the kernel's neighbour table (phones on the car's Wi-Fi)")
	version := flag.Bool("version", false, "print the version")
	flag.Parse()
	if *version {
		fmt.Println(Version)
		return
	}
	log := NewLogger(filepath.Join(cfg.state, "dexd.log"))
	log.Printf("dex-drive-d %s starting (server %s, decoder %s)", Version, cfg.server, cfg.decoder)
	d := newDaemon(cfg, log)
	if err := d.listen(); err != nil {
		log.Printf("control socket: %v", err)
		os.Exit(1)
	}
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGTERM, syscall.SIGINT)
	<-sig
	log.Printf("stopping")
	d.stopSession()
	time.Sleep(300 * time.Millisecond)
	os.Remove(cfg.sock)
}

// ---------------------------------------------------------------------------------------------------------------

type startReq struct {
	W, H, DPI, FPS, Bitrate int
	TCP                     string
}

type daemon struct {
	cfg      config
	log      *Logger
	mu       sync.Mutex
	clients  map[*client]bool
	status   map[string]interface{}
	want     *startReq // nil: no session wanted
	gen      int       // bumps when want changes
	sess     *Session
	lastApp  time.Time
	wake     chan struct{}
	devName  string // the phone, for the status
	via      string
	tcpipAt  map[string]time.Time // phone -> when we last opened its port 5555 (no loop if it does not stick)
	lastErr  string               // the last error, kept on the page while it tries again ("HH:MM:SS msg")
	lastScan time.Time            // the last Wi-Fi subnet scan for the phone
	wifi     string               // what the car found of the phone's port 5555 while on the cable (wifiCheck), "" = nothing yet
	wifiAt   string               // ...and where
}

func newDaemon(cfg config, log *Logger) *daemon {
	if cfg.nets == nil {
		cfg.nets = ownNets
	}
	d := &daemon{cfg: cfg, log: log, clients: map[*client]bool{}, wake: make(chan struct{}, 1), tcpipAt: map[string]time.Time{},
		status: map[string]interface{}{"ev": "status", "state": "idle", "version": Version, "video": cfg.video}}
	go d.run()
	go d.idleWatch()
	return d
}

func (d *daemon) kick() {
	select {
	case d.wake <- struct{}{}:
	default:
	}
}

func (d *daemon) setStatus(state, msg string, extra map[string]interface{}) {
	d.mu.Lock()
	st := map[string]interface{}{"ev": "status", "state": state, "msg": msg, "version": Version, "video": d.cfg.video}
	if state != "idle" && state != "searching" {
		if d.devName != "" {
			st["device"] = d.devName
		}
		if d.via != "" {
			st["via"] = d.via
		}
		for _, k := range []string{"w", "h", "dpi", "maxfps", "mbps"} {
			if v, ok := d.status[k]; ok && state == "streaming" {
				st[k] = v
			}
		}
	}
	for k, v := range extra {
		st[k] = v
	}
	if d.wifi != "" && state != "idle" {
		st["wifi"] = d.wifi
		st["wifi_at"] = d.wifiAt
	}
	if d.lastErr != "" && state != "streaming" && state != "error" {
		st["last"] = d.lastErr
	}
	same := d.status["state"] == st["state"] && d.status["msg"] == st["msg"] && len(extra) == 0
	d.status = st
	d.mu.Unlock()
	if !same {
		d.log.Printf("status: %s %s", state, msg)
	}
	d.broadcast(st)
}

func (d *daemon) broadcast(ev map[string]interface{}) {
	d.mu.Lock()
	cs := make([]*client, 0, len(d.clients))
	for c := range d.clients {
		cs = append(cs, c)
	}
	d.mu.Unlock()
	for _, c := range cs {
		c.send(ev)
	}
}

func (d *daemon) stopSession() {
	d.mu.Lock()
	d.want = nil
	d.lastErr = ""
	d.gen++
	s := d.sess
	d.mu.Unlock()
	if s != nil {
		s.Stop()
	}
	d.kick()
}

// idleWatch: no app for idleAfter -> no session.
func (d *daemon) idleWatch() {
	for range time.Tick(time.Second) {
		d.mu.Lock()
		gone := len(d.clients) == 0 && d.want != nil && time.Since(d.lastApp) > d.cfg.idleAfter
		d.mu.Unlock()
		if gone {
			d.log.Printf("the app is gone: stopping the session")
			d.stopSession()
			d.setStatus("idle", "", nil)
		}
	}
}

func (d *daemon) key() (*AdbKey, error) {
	k, made, err := LoadOrCreateKey(filepath.Join(d.cfg.state, "adbkey"), d.cfg.keyName)
	if err == nil && made {
		d.log.Printf("made a new ADB key")
	}
	return k, err
}

// run keeps a session going while one is wanted: find the phone, connect, stream; again after a loss.
func (d *daemon) run() {
	for {
		d.mu.Lock()
		want, gen := d.want, d.gen
		d.mu.Unlock()
		if want == nil {
			<-d.wake
			continue
		}
		err := d.once(*want, gen)
		d.mu.Lock()
		still := d.gen == gen && d.want != nil
		d.mu.Unlock()
		if !still {
			continue
		}
		if err == errReconnect {
			// the phone's adbd restarts to listen on port 5555 too: its USB comes back in a moment
			time.Sleep(1500 * time.Millisecond)
			continue
		}
		if err != nil {
			d.mu.Lock()
			d.lastErr = time.Now().Format("15:04:05 MST") + " " + err.Error()
			d.mu.Unlock()
			d.setStatus("error", err.Error(), nil)
		}
		select {
		case <-d.wake:
		case <-time.After(3 * time.Second):
		}
	}
}

func (d *daemon) wanted(gen int) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.gen == gen && d.want != nil
}

func (d *daemon) once(want startReq, gen int) error {
	jar, err := os.ReadFile(d.cfg.server)
	if err != nil {
		return fmt.Errorf("scrcpy-server missing: %v", err)
	}
	key, err := d.key()
	if err != nil {
		return fmt.Errorf("ADB key: %v", err)
	}
	var t Transport
	via := ""
	for t == nil {
		if !d.wanted(gen) {
			return nil
		}
		if devs := FindUsbAdb(d.cfg.sysUsb); len(devs) > 0 {
			u := devs[0]
			d.mu.Lock()
			d.devName = strings.TrimSpace(u.Product)
			d.mu.Unlock()
			if t, err = OpenUsb(u); err != nil {
				d.setStatus("error", "USB: "+err.Error(), nil)
				t = nil
			} else {
				via = "usb"
				break
			}
		}
		if want.TCP != "" {
			files := []string{filepath.Join(d.cfg.state, "phone-ip"), filepath.Join(d.cfg.state, "phone-ip.auto")}
			c, addr := dialPhone(want.TCP, files, d.cfg.arp)
			if c == nil && want.TCP == "auto" && time.Since(d.lastScan) > 15*time.Second {
				d.lastScan = time.Now()
				addrs, names := d.cfg.nets()
				targets := scanTargets(addrs, names, "5555")
				if len(targets) > 0 {
					d.log.Printf("wifi adb: looking for the phone on %d addresses", len(targets))
					c, addr = dialAny(targets, 400*time.Millisecond)
				}
			}
			if c != nil {
				d.log.Printf("wifi adb: the phone answers at %s", addr)
				t = &streamTransport{rw: c, name: "tcp " + addr}
				via = "tcp"
				break
			}
		}
		where := map[string]interface{}{}
		if want.TCP == "auto" {
			if b, err := os.ReadFile(filepath.Join(d.cfg.state, "phone-ip.auto")); err == nil {
				where["phone"] = strings.Join(strings.Fields(string(b)), ", ")
			}
			addrs, names := d.cfg.nets()
			var own []string
			for i, a := range addrs {
				if ip := a.IP.To4(); ip != nil && !carNet(ip, names[i]) {
					own = append(own, a.String())
				}
			}
			if len(own) > 0 {
				where["nets"] = strings.Join(own, ", ")
			} else {
				where["nets"] = "no Wi-Fi"
			}
		}
		msg := "Connect the phone by USB (USB debugging on)"
		if want.TCP == "auto" {
			msg += ", or over Wi-Fi with ADB on port 5555 (adb tcpip 5555)"
		} else if want.TCP != "" {
			msg += " or bring it to " + want.TCP
		}
		d.setStatus("searching", msg, where)
		select {
		case <-d.wake:
		case <-time.After(2 * time.Second):
		}
	}
	d.log.Printf("phone on %s", t.Name())
	d.setStatus("connecting", "Connecting over "+via, map[string]interface{}{"via": via})
	conn, err := Handshake(t, key, 60*time.Second, func() {
		d.setStatus("auth", "Allow USB debugging on the phone (tick \"Always allow\")", map[string]interface{}{"via": via})
	})
	if err != nil {
		t.Close()
		return err
	}
	defer conn.Close()
	model := conn.Model()
	d.mu.Lock()
	d.devName = model
	d.via = via
	d.mu.Unlock()
	d.log.Printf("connected: %s (%s)", model, conn.Banner)
	if !d.wanted(gen) {
		return nil
	}
	if sdk, err := conn.Shell("getprop ro.build.version.sdk", 5*time.Second); err == nil {
		if n, _ := strconv.Atoi(strings.TrimSpace(sdk)); n > 0 && n < 36 {
			return fmt.Errorf("%s runs Android API %d: DeX on a virtual display needs One UI 8 (Android 16)", model, n)
		}
	}
	if want.TCP == "auto" && (via == "usb" || d.cfg.wifiOverTCP) {
		ips := d.rememberWifi(conn, model)
		if d.openWifiPort(conn, model) {
			return errReconnect
		}
		if via == "usb" {
			d.wifiCheck(conn, ips)
		}
	}
	d.setStatus("connecting", "Starting DeX on "+model, nil)
	o := SessionOpts{W: want.W &^ 7, H: want.H &^ 7, DPI: want.DPI, FPS: want.FPS, Bitrate: want.Bitrate}
	// what DeX runs with, on the page: a changed setting shows there once the session started again with it
	set := map[string]interface{}{"dpi": o.DPI, "maxfps": o.FPS, "mbps": (o.Bitrate + 500000) / 1000000}
	d.log.Printf("session: %dx%d %d dpi, up to %d fps, %d bit/s", o.W, o.H, o.DPI, o.FPS, o.Bitrate)
	sess, err := StartSession(conn, jar, o, d.cfg.decoder, d.cfg.video, filepath.Join(d.cfg.state, "dexdec.log"), d.log,
		func(ev map[string]interface{}) {
			switch ev["ev"] {
			case "video":
				d.setStatus("streaming", "", map[string]interface{}{"device": model, "via": via, "w": ev["w"], "h": ev["h"],
					"dpi": set["dpi"], "maxfps": set["maxfps"], "mbps": set["mbps"]})
			default:
				d.broadcast(ev)
			}
		})
	if err != nil {
		return err
	}
	d.mu.Lock()
	if d.gen != gen {
		d.mu.Unlock()
		sess.Stop()
		return nil
	}
	d.sess = sess
	d.mu.Unlock()
	d.setStatus("streaming", "", map[string]interface{}{"device": model, "via": via,
		"dpi": set["dpi"], "maxfps": set["maxfps"], "mbps": set["mbps"]})
	<-sess.Done()
	d.mu.Lock()
	if d.sess == sess {
		d.sess = nil
	}
	d.mu.Unlock()
	if !d.wanted(gen) {
		d.setStatus("idle", "", nil)
		return nil
	}
	return sess.Err()
}

func (d *daemon) session() *Session {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.sess
}

// errReconnect: the connection ends on purpose (the phone's adbd restarts); connect again at once.
var errReconnect = errors.New("reconnect")

// openWifiPort: with "USB or Wi-Fi" chosen, a phone met on USB gets ADB on port 5555 too (as `adb tcpip 5555`), so
// that until it restarts it is found over Wi-Fi with no cable. Its adbd restarts for that, which ends this
// connection: true means so (connect again). Once per phone per 10 minutes, and not when the port is open already.
func (d *daemon) openWifiPort(conn *Conn, model string) bool {
	port, err := conn.Shell("getprop service.adb.tcp.port", 5*time.Second)
	if err != nil {
		d.log.Printf("wifi adb: getprop: %v", err)
		return false
	}
	if strings.TrimSpace(port) == "5555" {
		return false
	}
	key := model + "|" + conn.Banner
	d.mu.Lock()
	last, tried := d.tcpipAt[key]
	if tried && time.Since(last) < 10*time.Minute {
		d.mu.Unlock()
		d.log.Printf("wifi adb: port 5555 did not stay open on %s; not trying again for now", model)
		return false
	}
	d.tcpipAt[key] = time.Now()
	d.mu.Unlock()
	d.setStatus("wifi-setup", "Opening ADB on port 5555 on "+model+" (it reconnects)", nil)
	s, err := conn.Open("tcpip:5555", 5*time.Second)
	if err != nil {
		d.log.Printf("wifi adb: tcpip:5555: %v", err)
		return false
	}
	answer := make([]byte, 128)
	n, _ := s.Read(answer)
	s.Close()
	d.log.Printf("wifi adb: %s: %q", model, strings.TrimSpace(string(answer[:n])))
	conn.Close()
	return true
}

// rememberWifi keeps the phone's Wi-Fi addresses (state/phone-ip.auto) while it is on USB: over Wi-Fi later the
// service knocks there first, whether or not the unit has talked to it since.
func (d *daemon) rememberWifi(conn *Conn, model string) []string {
	out, err := conn.Shell("ip -o -4 addr show", 5*time.Second)
	if err != nil {
		d.log.Printf("wifi adb: the phone's addresses: %v", err)
		return nil
	}
	ips := phoneWifiAddrs(out)
	if len(ips) == 0 {
		d.log.Printf("wifi adb: %s has no Wi-Fi address now", model)
		return nil
	}
	f := filepath.Join(d.cfg.state, "phone-ip.auto")
	os.MkdirAll(d.cfg.state, 0o700)
	if err := os.WriteFile(f, []byte(strings.Join(ips, "\n")+"\n"), 0o600); err == nil {
		d.log.Printf("wifi adb: %s is at %s on Wi-Fi", model, strings.Join(ips, ", "))
	}
	return ips
}

// wifiCheck, with the phone on the cable: does the car reach its port 5555 over Wi-Fi? What it finds goes on the
// page (status "wifi": open, refused = the phone's adbd does not listen there, timeout = the network drops it,
// unreach = no route, noip = the phone is not on Wi-Fi, nostay = the port setting did not stick), so a Wi-Fi
// connection that does not come is explained before the cable comes out.
func (d *daemon) wifiCheck(conn *Conn, ips []string) {
	port, _ := conn.Shell("getprop service.adb.tcp.port", 5*time.Second)
	port = strings.TrimSpace(port)
	res, at := "noip", ""
	for _, ip := range ips {
		at = net.JoinHostPort(ip, "5555")
		res = probe(at, 1500*time.Millisecond)
		if res == "open" {
			break
		}
	}
	if res == "refused" && port != "5555" {
		res = "nostay"
	}
	d.log.Printf("wifi adb: check: %s %s (service.adb.tcp.port=%q)", res, at, port)
	d.mu.Lock()
	d.wifi, d.wifiAt = res, at
	d.mu.Unlock()
}
