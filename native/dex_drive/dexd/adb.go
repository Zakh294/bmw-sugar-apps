// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Zakhar Vityk
//
// adb.go - the host side of the ADB protocol (system/core/adb/protocol.txt): one connection to a phone's adbd over
// a transport (USB or TCP), authentication, and streams (services such as "shell:...", "sync:",
// "localabstract:<name>") multiplexed over it.
package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"
)

const (
	aSYNC = 0x434e5953
	aCNXN = 0x4e584e43
	aOPEN = 0x4e45504f
	aOKAY = 0x59414b4f
	aCLSE = 0x45534c43
	aWRTE = 0x45545257
	aAUTH = 0x48545541
	aSTLS = 0x534c5453

	adbVersion     = 0x01000001 // checksums may be 0
	adbMaxPayload  = 256 * 1024 // what we offer; the phone answers with its own
	authToken      = 1
	authSignature  = 2
	authRSAPublic  = 3
	headerSize     = 24
	maxPacketBytes = 1024 * 1024
)

// Packet is one ADB message.
type Packet struct {
	Cmd, Arg0, Arg1 uint32
	Data            []byte
}

func cmdName(c uint32) string {
	b := make([]byte, 4)
	binary.LittleEndian.PutUint32(b, c)
	return string(b)
}

func (p *Packet) String() string {
	return fmt.Sprintf("%s(%d, %d, %d bytes)", cmdName(p.Cmd), p.Arg0, p.Arg1, len(p.Data))
}

func checksum(b []byte) uint32 {
	var s uint32
	for _, x := range b {
		s += uint32(x)
	}
	return s
}

// encodeHeader writes the 24-byte header of p.
func encodeHeader(p *Packet) []byte {
	h := make([]byte, headerSize)
	binary.LittleEndian.PutUint32(h[0:], p.Cmd)
	binary.LittleEndian.PutUint32(h[4:], p.Arg0)
	binary.LittleEndian.PutUint32(h[8:], p.Arg1)
	binary.LittleEndian.PutUint32(h[12:], uint32(len(p.Data)))
	binary.LittleEndian.PutUint32(h[16:], checksum(p.Data))
	binary.LittleEndian.PutUint32(h[20:], p.Cmd^0xffffffff)
	return h
}

// decodeHeader reads a header: the packet without its data, and the data length.
func decodeHeader(h []byte) (*Packet, int, error) {
	if len(h) < headerSize {
		return nil, 0, fmt.Errorf("short header (%d bytes)", len(h))
	}
	p := &Packet{Cmd: binary.LittleEndian.Uint32(h[0:]), Arg0: binary.LittleEndian.Uint32(h[4:]), Arg1: binary.LittleEndian.Uint32(h[8:])}
	n := binary.LittleEndian.Uint32(h[12:])
	if binary.LittleEndian.Uint32(h[20:]) != p.Cmd^0xffffffff {
		return nil, 0, fmt.Errorf("bad magic in header %x", h)
	}
	if n > maxPacketBytes {
		return nil, 0, fmt.Errorf("packet of %d bytes", n)
	}
	return p, int(n), nil
}

// Transport carries whole ADB packets.
type Transport interface {
	ReadPacket() (*Packet, error)
	WritePacket(*Packet) error
	Close() error
	Name() string
}

// streamTransport: TCP (adb tcpip 5555) or any byte stream.
type streamTransport struct {
	rw   io.ReadWriteCloser
	name string
	wmu  sync.Mutex
}

func (t *streamTransport) ReadPacket() (*Packet, error) {
	h := make([]byte, headerSize)
	if _, err := io.ReadFull(t.rw, h); err != nil {
		return nil, err
	}
	p, n, err := decodeHeader(h)
	if err != nil {
		return nil, err
	}
	if n > 0 {
		p.Data = make([]byte, n)
		if _, err := io.ReadFull(t.rw, p.Data); err != nil {
			return nil, err
		}
	}
	return p, nil
}

func (t *streamTransport) WritePacket(p *Packet) error {
	t.wmu.Lock()
	defer t.wmu.Unlock()
	b := append(encodeHeader(p), p.Data...)
	_, err := t.rw.Write(b)
	return err
}

func (t *streamTransport) Close() error { return t.rw.Close() }
func (t *streamTransport) Name() string { return t.name }

// ErrAuthPending: the phone shows "Allow USB debugging?" and nobody answered yet.
var ErrAuthPending = errors.New("waiting for the phone to allow debugging")

// Conn is one ADB connection.
type Conn struct {
	t        Transport
	maxData  int
	Banner   string // the phone's CNXN banner: "device::ro.product.name=...;ro.product.model=...;..."
	wmu      sync.Mutex
	mu       sync.Mutex
	streams  map[uint32]*Stream
	nextID   uint32
	closed   chan struct{}
	closeErr error
	once     sync.Once
}

