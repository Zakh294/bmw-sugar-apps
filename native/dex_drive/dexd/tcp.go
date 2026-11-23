// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Zakhar Vityk
//
// tcp.go - ADB over Wi-Fi (the phone's adbd on port 5555, "adb tcpip 5555"): an address the app gives, or "auto":
// the addresses in the state folder's phone-ip file, then every neighbour the unit sees (the phone on the car's
// hotspot, or the unit on the phone's), each tried on port 5555.
package main

import (
	"bufio"
	"net"
	"os"
	"strings"
	"time"
)

// arpNeighbours: complete entries of /proc/net/arp ("IP address  HW type  Flags  HW address  Mask  Device").
func arpNeighbours(path string) []string {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	var out []string
	sc := bufio.NewScanner(f)
	sc.Scan() // header
	for sc.Scan() {
		fl := strings.Fields(sc.Text())
		if len(fl) >= 4 && fl[2] != "0x0" && fl[3] != "00:00:00:00:00:00" && net.ParseIP(fl[0]) != nil {
			out = append(out, fl[0])
		}
	}
	return out
}

func withPort(a string) string {
	a = strings.TrimSpace(a)
	if a == "" {
		return ""
	}
	if _, _, err := net.SplitHostPort(a); err == nil {
		return a
	}
	return net.JoinHostPort(a, "5555")
}

// phoneCandidates: where to look for the phone's adbd.
func phoneCandidates(want, ipFile, arp string) []string {
	var c []string
	seen := map[string]bool{}
	add := func(a string) {
		if a = withPort(a); a != "" && !seen[a] {
			seen[a] = true
			c = append(c, a)
		}
	}
	if want != "auto" {
		add(want)
		return c
	}
	if b, err := os.ReadFile(ipFile); err == nil {
		for _, l := range strings.Fields(string(b)) {
			add(l)
		}
	}
	for _, ip := range arpNeighbours(arp) {
		add(ip)
	}
	return c
}

// dialPhone tries the candidates at once and keeps the first that answers.
func dialPhone(want, ipFile, arp string) (net.Conn, string) {
	cands := phoneCandidates(want, ipFile, arp)
	if len(cands) == 0 {
		return nil, ""
	}
	type res struct {
		c    net.Conn
		addr string
	}
	ch := make(chan res, len(cands))
	for _, a := range cands {
		go func(a string) {
			c, err := net.DialTimeout("tcp", a, 700*time.Millisecond)
			if err != nil {
				c = nil
			}
			ch <- res{c, a}
		}(a)
	}
	var won res
	for range cands {
		r := <-ch
		if r.c == nil {
			continue
		}
		if won.c == nil {
			won = r
		} else {
			r.c.Close()
		}
	}
	return won.c, won.addr
}
