// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Zakhar Vityk
//
// scrcpy.go - one DeX session: scrcpy-server (Genymobile/scrcpy, Apache-2.0, run unchanged with app_process) on the
// phone creates a virtual display, which One UI 8 shows as DeX; its H.264 video goes to dexdec (the unit's GPU
// decoder) and from there into mgu-render's video file; touches, scrolls and keys go back over the control socket.
// Protocol: scrcpy 5.0.1 server (Options.java, DesktopConnection.java, Streamer.java, ControlMessageReader.java).
package main

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"math/rand"
	"os/exec"
	"strings"
	"sync"
	"time"
)

const (
	scrcpyVersion = "5.0.1"
	serverOnPhone = "/data/local/tmp/dex-drive-server.jar"
	codecH264     = 0x68323634 // "h264"
	flagSession   = uint64(1) << 63
	flagConfig    = uint64(1) << 62
	flagKey       = uint64(1) << 61

	ctlKeycode      = 0
	ctlText         = 1
	ctlTouch        = 2
	ctlScroll       = 3
	ctlBackOrScreen = 4
	ctlDisplayPower = 10

	actionDown      = 0
	actionUp        = 1
	actionMove      = 2
	actionCancel    = 3
	actionHoverMove = 7

	pointerMouse    = -1 // scrcpy's POINTER_ID_MOUSE: a hover is a real mouse (DeX draws its pointer)
	buttonPrimary   = 1  // MotionEvent.BUTTON_PRIMARY
	buttonSecondary = 2  // MotionEvent.BUTTON_SECONDARY
)

// SessionOpts: the virtual display and the encoder.
type SessionOpts struct {
	W, H, DPI, FPS, Bitrate int
}

func (o SessionOpts) serverArgs(scid uint32) string {
	args := []string{
		"scid=" + fmt.Sprintf("%08x", scid),
		"log_level=info",
		"tunnel_forward=true",
		"audio=false",
		"control=true",
		"video_codec=h264",
		fmt.Sprintf("video_bit_rate=%d", o.Bitrate),
		fmt.Sprintf("max_fps=%d", o.FPS),
		fmt.Sprintf("new_display=%dx%d/%d", o.W, o.H, o.DPI),
		// the keyboard opens on the virtual display (the car's screen), not on the phone
		"display_ime_policy=local",
		"send_device_meta=false",
		"clipboard_autosync=false",
		// apps on the car's screen move to the phone when the session ends, instead of being closed
		"vd_destroy_content=false",
		"stay_awake=true",
		"power_off_on_close=false",
	}
	return "CLASSPATH=" + serverOnPhone + " app_process / com.genymobile.scrcpy.Server " + scrcpyVersion + " " + strings.Join(args, " ")
}

// Session is a running DeX session.
type Session struct {
	conn    *Conn
	log     *Logger
	server  *Stream
	video   *Stream
	control *Stream
	dec     *exec.Cmd
	decIn   io.WriteCloser
	decGone chan struct{} // closed once the decoder has exited (decoderEvents waits for it)
	cmu     sync.Mutex
	smu     sync.Mutex
	vw, vh  int
	frames  uint64
	fps     float64
	events  func(ev map[string]interface{})
	done    chan struct{}
	once    sync.Once
	err     error
	started time.Time
}