// Handshake connects over t: CNXN, then AUTH with key (signature first, the public key when the phone does not know
// it: the phone then asks its owner). onPrompt is called once when the phone asks. Gives up after wait.
func Handshake(t Transport, key *AdbKey, wait time.Duration, onPrompt func()) (*Conn, error) {
	banner := []byte("host::features=cmd\x00")
	if err := t.WritePacket(&Packet{Cmd: aCNXN, Arg0: adbVersion, Arg1: adbMaxPayload, Data: banner}); err != nil {
		return nil, err
	}
	deadline := time.Now().Add(wait)
	signed := false
	prompted := false
	type res struct {
		p   *Packet
		err error
	}
	for {
		if time.Now().After(deadline) {
			if prompted {
				return nil, ErrAuthPending
			}
			return nil, errors.New("no answer from adbd")
		}
		ch := make(chan res, 1)
		go func() { p, err := t.ReadPacket(); ch <- res{p, err} }()
		var r res
		select {
		case r = <-ch:
		case <-time.After(time.Until(deadline)):
			if prompted {
				return nil, ErrAuthPending
			}
			return nil, errors.New("no answer from adbd")
		}
		if r.err != nil {
			return nil, r.err
		}
		p := r.p
		switch p.Cmd {
		case aCNXN:
			c := &Conn{t: t, maxData: int(p.Arg1), Banner: strings.TrimRight(string(p.Data), "\x00"),
				streams: map[uint32]*Stream{}, nextID: 1, closed: make(chan struct{})}
			if c.maxData <= 0 || c.maxData > adbMaxPayload {
				c.maxData = adbMaxPayload
			}
			go c.readLoop()
			return c, nil
		case aSTLS:
			return nil, errors.New("the phone asks for TLS (Wireless debugging): use USB, or adb tcpip 5555")
		case aAUTH:
			if p.Arg0 != authToken {
				continue
			}
			if !signed {
				sig, err := key.Sign(p.Data)
				if err != nil {
					return nil, err
				}
				signed = true
				if err := t.WritePacket(&Packet{Cmd: aAUTH, Arg0: authSignature, Data: sig}); err != nil {
					return nil, err
				}
				continue
			}
			if !prompted {
				prompted = true
				if err := t.WritePacket(&Packet{Cmd: aAUTH, Arg0: authRSAPublic, Data: key.AndroidPublic()}); err != nil {
					return nil, err
				}
				if onPrompt != nil {
					onPrompt()
				}
			}
		}
	}
}

// Model is the phone's model from its banner (ro.product.model), or "".
func (c *Conn) Model() string {
	for _, part := range strings.Split(c.Banner, ";") {
		if i := strings.Index(part, "ro.product.model="); i >= 0 {
			return part[i+len("ro.product.model="):]
		}
	}
	return ""
}

func (c *Conn) write(p *Packet) error {
	c.wmu.Lock()
	defer c.wmu.Unlock()
	select {
	case <-c.closed:
		return c.err()
	default:
	}
	return c.t.WritePacket(p)
}

func (c *Conn) err() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closeErr != nil {
		return c.closeErr
	}
	return io.ErrClosedPipe
}

// Done is closed when the connection ends.
func (c *Conn) Done() <-chan struct{} { return c.closed }

// Close ends the connection and every stream.
func (c *Conn) Close() error { c.shut(errors.New("closed")); return nil }

func (c *Conn) shut(err error) {
	c.once.Do(func() {
		c.mu.Lock()
		c.closeErr = err
		ss := c.streams
		c.streams = map[uint32]*Stream{}
		c.mu.Unlock()
		close(c.closed)
		c.t.Close()
		for _, s := range ss {
			s.remoteClosed()
		}
	})
}

func (c *Conn) readLoop() {
	for {
		p, err := c.t.ReadPacket()
		if err != nil {
			c.shut(fmt.Errorf("connection lost: %v", err))
			return
		}
		c.mu.Lock()
		s := c.streams[p.Arg1]
		c.mu.Unlock()
		switch p.Cmd {
		case aOKAY:
			if s != nil {
				s.gotOkay(p.Arg0)
			}
		case aWRTE:
			if s == nil {
				c.write(&Packet{Cmd: aCLSE, Arg0: 0, Arg1: p.Arg0})
				continue
			}
			s.gotData(p.Data)
		case aCLSE:
			if s != nil {
				c.mu.Lock()
				delete(c.streams, p.Arg1)
				c.mu.Unlock()
				s.remoteClosed()
			}
		case aCNXN:
			c.shut(errors.New("the phone restarted the connection"))
			return
		}
	}
}

