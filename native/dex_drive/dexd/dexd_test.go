// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Zakhar Vityk
//
// The daemon end to end against a fake phone: a fake adbd (CNXN, AUTH with the key check a real adbd does, sync
// push, shell) running a fake scrcpy-server (video and control sockets as 5.0.1's), over TCP; the fake decoder
// (dexdec built with DEXDEC_FAKE) writing a real MGVF file; the app's side over the control socket.
//
//	go test ./...                       (builds the fake dexdec with c++ first)
package main

import (
	"bufio"
	"bytes"
	"crypto"
	"crypto/rsa"
	"crypto/sha1"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// ---- Android public key format ----

func parseAndroidPub(t *testing.T, s string) *rsa.PublicKey {
	t.Helper()
	b64 := strings.SplitN(strings.TrimRight(s, "\x00"), " ", 2)[0]
	b, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		t.Fatalf("pubkey base64: %v", err)
	}
	if len(b) != 524 {
		t.Fatalf("pubkey struct is %d bytes, want 524", len(b))
	}
	words := binary.LittleEndian.Uint32(b[0:])
	if words != 64 {
		t.Fatalf("len %d", words)
	}
	le := func(off int) *big.Int {
		be := make([]byte, 256)
		for i := 0; i < 256; i++ {
			be[255-i] = b[off+i]
		}
		return new(big.Int).SetBytes(be)
	}
	n := le(8)
	rr := le(8 + 256)
	n0inv := binary.LittleEndian.Uint32(b[4:])
	if uint32(n.Uint64())*n0inv != 0xffffffff {
		t.Fatalf("n0inv * n[0] = %08x, want -1", uint32(n.Uint64())*n0inv)
	}
	want := new(big.Int).Mod(new(big.Int).Lsh(big.NewInt(1), 4096), n)
	if rr.Cmp(want) != 0 {
		t.Fatalf("rr is not R^2 mod n")
	}
	return &rsa.PublicKey{N: n, E: int(binary.LittleEndian.Uint32(b[520:]))}
}

func TestKeyFormatAndSignature(t *testing.T) {
	dir := t.TempDir()
	k, made, err := LoadOrCreateKey(filepath.Join(dir, "k", "adbkey"), "test@unit")
	if err != nil || !made {
		t.Fatalf("make key: %v %v", made, err)
	}
	k2, made2, err := LoadOrCreateKey(filepath.Join(dir, "k", "adbkey"), "test@unit")
	if err != nil || made2 || k2.priv.N.Cmp(k.priv.N) != 0 {
		t.Fatalf("the key is not kept")
	}
	pub := parseAndroidPub(t, string(k.AndroidPublic()))
	if !strings.HasSuffix(string(k.AndroidPublic()), " test@unit\x00") {
		t.Fatalf("name missing")
	}
	token := sha1.Sum([]byte("token"))
	sig, err := k.Sign(token[:])
	if err != nil {
		t.Fatal(err)
	}
	if err := rsa.VerifyPKCS1v15(pub, crypto.SHA1, token[:], sig); err != nil {
		t.Fatalf("adbd would refuse the signature: %v", err)
	}
	if st, _ := os.Stat(filepath.Join(dir, "k", "adbkey")); st.Mode().Perm() != 0o600 {
		t.Fatalf("key mode %v", st.Mode())
	}
}

// ---- control messages, as ControlMessageReader reads them ----

