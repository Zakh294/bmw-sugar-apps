// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Zakhar Vityk
//
// ctl.go - the control socket the DeX Drive app talks to (JSON lines; main.go lists the messages).
package main

import (
	"bufio"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type client struct {
	c    net.Conn
	wmu  sync.Mutex
	dead bool
}

func (c *client) send(ev map[string]interface{}) {
	b, err := json.Marshal(ev)
	if err != nil {
		return
	}
	c.wmu.Lock()
	defer c.wmu.Unlock()
	if c.dead {
		return
	}
	c.c.SetWriteDeadline(time.Now().Add(2 * time.Second))
	if _, err := c.c.Write(append(b, '\n')); err != nil {
		c.dead = true
		c.c.Close()
	}
}

func (d *daemon) listen() error {
	os.MkdirAll(filepath.Dir(d.cfg.sock), 0o755)
	os.Remove(d.cfg.sock)
	l, err := net.Listen("unix", d.cfg.sock)
	if err != nil {
		return err
	}
	os.Chown(d.cfg.sock, 0, d.cfg.group)
	os.Chmod(d.cfg.sock, 0o660)
	go func() {
		for {
			c, err := l.Accept()
			if err != nil {
				d.log.Printf("accept: %v", err)
				time.Sleep(time.Second)
				continue
			}
			go d.serve(&client{c: c})
		}
	}()
	return nil
}

type ctlMsg struct {
	Cmd     string  `json:"cmd"`
	W       int     `json:"w"`
	H       int     `json:"h"`
	DPI     int     `json:"dpi"`
	FPS     int     `json:"fps"`
	Bitrate int     `json:"bitrate"`
	TCP     string  `json:"tcp"`
	A       string  `json:"a"`
	B       string  `json:"b"`
	ID      int     `json:"id"`
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
	DX      float64 `json:"dx"`
	DY      float64 `json:"dy"`
	Code    int     `json:"code"`
	Text    string  `json:"text"`
	On      bool    `json:"on"`
}

func between(v, lo, hi, def int) int {
	if v == 0 {
		return def
	}
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func (d *daemon) serve(c *client) {
	d.mu.Lock()
	d.clients[c] = true
	d.lastApp = time.Now()
	st := d.status
	d.mu.Unlock()
	c.send(st)
	defer func() {
		d.mu.Lock()
		delete(d.clients, c)
		d.lastApp = time.Now()
		d.mu.Unlock()
		c.c.Close()
	}()
	sc := bufio.NewScanner(c.c)
	sc.Buffer(make([]byte, 4096), 64*1024)
	for sc.Scan() {
		var m ctlMsg
		if json.Unmarshal(sc.Bytes(), &m) != nil {
			continue
		}
		d.mu.Lock()
		d.lastApp = time.Now()
		d.mu.Unlock()
		s := d.session()
		switch m.Cmd {
		case "start":
			req := &startReq{W: between(m.W, 320, 2048, 1832), H: between(m.H, 240, 2048, 720), DPI: between(m.DPI, 80, 480, 160),
				FPS: between(m.FPS, 5, 60, 30), Bitrate: between(m.Bitrate, 1000000, 40000000, 8000000), TCP: m.TCP}
			d.mu.Lock()
			same := d.want != nil && *d.want == *req
			if !same {
				d.want = req
				d.gen++
			}
			old := d.sess
			d.mu.Unlock()
			if !same {
				d.log.Printf("start %+v", *req)
				if old != nil {
					old.Stop()
				}
				d.kick()
			}
		case "stop":
			d.log.Printf("stop")
			d.stopSession()
			d.setStatus("idle", "", nil)
		case "touch":
			if s != nil {
				s.Touch(m.A, m.ID, m.X, m.Y)
			}
		case "mouse":
			if s != nil {
				s.Mouse(m.A, m.B, m.X, m.Y)
			}
		case "scroll":
			if s != nil {
				s.Scroll(m.X, m.Y, m.DX, m.DY)
			}
		case "key":
			if s != nil && m.Code > 0 {
				s.Key(m.Code)
			}
		case "text":
			if s != nil && m.Text != "" {
				s.Text(m.Text)
			}
		case "phone-screen":
			if s != nil {
				s.PhoneScreen(m.On)
			}
		case "forget-key":
			d.stopSession()
			os.Remove(filepath.Join(d.cfg.state, "adbkey"))
			d.log.Printf("ADB key removed: a new one is made at the next connection")
			d.setStatus("idle", "key forgotten", nil)
		case "status":
			d.mu.Lock()
			st := d.status
			d.mu.Unlock()
			c.send(st)
		case "ping":
		}
	}
}
