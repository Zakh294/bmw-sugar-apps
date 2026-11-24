// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Zakhar Vityk
//
// tcp.go - ADB over Wi-Fi (the phone's adbd on port 5555, "adb tcpip 5555"): an address the app gives, or "auto":
// the addresses in the state folder's phone-ip file (written by hand), the phone's own Wi-Fi addresses remembered
// while it was on USB (phone-ip.auto), every neighbour the unit sees, each tried on port 5555; and when none answers,
// every address of the unit's own Wi-Fi networks (a /24 around each), at most every 15 s.
package main

import (
	"bufio"
	"errors"
	"net"
	"os"
	"strings"
	"syscall"
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

// phoneCandidates: where to look for the phone's adbd first.
func phoneCandidates(want string, ipFiles []string, arp string) []string {
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
	for _, f := range ipFiles {
		if b, err := os.ReadFile(f); err == nil {
			for _, l := range strings.Fields(string(b)) {
				add(l)
			}
		}
	}
	for _, ip := range arpNeighbours(arp) {
		add(ip)
	}
	return c
}

// dialAny tries the addresses at once (at most 64 at a time) and keeps the first that answers.
func dialAny(addrs []string, timeout time.Duration) (net.Conn, string) {
	if len(addrs) == 0 {
		return nil, ""
	}
	type res struct {
		c    net.Conn
		addr string
	}
	ch := make(chan res, len(addrs))
	sem := make(chan struct{}, 64)
	for _, a := range addrs {
		go func(a string) {
			sem <- struct{}{}
			c, err := net.DialTimeout("tcp", a, timeout)
			<-sem
			if err != nil {
				c = nil
			}
			ch <- res{c, a}
		}(a)
	}
	var won res
	for range addrs {
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

// dialPhone tries the candidates.
func dialPhone(want string, ipFiles []string, arp string) (net.Conn, string) {
	return dialAny(phoneCandidates(want, ipFiles, arp), 700*time.Millisecond)
}

// carNet: the head unit's own vehicle networks (Ethernet to the other ECUs, link-local), never scanned.
func carNet(ip net.IP, ifname string) bool {
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || strings.HasPrefix(ifname, "vlan") || strings.HasPrefix(ifname, "eth") {
		return true
	}
	return ip[0] == 160 && ip[1] == 48 // BMW's internal 160.48.0.0/16
}

// scanTargets: every address of a /24 around each of the unit's own IPv4 addresses on a Wi-Fi / tethering network
// (not the car's internal ones), with port, the unit's own left out.
func scanTargets(addrs []net.IPNet, names []string, port string) []string {
	var out []string
	seen := map[string]bool{}
	for i, a := range addrs {
		ip := a.IP.To4()
		if ip == nil || carNet(ip, names[i]) {
			continue
		}
		for h := 1; h < 255; h++ {
			t := net.IPv4(ip[0], ip[1], ip[2], byte(h)).String()
			if t == ip.String() || seen[t] {
				continue
			}
			seen[t] = true
			out = append(out, net.JoinHostPort(t, port))
		}
	}
	return out
}

// ownNets: the unit's IPv4 addresses with their interface names.
func ownNets() ([]net.IPNet, []string) {
	var addrs []net.IPNet
	var names []string
	ifs, _ := net.Interfaces()
	for _, ifc := range ifs {
		if ifc.Flags&net.FlagUp == 0 || ifc.Flags&net.FlagLoopback != 0 {
			continue
		}
		as, _ := ifc.Addrs()
		for _, a := range as {
			if n, ok := a.(*net.IPNet); ok && n.IP.To4() != nil {
				addrs = append(addrs, *n)
				names = append(names, ifc.Name)
			}
		}
	}
	return addrs, names
}

// phoneWifiAddrs: the phone's Wi-Fi addresses from `ip -o -4 addr show` (wlan*, swlan* = its hotspot, ap*), not mobile
// data or USB tethering.
func phoneWifiAddrs(out string) []string {
	var ips []string
	for _, l := range strings.Split(out, "\n") {
		f := strings.Fields(l)
		if len(f) < 4 || f[2] != "inet" {
			continue
		}
		name := strings.TrimSuffix(f[1], ":")
		if !(strings.HasPrefix(name, "wlan") || strings.HasPrefix(name, "swlan") || strings.HasPrefix(name, "ap")) {
			continue
		}
		ip, _, err := net.ParseCIDR(f[3])
		if err == nil && ip.To4() != nil && !ip.IsLoopback() {
			ips = append(ips, ip.String())
		}
	}
	return ips
}

// probe: one TCP connect to addr, as a word: open, refused, timeout or unreach.
func probe(addr string, timeout time.Duration) string {
	c, err := net.DialTimeout("tcp", addr, timeout)
	if err == nil {
		c.Close()
		return "open"
	}
	return dialError(err)
}

func dialError(err error) string {
	if ne, ok := err.(net.Error); ok && ne.Timeout() {
		return "timeout"
	}
	switch {
	case errors.Is(err, syscall.ECONNREFUSED):
		return "refused"
	case errors.Is(err, syscall.ENETUNREACH), errors.Is(err, syscall.EHOSTUNREACH):
		return "unreach"
	}
	return "timeout"
}