func TestControlMessages(t *testing.T) {
	m := touchMsg(actionDown, 3, 0.5, 1.0, 1832, 720)
	if len(m) != 32 || m[0] != 2 || m[1] != 0 {
		t.Fatalf("touch %x", m)
	}
	if id := binary.BigEndian.Uint64(m[2:]); id != 3 {
		t.Fatalf("pointer %d", id)
	}
	x, y := int32(binary.BigEndian.Uint32(m[10:])), int32(binary.BigEndian.Uint32(m[14:]))
	if x != 916 || y != 719 {
		t.Fatalf("position %d,%d", x, y)
	}
	if binary.BigEndian.Uint16(m[18:]) != 1832 || binary.BigEndian.Uint16(m[20:]) != 720 || binary.BigEndian.Uint16(m[22:]) != 0xffff {
		t.Fatalf("size / pressure %x", m[18:24])
	}
	if up := touchMsg(actionUp, 0, 0, 0, 10, 10); binary.BigEndian.Uint16(up[22:]) != 0 {
		t.Fatalf("up has pressure")
	}
	s := scrollMsg(0, 0, 0, -1, 100, 100)
	if len(s) != 21 || s[0] != 3 || int16(binary.BigEndian.Uint16(s[15:])) != -2048 {
		t.Fatalf("scroll %x", s)
	}
	k := keyMsg(actionUp, 4)
	if len(k) != 14 || k[0] != 0 || k[1] != 1 || binary.BigEndian.Uint32(k[2:]) != 4 {
		t.Fatalf("key %x", k)
	}
	if tx := textMsg("hi"); !bytes.Equal(tx, []byte{1, 0, 0, 0, 2, 'h', 'i'}) {
		t.Fatalf("text %x", tx)
	}
	args := SessionOpts{W: 1832, H: 720, DPI: 160, FPS: 30, Bitrate: 8000000}.serverArgs(0x1234abcd)
	for _, want := range []string{"app_process / com.genymobile.scrcpy.Server 5.0.1 ", "scid=1234abcd", "new_display=1832x720/160",
		"tunnel_forward=true", "audio=false", "display_ime_policy=local", "send_device_meta=false"} {
		if !strings.Contains(args, want) {
			t.Fatalf("server args lack %q: %s", want, args)
		}
	}
}

func TestPacketHeader(t *testing.T) {
	p := &Packet{Cmd: aWRTE, Arg0: 7, Arg1: 9, Data: []byte("abc")}
	q, n, err := decodeHeader(encodeHeader(p))
	if err != nil || q.Cmd != aWRTE || q.Arg0 != 7 || q.Arg1 != 9 || n != 3 {
		t.Fatalf("%v %v %d", q, err, n)
	}
	bad := encodeHeader(p)
	bad[20] ^= 1
	if _, _, err := decodeHeader(bad); err == nil {
		t.Fatalf("bad magic accepted")
	}
}

// ---- the fake phone ----

type fakePhone struct {
	t        *testing.T
	l        net.Listener
	mu       sync.Mutex
	known    *rsa.PublicKey // the key the phone allows
	pushed   map[string][]byte
	shells   []string
	touches  [][]byte
	keys     [][]byte
	prompted bool
	sdk      string
	frames   int
	tcpPort  string // service.adb.tcp.port
	tcpips   int    // tcpip:5555 asked
}

func newFakePhone(t *testing.T) *fakePhone {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	p := &fakePhone{t: t, l: l, pushed: map[string][]byte{}, sdk: "36", frames: 5}
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				return
			}
			go p.serve(c)
		}
	}()
	return p
}

type phoneConn struct {
	p       *fakePhone
	tr      *streamTransport
	next    uint32
	mu      sync.Mutex
	streams map[uint32]chan []byte // our id -> data from the host
	remote  map[uint32]uint32      // our id -> host's id
	okays   map[uint32]chan struct{}
	scid    string
	sockets int
}