// StartSession pushes the server, starts it, opens its sockets and the decoder.
func StartSession(conn *Conn, jar []byte, o SessionOpts, decoder, videoFile, decLog string, log *Logger,
	events func(map[string]interface{})) (*Session, error) {
	if err := conn.Push(serverOnPhone, jar, 0o644, time.Now()); err != nil {
		return nil, fmt.Errorf("copying the server to the phone: %v", err)
	}
	scid := uint32(rand.Int31()) & 0x7fffffff
	cmd := o.serverArgs(scid)
	log.Printf("server: %s", cmd)
	server, err := conn.Open("shell:"+cmd, 5*time.Second)
	if err != nil {
		return nil, fmt.Errorf("starting the server: %v", err)
	}
	s := &Session{conn: conn, log: log, server: server, events: events, done: make(chan struct{}), decGone: make(chan struct{}),
		started: time.Now()}
	serverOut := make(chan string, 64)
	go func() {
		sc := bufio.NewScanner(server)
		sc.Buffer(make([]byte, 64*1024), 1024*1024)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if line == "" {
				continue
			}
			log.Printf("phone: %s", line)
			select {
			case serverOut <- line:
			default:
			}
		}
		close(serverOut)
	}()
	sock := fmt.Sprintf("localabstract:scrcpy_%08x", scid)
	// the server listens once it has started: try until it does (or says why it can't)
	deadline := time.Now().Add(15 * time.Second)
	var lastLines []string
	for {
		v, err := conn.Open(sock, 3*time.Second)
		if err == nil {
			s.video = v
			break
		}
		for done := false; !done; {
			select {
			case l, ok := <-serverOut:
				if !ok {
					server.Close()
					return nil, fmt.Errorf("the server stopped: %s", strings.Join(tail(lastLines, 3), " | "))
				}
				lastLines = append(lastLines, l)
			default:
				done = true
			}
		}
		if time.Now().After(deadline) {
			server.Close()
			return nil, fmt.Errorf("the server did not start: %s", strings.Join(tail(lastLines, 3), " | "))
		}
		time.Sleep(150 * time.Millisecond)
	}
	fail := func(err error) (*Session, error) {
		s.video.Close()
		if s.control != nil {
			s.control.Close()
		}
		server.Close()
		return nil, err
	}
	one := make([]byte, 1)
	if _, err := io.ReadFull(s.video, one); err != nil {
		return fail(fmt.Errorf("video socket: %v", err))
	}
	if s.control, err = conn.Open(sock, 5*time.Second); err != nil {
		return fail(fmt.Errorf("control socket: %v", err))
	}
	codec := make([]byte, 4)
	if _, err := io.ReadFull(s.video, codec); err != nil {
		return fail(fmt.Errorf("video header: %v", err))
	}
	switch c := binary.BigEndian.Uint32(codec); c {
	case codecH264:
	case 0, 1:
		return fail(errors.New("the phone could not start the screen encoder (is it One UI 8 / Android 16?)"))
	default:
		return fail(fmt.Errorf("unexpected codec %08x", c))
	}
	s.dec = exec.Command(decoder, "--out", videoFile, "--log", decLog)
	if s.decIn, err = s.dec.StdinPipe(); err != nil {
		return fail(err)
	}
	decOut, err := s.dec.StdoutPipe()
	if err != nil {
		return fail(err)
	}
	if err := s.dec.Start(); err != nil {
		return fail(fmt.Errorf("decoder %s: %v", decoder, err))
	}
	go s.decoderEvents(decOut)
	go s.videoLoop()
	go s.controlLoop()
	go func() {
		<-server.Done()
		s.stop(errors.New("the server on the phone stopped"))
	}()
	go func() {
		<-conn.Done()
		s.stop(conn.err())
	}()
	return s, nil
}

func tail(l []string, n int) []string {
	if len(l) > n {
		return l[len(l)-n:]
	}
	if len(l) == 0 {
		return []string{"no output"}
	}
	return l
}

// Done is closed when the session ends; Err says why.
func (s *Session) Done() <-chan struct{} { return s.done }
func (s *Session) Err() error            { return s.err }

// Stop ends the session (the server on the phone ends when its sockets close).
func (s *Session) Stop() { s.stop(errors.New("stopped")) }

func (s *Session) stop(err error) {
	s.once.Do(func() {
		s.err = err
		s.log.Printf("session ends: %v", err)
		if s.video != nil {
			s.video.Close()
		}
		if s.control != nil {
			s.control.Close()
		}
		s.server.Close()
		if s.decIn != nil {
			s.decIn.Write([]byte{0, 0, 0, 0, 0xff})
			s.decIn.Close()
		}
		if s.dec != nil && s.dec.Process != nil {
			go func(c *exec.Cmd) {
				select {
				case <-s.decGone:
				case <-time.After(2 * time.Second):
					c.Process.Kill()
				}
			}(s.dec)
		}
		close(s.done)
	})
}

// Size is the virtual display's size as the encoder streams it (0, 0 before the first frame).
func (s *Session) Size() (int, int) {
	s.smu.Lock()
	defer s.smu.Unlock()
	return s.vw, s.vh
}