// Open opens service on the phone ("shell:ls", "sync:", "localabstract:scrcpy_1234abcd").
func (c *Conn) Open(service string, timeout time.Duration) (*Stream, error) {
	c.mu.Lock()
	id := c.nextID
	c.nextID++
	s := &Stream{c: c, local: id, okay: make(chan struct{}, 1), opened: make(chan bool, 1), rcv: make(chan []byte, 4), done: make(chan struct{})}
	c.streams[id] = s
	c.mu.Unlock()
	if err := c.write(&Packet{Cmd: aOPEN, Arg0: id, Data: append([]byte(service), 0)}); err != nil {
		return nil, err
	}
	select {
	case ok := <-s.opened:
		if !ok {
			return nil, fmt.Errorf("%s: refused", service)
		}
		return s, nil
	case <-s.done:
		return nil, fmt.Errorf("%s: refused", service)
	case <-c.closed:
		return nil, c.err()
	case <-time.After(timeout):
		s.Close()
		return nil, fmt.Errorf("%s: no answer", service)
	}
}

// Stream is one service's stream: io.ReadWriteCloser with ADB's flow control (one write in flight, each answered by
// OKAY; each chunk we read is answered with OKAY once it is taken).
type Stream struct {
	c       *Conn
	local   uint32
	remote  uint32
	smu     sync.Mutex
	isOpen  bool
	okay    chan struct{}
	opened  chan bool
	rcv     chan []byte
	pending []byte
	done    chan struct{}
	once    sync.Once
	wmu     sync.Mutex
}

func (s *Stream) gotOkay(remote uint32) {
	s.smu.Lock()
	first := !s.isOpen
	if first {
		s.isOpen = true
		s.remote = remote
	}
	s.smu.Unlock()
	if first {
		s.opened <- true
		return
	}
	select {
	case s.okay <- struct{}{}:
	default:
	}
}

func (s *Stream) gotData(b []byte) {
	select {
	case s.rcv <- b:
	case <-s.done:
	}
}

func (s *Stream) remoteClosed() {
	s.once.Do(func() { close(s.done) })
}

func (s *Stream) Read(b []byte) (int, error) {
	if len(s.pending) == 0 {
		select {
		case d := <-s.rcv:
			s.pending = d
			s.smu.Lock()
			remote := s.remote
			s.smu.Unlock()
			s.c.write(&Packet{Cmd: aOKAY, Arg0: s.local, Arg1: remote})
		case <-s.done:
			// data that came before the close is still read
			select {
			case d := <-s.rcv:
				s.pending = d
			default:
				return 0, io.EOF
			}
		}
	}
	n := copy(b, s.pending)
	s.pending = s.pending[n:]
	return n, nil
}

func (s *Stream) Write(b []byte) (int, error) {
	s.wmu.Lock()
	defer s.wmu.Unlock()
	written := 0
	for len(b) > 0 {
		n := len(b)
		if n > s.c.maxData {
			n = s.c.maxData
		}
		s.smu.Lock()
		remote := s.remote
		s.smu.Unlock()
		if err := s.c.write(&Packet{Cmd: aWRTE, Arg0: s.local, Arg1: remote, Data: append([]byte(nil), b[:n]...)}); err != nil {
			return written, err
		}
		select {
		case <-s.okay:
		case <-s.done:
			return written, io.ErrClosedPipe
		case <-s.c.closed:
			return written, s.c.err()
		case <-time.After(10 * time.Second):
			return written, errors.New("the phone took no data for 10 s")
		}
		written += n
		b = b[n:]
	}
	return written, nil
}

// Close closes our end (the phone answers CLSE).
func (s *Stream) Close() error {
	s.c.mu.Lock()
	_, ours := s.c.streams[s.local]
	delete(s.c.streams, s.local)
	s.c.mu.Unlock()
	if ours {
		s.smu.Lock()
		remote := s.remote
		s.smu.Unlock()
		s.c.write(&Packet{Cmd: aCLSE, Arg0: s.local, Arg1: remote})
	}
	s.remoteClosed()
	return nil
}

// Done is closed when the stream ends.
func (s *Stream) Done() <-chan struct{} { return s.done }

// Shell runs cmd on the phone and returns its output (legacy "shell:" service: stdout and stderr together).
func (c *Conn) Shell(cmd string, timeout time.Duration) (string, error) {
	s, err := c.Open("shell:"+cmd, 5*time.Second)
	if err != nil {
		return "", err
	}
	defer s.Close()
	type res struct {
		b   []byte
		err error
	}
	ch := make(chan res, 1)
	go func() { b, err := io.ReadAll(s); ch <- res{b, err} }()
	select {
	case r := <-ch:
		return string(r.b), r.err
	case <-time.After(timeout):
		return "", fmt.Errorf("shell %q: timed out", cmd)
	}
}