func (p *fakePhone) serve(c net.Conn) {
	tr := &streamTransport{rw: c, name: "fake"}
	pc := &phoneConn{p: p, tr: tr, next: 100, streams: map[uint32]chan []byte{}, remote: map[uint32]uint32{}, okays: map[uint32]chan struct{}{}}
	defer c.Close()
	pkt, err := tr.ReadPacket()
	if err != nil || pkt.Cmd != aCNXN {
		return
	}
	token := make([]byte, 20)
	copy(token, "0123456789abcdefghij")
	tr.WritePacket(&Packet{Cmd: aAUTH, Arg0: authToken, Data: token})
	for {
		pkt, err := tr.ReadPacket()
		if err != nil {
			return
		}
		if pkt.Cmd != aAUTH {
			continue
		}
		ok := false
		if pkt.Arg0 == authSignature {
			p.mu.Lock()
			k := p.known
			p.mu.Unlock()
			ok = k != nil && rsa.VerifyPKCS1v15(k, crypto.SHA1, token, pkt.Data) == nil
			if !ok {
				tr.WritePacket(&Packet{Cmd: aAUTH, Arg0: authToken, Data: token})
				continue
			}
		}
		if pkt.Arg0 == authRSAPublic {
			// the owner taps "Allow"
			k := parseAndroidPub(p.t, string(pkt.Data))
			p.mu.Lock()
			p.known = k
			p.prompted = true
			p.mu.Unlock()
			ok = true
		}
		if ok {
			break
		}
	}
	tr.WritePacket(&Packet{Cmd: aCNXN, Arg0: adbVersion, Arg1: 4096, Data: []byte("device::ro.product.name=fake;ro.product.model=SM-FAKE;ro.product.device=fake;\x00")})
	for {
		pkt, err := tr.ReadPacket()
		if err != nil {
			return
		}
		switch pkt.Cmd {
		case aOPEN:
			pc.open(pkt.Arg0, strings.TrimRight(string(pkt.Data), "\x00"))
		case aWRTE:
			pc.mu.Lock()
			ch := pc.streams[pkt.Arg1]
			rem := pc.remote[pkt.Arg1]
			pc.mu.Unlock()
			if ch != nil {
				ch <- pkt.Data
				tr.WritePacket(&Packet{Cmd: aOKAY, Arg0: pkt.Arg1, Arg1: rem})
			}
		case aOKAY:
			pc.mu.Lock()
			ok := pc.okays[pkt.Arg1]
			pc.mu.Unlock()
			if ok != nil {
				select {
				case ok <- struct{}{}:
				default:
				}
			}
		case aCLSE:
			pc.mu.Lock()
			if ch := pc.streams[pkt.Arg1]; ch != nil {
				close(ch)
				delete(pc.streams, pkt.Arg1)
			}
			pc.mu.Unlock()
		}
	}
}

// accept: a new stream; returns our id, its data channel and a writer (WRTE, waiting for OKAY).
func (pc *phoneConn) accept(host uint32) (uint32, chan []byte, func([]byte) bool, func()) {
	pc.mu.Lock()
	id := pc.next
	pc.next++
	ch := make(chan []byte, 16)
	ok := make(chan struct{}, 1)
	pc.streams[id] = ch
	pc.remote[id] = host
	pc.okays[id] = ok
	pc.mu.Unlock()
	pc.tr.WritePacket(&Packet{Cmd: aOKAY, Arg0: id, Arg1: host})
	write := func(b []byte) bool {
		if pc.tr.WritePacket(&Packet{Cmd: aWRTE, Arg0: id, Arg1: host, Data: b}) != nil {
			return false
		}
		select {
		case <-ok:
			return true
		case <-time.After(3 * time.Second):
			return false
		}
	}
	closeIt := func() { pc.tr.WritePacket(&Packet{Cmd: aCLSE, Arg0: id, Arg1: host}) }
	return id, ch, write, closeIt
}