func (s *Session) videoLoop() {
	h := make([]byte, 12)
	head := make([]byte, 5)
	for {
		if _, err := io.ReadFull(s.video, h); err != nil {
			s.stop(fmt.Errorf("video: %v", err))
			return
		}
		first := binary.BigEndian.Uint64(h[0:8])
		if first&flagSession != 0 {
			w := int(binary.BigEndian.Uint32(h[4:8]))
			hh := int(binary.BigEndian.Uint32(h[8:12]))
			s.smu.Lock()
			s.vw, s.vh = w, hh
			s.smu.Unlock()
			s.log.Printf("video: %dx%d", w, hh)
			s.events(map[string]interface{}{"ev": "video", "w": w, "h": hh})
			continue
		}
		n := binary.BigEndian.Uint32(h[8:12])
		if n > 16<<20 {
			s.stop(fmt.Errorf("video packet of %d bytes", n))
			return
		}
		data := make([]byte, n)
		if _, err := io.ReadFull(s.video, data); err != nil {
			s.stop(fmt.Errorf("video: %v", err))
			return
		}
		var flags byte
		if first&flagConfig != 0 {
			flags |= 1
		}
		if first&flagKey != 0 {
			flags |= 2
		}
		binary.LittleEndian.PutUint32(head, n)
		head[4] = flags
		if _, err := s.decIn.Write(append(head, data...)); err != nil {
			s.stop(fmt.Errorf("the decoder stopped: %v", err))
			return
		}
	}
}

// controlLoop drains what the phone sends back (clipboard, acks); nothing of it is used.
func (s *Session) controlLoop() {
	io.Copy(io.Discard, s.control)
}

func (s *Session) decoderEvents(r io.Reader) {
	sc := bufio.NewScanner(r)
	for sc.Scan() {
		var ev map[string]interface{}
		if json.Unmarshal(sc.Bytes(), &ev) != nil {
			continue
		}
		switch ev["ev"] {
		case "error":
			s.log.Printf("decoder: %v", ev["msg"])
			s.events(map[string]interface{}{"ev": "decoder-error", "msg": ev["msg"]})
		case "size":
			s.log.Printf("decoder: frames %vx%v", ev["w"], ev["h"])
			s.events(map[string]interface{}{"ev": "frames", "w": ev["w"], "h": ev["h"]})
		case "stats":
			if f, ok := ev["fps"].(float64); ok {
				s.smu.Lock()
				s.fps = f
				s.smu.Unlock()
			}
			s.events(map[string]interface{}{"ev": "stats", "fps": ev["fps"], "decoded": ev["decoded"], "errors": ev["errors"]})
		}
	}
	err := s.dec.Wait()
	close(s.decGone)
	code := 0
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			code = ee.ExitCode()
		} else {
			code = -1
		}
	}
	select {
	case <-s.done:
	default:
		why := fmt.Sprintf("the decoder stopped (exit %d)", code)
		if code == 1 {
			why = "the hardware decoder did not start (exit 1): see dexdec.log"
		}
		s.stop(errors.New(why))
	}
}

func (s *Session) sendControl(b []byte) error {
	s.cmu.Lock()
	defer s.cmu.Unlock()
	if s.control == nil {
		return errors.New("no control socket")
	}
	_, err := s.control.Write(b)
	return err
}

func clamp01(x float64) float64 {
	if math.IsNaN(x) || x < 0 {
		return 0
	}
	if x > 1 {
		return 1
	}
	return x
}

// touchMsg builds INJECT_TOUCH_EVENT: x, y in 0..1 of the video, pointer = finger id.
func touchMsg(action int, pointer int64, nx, ny float64, w, h int) []byte {
	b := make([]byte, 32)
	b[0] = ctlTouch
	b[1] = byte(action)
	binary.BigEndian.PutUint64(b[2:], uint64(pointer))
	binary.BigEndian.PutUint32(b[10:], uint32(int32(math.Round(clamp01(nx)*float64(w-1)))))
	binary.BigEndian.PutUint32(b[14:], uint32(int32(math.Round(clamp01(ny)*float64(h-1)))))
	binary.BigEndian.PutUint16(b[18:], uint16(w))
	binary.BigEndian.PutUint16(b[20:], uint16(h))
	pressure := uint16(0xffff)
	if action == actionUp || action == actionCancel {
		pressure = 0
	}
	binary.BigEndian.PutUint16(b[22:], pressure)
	// action button 0, buttons 0: a finger, not a mouse
	return b
}

// mouseMsg builds INJECT_TOUCH_EVENT for the mouse pointer: a hover moves DeX's own pointer; down / move / up with
// a button click and drag (the secondary button is a right click: DeX's context menu).
func mouseMsg(action int, button int, nx, ny float64, w, h int) []byte {
	b := touchMsg(action, pointerMouse, nx, ny, w, h)
	var actionButton, buttons uint32
	switch action {
	case actionDown:
		actionButton, buttons = uint32(button), uint32(button)
	case actionMove:
		buttons = uint32(button)
	case actionUp:
		actionButton = uint32(button)
	case actionHoverMove:
		binary.BigEndian.PutUint16(b[22:], 0)
	}
	binary.BigEndian.PutUint32(b[24:], actionButton)
	binary.BigEndian.PutUint32(b[28:], buttons)
	return b
}

// scrollMsg builds INJECT_SCROLL_EVENT: dy notches (+ = content moves up, as a wheel turned towards you).
func scrollMsg(nx, ny, dx, dy float64, w, h int) []byte {
	b := make([]byte, 21)
	b[0] = ctlScroll
	binary.BigEndian.PutUint32(b[1:], uint32(int32(math.Round(clamp01(nx)*float64(w-1)))))
	binary.BigEndian.PutUint32(b[5:], uint32(int32(math.Round(clamp01(ny)*float64(h-1)))))
	binary.BigEndian.PutUint16(b[9:], uint16(w))
	binary.BigEndian.PutUint16(b[11:], uint16(h))
	fx := func(v float64) uint16 {
		v = v / 16 * 32768
		if v > 32767 {
			v = 32767
		}
		if v < -32768 {
			v = -32768
		}
		return uint16(int16(math.Round(v)))
	}
	binary.BigEndian.PutUint16(b[13:], fx(dx))
	binary.BigEndian.PutUint16(b[15:], fx(dy))
	return b
}

func keyMsg(action int, keycode int) []byte {
	b := make([]byte, 14)
	b[0] = ctlKeycode
	b[1] = byte(action)
	binary.BigEndian.PutUint32(b[2:], uint32(int32(keycode)))
	return b
}

func textMsg(text string) []byte {
	t := []byte(text)
	if len(t) > 300 {
		t = t[:300]
	}
	b := make([]byte, 5, 5+len(t))
	b[0] = ctlText
	binary.BigEndian.PutUint32(b[1:], uint32(len(t)))
	return append(b, t...)
}

// Touch injects one finger's event; action: down, move, up, cancel.
func (s *Session) Touch(action string, finger int, nx, ny float64) error {
	w, h := s.Size()
	if w == 0 {
		return nil
	}
	a := map[string]int{"down": actionDown, "move": actionMove, "up": actionUp, "cancel": actionCancel}[action]
	if action != "down" && action != "move" && action != "up" && action != "cancel" {
		return fmt.Errorf("touch action %q", action)
	}
	return s.sendControl(touchMsg(a, int64(finger), nx, ny, w, h))
}

// Mouse moves DeX's pointer (a "hover") or clicks / drags with a button ("left", "right") at nx, ny: action hover,
// down, move, up.
func (s *Session) Mouse(action, button string, nx, ny float64) error {
	w, h := s.Size()
	if w == 0 {
		return nil
	}
	a, ok := map[string]int{"hover": actionHoverMove, "down": actionDown, "move": actionMove, "up": actionUp}[action]
	if !ok {
		return fmt.Errorf("mouse action %q", action)
	}
	btn := buttonPrimary
	if button == "right" {
		btn = buttonSecondary
	}
	return s.sendControl(mouseMsg(a, btn, nx, ny, w, h))
}

// Scroll scrolls at nx, ny.
func (s *Session) Scroll(nx, ny, dx, dy float64) error {
	w, h := s.Size()
	if w == 0 {
		return nil
	}
	return s.sendControl(scrollMsg(nx, ny, dx, dy, w, h))
}

// Key presses and releases an Android keycode (3 HOME, 4 BACK, 187 APP_SWITCH).
func (s *Session) Key(code int) error {
	if err := s.sendControl(keyMsg(actionDown, code)); err != nil {
		return err
	}
	return s.sendControl(keyMsg(actionUp, code))
}

// Text types text into the focused field.
func (s *Session) Text(t string) error { return s.sendControl(textMsg(t)) }

// PhoneScreen turns the phone's own screen on or off (the car's display keeps running).
func (s *Session) PhoneScreen(on bool) error {
	v := byte(0)
	if on {
		v = 1
	}
	return s.sendControl([]byte{ctlDisplayPower, v})
}