func (pc *phoneConn) open(host uint32, svc string) {
	p := pc.p
	switch {
	case svc == "sync:":
		_, ch, write, _ := pc.accept(host)
		go func() {
			var buf []byte
			var path string
			var data []byte
			for b := range ch {
				buf = append(buf, b...)
				for len(buf) >= 8 {
					id := string(buf[:4])
					n := int(binary.LittleEndian.Uint32(buf[4:]))
					if id == "DONE" {
						buf = buf[8:]
						p.mu.Lock()
						p.pushed[path] = data
						p.mu.Unlock()
						write(syncHeader("OKAY", 0))
						continue
					}
					if id == "QUIT" {
						return
					}
					if len(buf) < 8+n {
						break
					}
					body := buf[8 : 8+n]
					switch id {
					case "SEND":
						path = strings.SplitN(string(body), ",", 2)[0]
						data = nil
					case "DATA":
						data = append(data, body...)
					}
					buf = buf[8+n:]
				}
			}
		}()
	case svc == "shell:getprop service.adb.tcp.port":
		_, _, write, closeIt := pc.accept(host)
		p.mu.Lock()
		port := p.tcpPort
		p.mu.Unlock()
		go func() { write([]byte(port + "\n")); closeIt() }()
	case svc == "tcpip:5555":
		_, _, write, _ := pc.accept(host)
		p.mu.Lock()
		p.tcpips++
		p.tcpPort = "5555"
		p.mu.Unlock()
		go func() {
			write([]byte("restarting in TCP mode port: 5555\n"))
			// adbd restarts: every connection ends
			time.Sleep(50 * time.Millisecond)
			pc.tr.Close()
		}()
	case strings.HasPrefix(svc, "shell:getprop"):
		_, _, write, closeIt := pc.accept(host)
		go func() { write([]byte(p.sdk + "\n")); closeIt() }()
	case strings.HasPrefix(svc, "shell:CLASSPATH="):
		p.mu.Lock()
		p.shells = append(p.shells, svc)
		p.mu.Unlock()
		i := strings.Index(svc, "scid=")
		pc.mu.Lock()
		pc.scid = svc[i+5 : i+13]
		pc.mu.Unlock()
		_, ch, write, _ := pc.accept(host)
		go func() {
			write([]byte("[server] INFO: Device: [samsung] SM-FAKE (Android 16)\n"))
			for range ch {
			}
		}()
	case strings.HasPrefix(svc, "localabstract:scrcpy_"):
		pc.mu.Lock()
		want := "localabstract:scrcpy_" + pc.scid
		n := pc.sockets
		if svc == want {
			pc.sockets++
		}
		pc.mu.Unlock()
		if svc != want {
			pc.tr.WritePacket(&Packet{Cmd: aCLSE, Arg0: 0, Arg1: host})
			return
		}
		_, ch, write, _ := pc.accept(host)
		if n == 0 {
			go pc.video(write)
		} else {
			go func() {
				var buf []byte
				for b := range ch {
					buf = append(buf, b...)
					for len(buf) > 0 {
						size := map[byte]int{0: 14, 2: 32, 3: 21}[buf[0]]
						if size == 0 || len(buf) < size {
							break
						}
						p.mu.Lock()
						if buf[0] == 2 {
							p.touches = append(p.touches, append([]byte(nil), buf[:size]...))
						} else if buf[0] == 0 {
							p.keys = append(p.keys, append([]byte(nil), buf[:size]...))
						}
						p.mu.Unlock()
						buf = buf[size:]
					}
				}
			}()
		}
	default:
		pc.tr.WritePacket(&Packet{Cmd: aCLSE, Arg0: 0, Arg1: host})
	}
}

// video: as Streamer.java writes it: dummy byte, codec id, session meta, then packets with frame meta.
func (pc *phoneConn) video(write func([]byte) bool) {
	be := binary.BigEndian
	b := []byte{0}
	b = be.AppendUint32(b, codecH264)
	write(b)
	sess := make([]byte, 12)
	be.PutUint32(sess[0:], 0x80000000)
	be.PutUint32(sess[4:], 64)
	be.PutUint32(sess[8:], 32)
	write(sess)
	packet := func(ptsFlags uint64, data []byte) {
		h := make([]byte, 12)
		be.PutUint64(h, ptsFlags)
		be.PutUint32(h[8:], uint32(len(data)))
		write(append(h, data...))
	}
	packet(flagConfig, []byte{0, 0, 0, 1, 0x67})
	for i := 0; i < pc.p.frames; i++ {
		// the fake decoder reads u16 w, u16 h from the end of a picture (the config goes in front of the first)
		f := []byte{0, 0, 0, 1, 0x65, 64, 0, 32, 0}
		flags := uint64(i * 33333)
		if i == 0 {
			flags |= flagKey
		}
		packet(flags, f)
		time.Sleep(20 * time.Millisecond)
	}
}

// ---- the whole daemon ----

func buildFakeDecoder(t *testing.T) string {
	t.Helper()
	out := filepath.Join(t.TempDir(), "dexdec-fake")
	src := filepath.Join("..", "dexdec", "src")
	cxx := os.Getenv("CXX")
	if cxx == "" {
		cxx = "c++"
	}
	cmd := exec.Command(cxx, "-std=c++14", "-O1", "-Wall", "-Wextra", "-Werror", "-DDEXDEC_FAKE", "-I"+src, "-o", out,
		filepath.Join(src, "main.cpp"), filepath.Join(src, "mgvf.cpp"))
	if b, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("no C++ compiler for the fake decoder: %v %s", err, b)
	}
	return out
}

type appSide struct {
	c  net.Conn
	sc *bufio.Scanner
	ev chan map[string]interface{}
}

func dialApp(t *testing.T, sock string) *appSide {
	var c net.Conn
	var err error
	for i := 0; i < 50; i++ {
		if c, err = net.Dial("unix", sock); err == nil {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if err != nil {
		t.Fatal(err)
	}
	a := &appSide{c: c, sc: bufio.NewScanner(c), ev: make(chan map[string]interface{}, 256)}
	go func() {
		for a.sc.Scan() {
			var m map[string]interface{}
			if json.Unmarshal(a.sc.Bytes(), &m) == nil {
				a.ev <- m
			}
		}
		close(a.ev)
	}()
	return a
}

func (a *appSide) send(m map[string]interface{}) {
	b, _ := json.Marshal(m)
	a.c.Write(append(b, '\n'))
}

func (a *appSide) waitState(t *testing.T, state string, d time.Duration) map[string]interface{} {
	t.Helper()
	deadline := time.After(d)
	var seen []string
	for {
		select {
		case m, ok := <-a.ev:
			if !ok {
				t.Fatalf("socket closed waiting for %s (seen %v)", state, seen)
			}
			if m["ev"] == "status" {
				seen = append(seen, fmt.Sprintf("%v:%v", m["state"], m["msg"]))
				if m["state"] == state {
					return m
				}
			}
		case <-deadline:
			t.Fatalf("no %s within %v (seen %v)", state, d, seen)
		}
	}
}

func TestDaemonEndToEnd(t *testing.T) {
	dec := buildFakeDecoder(t)
	dir := t.TempDir()
	jar := filepath.Join(dir, "scrcpy-server")
	os.WriteFile(jar, []byte("PK fake server jar"), 0o644)
	os.Setenv("DEXDEC_ANY_PATH", "1")
	video := filepath.Join(dir, "mgu-video-test")
	phone := newFakePhone(t)
	defer phone.l.Close()
	cfg := config{sock: filepath.Join(dir, "ctl.sock"), group: os.Getgid(), state: filepath.Join(dir, "state"), server: jar,
		decoder: dec, video: video, sysUsb: filepath.Join(dir, "nosys"), keyName: "test@unit", idleAfter: 2 * time.Second}
	d := newDaemon(cfg, NewLogger(""))
	if err := d.listen(); err != nil {
		t.Fatal(err)
	}
	app := dialApp(t, cfg.sock)
	app.waitState(t, "idle", 2*time.Second)
	app.send(map[string]interface{}{"cmd": "start", "w": 320, "h": 240, "dpi": 160, "fps": 30, "tcp": phone.l.Addr().String()})
	app.waitState(t, "auth", 5*time.Second)
	st := app.waitState(t, "streaming", 10*time.Second)
	if st["device"] != "SM-FAKE" || st["via"] != "tcp" {
		t.Fatalf("status %v", st)
	}
	// the decoder writes the frames into the video file
	deadline := time.Now().Add(5 * time.Second)
	var head []byte
	for time.Now().Before(deadline) {
		head, _ = os.ReadFile(video)
		if len(head) >= 64 && binary.LittleEndian.Uint32(head[16:]) >= uint32(phone.frames) {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if len(head) < 64 || binary.LittleEndian.Uint32(head[0:]) != 0x4656474d {
		t.Fatalf("no MGVF file")
	}
	if w, h := binary.LittleEndian.Uint32(head[8:]), binary.LittleEndian.Uint32(head[12:]); w != 64 || h != 32 {
		t.Fatalf("MGVF %dx%d", w, h)
	}
	if seq := binary.LittleEndian.Uint32(head[16:]); seq != uint32(phone.frames) {
		t.Fatalf("MGVF seq %d, want %d (the config packet must not count as a frame)", seq, phone.frames)
	}
	phone.mu.Lock()
	if string(phone.pushed[serverOnPhone]) != "PK fake server jar" {
		t.Fatalf("server not pushed: %v", phone.pushed)
	}
	if len(phone.shells) != 1 || !strings.Contains(phone.shells[0], "new_display=320x240/160") || !phone.prompted {
		t.Fatalf("shells %v prompted %v", phone.shells, phone.prompted)
	}
	phone.mu.Unlock()
	// touches and keys reach the phone in the video's pixels
	app.send(map[string]interface{}{"cmd": "touch", "a": "down", "id": 1, "x": 1.0, "y": 0.0})
	app.send(map[string]interface{}{"cmd": "touch", "a": "up", "id": 1, "x": 1.0, "y": 0.0})
	app.send(map[string]interface{}{"cmd": "key", "code": 4})
	deadline = time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		phone.mu.Lock()
		n, k := len(phone.touches), len(phone.keys)
		phone.mu.Unlock()
		if n >= 2 && k >= 2 {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	phone.mu.Lock()
	if len(phone.touches) < 2 || len(phone.keys) < 2 {
		t.Fatalf("touches %d keys %d", len(phone.touches), len(phone.keys))
	}
	m := phone.touches[0]
	if m[1] != actionDown || int32(binary.BigEndian.Uint32(m[10:])) != 63 || binary.BigEndian.Uint16(m[18:]) != 64 {
		t.Fatalf("touch %x", m)
	}
	phone.mu.Unlock()
	// stop: idle again; a second start uses the allowed key without asking
	app.send(map[string]interface{}{"cmd": "stop"})
	app.waitState(t, "idle", 3*time.Second)
	phone.mu.Lock()
	phone.prompted = false
	phone.mu.Unlock()
	app.send(map[string]interface{}{"cmd": "start", "w": 320, "h": 240, "dpi": 200, "tcp": phone.l.Addr().String()})
	app.waitState(t, "streaming", 10*time.Second)
	phone.mu.Lock()
	if phone.prompted {
		t.Fatalf("the phone was asked again for a key it allows")
	}
	phone.mu.Unlock()
	// the app goes away: the session stops by itself
	app.c.Close()
	deadline = time.Now().Add(6 * time.Second)
	for time.Now().Before(deadline) {
		d.mu.Lock()
		w := d.want
		d.mu.Unlock()
		if w == nil {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("the session kept running without the app")
}

func TestOldAndroidRefused(t *testing.T) {
	dec := buildFakeDecoder(t)
	dir := t.TempDir()
	jar := filepath.Join(dir, "scrcpy-server")
	os.WriteFile(jar, []byte("jar"), 0o644)
	phone := newFakePhone(t)
	phone.sdk = "34"
	defer phone.l.Close()
	cfg := config{sock: filepath.Join(dir, "ctl.sock"), group: os.Getgid(), state: filepath.Join(dir, "state"), server: jar,
		decoder: dec, video: filepath.Join(dir, "v"), sysUsb: filepath.Join(dir, "nosys"), keyName: "t", idleAfter: time.Minute}
	d := newDaemon(cfg, NewLogger(""))
	if err := d.listen(); err != nil {
		t.Fatal(err)
	}
	app := dialApp(t, cfg.sock)
	app.send(map[string]interface{}{"cmd": "start", "tcp": phone.l.Addr().String()})
	st := app.waitState(t, "error", 10*time.Second)
	if !strings.Contains(fmt.Sprint(st["msg"]), "One UI 8") {
		t.Fatalf("message %v", st["msg"])
	}
}

func TestFindUsbAdb(t *testing.T) {
	root := t.TempDir()
	put := func(p, v string) {
		os.MkdirAll(filepath.Dir(filepath.Join(root, p)), 0o755)
		os.WriteFile(filepath.Join(root, p), []byte(v+"\n"), 0o644)
	}
	put("1-1/busnum", "1")
	put("1-1/devnum", "7")
	put("1-1/idVendor", "04e8")
	put("1-1/product", "SAMSUNG_Android")
	// MTP interface: not ours
	put("1-1:1.0/bInterfaceClass", "06")
	put("1-1:1.0/bInterfaceSubClass", "01")
	put("1-1:1.0/bInterfaceProtocol", "01")
	// ADB
	put("1-1:1.1/bInterfaceClass", "ff")
	put("1-1:1.1/bInterfaceSubClass", "42")
	put("1-1:1.1/bInterfaceProtocol", "01")
	put("1-1:1.1/bInterfaceNumber", "01")
	put("1-1:1.1/ep_01/type", "Bulk")
	put("1-1:1.1/ep_01/direction", "out")
	put("1-1:1.1/ep_01/bEndpointAddress", "01")
	put("1-1:1.1/ep_01/wMaxPacketSize", "0200")
	put("1-1:1.1/ep_81/type", "Bulk")
	put("1-1:1.1/ep_81/direction", "in")
	put("1-1:1.1/ep_81/bEndpointAddress", "81")
	put("1-1:1.1/ep_81/wMaxPacketSize", "0200")
	got := FindUsbAdb(root)
	if len(got) != 1 {
		t.Fatalf("found %v", got)
	}
	u := got[0]
	if u.DevNode != "/dev/bus/usb/001/007" || u.Iface != 1 || u.EpIn != 0x81 || u.EpOut != 0x01 || u.MaxPacket != 512 || u.Product != "SAMSUNG_Android" {
		t.Fatalf("%+v", u)
	}
	// bound to a kernel driver: left alone
	os.Symlink("/nonexistent", filepath.Join(root, "1-1:1.1", "driver"))
	if got := FindUsbAdb(root); len(got) != 0 {
		t.Fatalf("took a driver's interface")
	}
}

var _ = io.EOF

func TestPhoneCandidates(t *testing.T) {
	dir := t.TempDir()
	arp := filepath.Join(dir, "arp")
	os.WriteFile(arp, []byte("IP address       HW type     Flags       HW address            Mask     Device\n"+
		"172.16.222.40    0x1         0x2         aa:bb:cc:dd:ee:ff     *        wlan0\n"+
		"172.16.222.41    0x1         0x0         00:00:00:00:00:00     *        wlan0\n"+
		"160.48.199.1     0x1         0x2         11:22:33:44:55:66     *        eth0\n"), 0o644)
	ipf := filepath.Join(dir, "phone-ip")
	os.WriteFile(ipf, []byte("192.168.43.7\n10.0.0.2:5556\n"), 0o644)
	got := strings.Join(phoneCandidates("auto", ipf, arp), " ")
	if got != "192.168.43.7:5555 10.0.0.2:5556 172.16.222.40:5555 160.48.199.1:5555" {
		t.Fatalf("auto: %s", got)
	}
	if got := phoneCandidates("192.168.1.5", ipf, arp); len(got) != 1 || got[0] != "192.168.1.5:5555" {
		t.Fatalf("fixed: %v", got)
	}
	// the first one that answers
	l, _ := net.Listen("tcp", "127.0.0.1:0")
	defer l.Close()
	os.WriteFile(ipf, []byte("127.0.0.1:1\n"+l.Addr().String()+"\n"), 0o644)
	c, addr := dialPhone("auto", ipf, filepath.Join(dir, "none"))
	if c == nil || addr != l.Addr().String() {
		t.Fatalf("dial: %v %s", c, addr)
	}
	c.Close()
}

func TestWifiPortOpenedOnce(t *testing.T) {
	dec := buildFakeDecoder(t)
	dir := t.TempDir()
	jar := filepath.Join(dir, "scrcpy-server")
	os.WriteFile(jar, []byte("jar"), 0o644)
	phone := newFakePhone(t)
	defer phone.l.Close()
	state := filepath.Join(dir, "state")
	os.MkdirAll(state, 0o700)
	os.WriteFile(filepath.Join(state, "phone-ip"), []byte(phone.l.Addr().String()+"\n"), 0o644)
	os.Setenv("DEXDEC_ANY_PATH", "1")
	cfg := config{sock: filepath.Join(dir, "ctl.sock"), group: os.Getgid(), state: state, server: jar, decoder: dec,
		video: filepath.Join(dir, "v"), sysUsb: filepath.Join(dir, "nosys"), keyName: "t", idleAfter: time.Minute,
		arp: filepath.Join(dir, "noarp"), wifiOverTCP: true}
	d := newDaemon(cfg, NewLogger(""))
	if err := d.listen(); err != nil {
		t.Fatal(err)
	}
	app := dialApp(t, cfg.sock)
	app.send(map[string]interface{}{"cmd": "start", "tcp": "auto"})
	app.waitState(t, "wifi-setup", 10*time.Second)
	app.waitState(t, "streaming", 15*time.Second)
	phone.mu.Lock()
	n := phone.tcpips
	phone.mu.Unlock()
	if n != 1 {
		t.Fatalf("tcpip:5555 asked %d times, want 1", n)
	}
	// again (port already open): no restart of the phone's adbd
	app.send(map[string]interface{}{"cmd": "stop"})
	app.waitState(t, "idle", 3*time.Second)
	app.send(map[string]interface{}{"cmd": "start", "tcp": "auto", "dpi": 200})
	app.waitState(t, "streaming", 10*time.Second)
	phone.mu.Lock()
	n = phone.tcpips
	phone.mu.Unlock()
	if n != 1 {
		t.Fatalf("port 5555 opened again while open (%d)", n)
	}
}
