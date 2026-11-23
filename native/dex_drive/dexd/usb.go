// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Zakhar Vityk
//
// usb.go - ADB over USB through usbfs (/dev/bus/usb), no libusb: finds a phone's ADB interface (class 0xff,
// subclass 0x42, protocol 0x01) in sysfs, claims only that interface (the car keeps MTP, media and the rest)
// and moves packets over its two bulk endpoints.
package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"unsafe"
)

const (
	usbdevfsBulk             = 0xc0185502 // _IOWR('U', 2, struct usbdevfs_bulktransfer) on 64-bit
	usbdevfsClaimInterface   = 0x8004550f // _IOR('U', 15, unsigned int)
	usbdevfsReleaseInterface = 0x80045510 // _IOR('U', 16, unsigned int)
	usbdevfsClearHalt        = 0x80045515 // _IOR('U', 21, unsigned int)
	usbChunk                 = 16384      // per bulk ioctl: what old kernels' usbfs takes
)

type usbBulk struct {
	ep      uint32
	len     uint32
	timeout uint32
	_       uint32
	data    uintptr
}

// UsbAdb describes a phone's ADB interface found in sysfs.
type UsbAdb struct {
	SysPath     string // /sys/bus/usb/devices/1-1:1.2
	DevNode     string // /dev/bus/usb/001/004
	Iface       int
	EpIn, EpOut uint32
	MaxPacket   int
	Vendor      string
	Product     string
	Serial      string
}

func readSys(dir, name string) string {
	b, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

// FindUsbAdb lists the ADB interfaces of plugged-in devices. sysRoot: /sys/bus/usb/devices.
func FindUsbAdb(sysRoot string) []UsbAdb {
	var out []UsbAdb
	ents, _ := os.ReadDir(sysRoot)
	for _, e := range ents {
		name := e.Name()
		if !strings.Contains(name, ":") {
			continue
		}
		dir := filepath.Join(sysRoot, name)
		if readSys(dir, "bInterfaceClass") != "ff" || readSys(dir, "bInterfaceSubClass") != "42" || readSys(dir, "bInterfaceProtocol") != "01" {
			continue
		}
		devDir := filepath.Join(sysRoot, name[:strings.Index(name, ":")])
		bus, _ := strconv.Atoi(readSys(devDir, "busnum"))
		dev, _ := strconv.Atoi(readSys(devDir, "devnum"))
		ifn, _ := strconv.ParseInt(readSys(dir, "bInterfaceNumber"), 16, 32)
		u := UsbAdb{SysPath: dir, DevNode: fmt.Sprintf("/dev/bus/usb/%03d/%03d", bus, dev), Iface: int(ifn),
			Vendor: readSys(devDir, "idVendor"), Product: readSys(devDir, "product"), Serial: readSys(devDir, "serial")}
		eps, _ := os.ReadDir(dir)
		for _, ep := range eps {
			if !strings.HasPrefix(ep.Name(), "ep_") {
				continue
			}
			epDir := filepath.Join(dir, ep.Name())
			if readSys(epDir, "type") != "Bulk" {
				continue
			}
			addr, _ := strconv.ParseUint(readSys(epDir, "bEndpointAddress"), 16, 8)
			mp, _ := strconv.ParseInt(readSys(epDir, "wMaxPacketSize"), 16, 32)
			if readSys(epDir, "direction") == "in" {
				u.EpIn = uint32(addr)
			} else {
				u.EpOut = uint32(addr)
			}
			if int(mp) > u.MaxPacket {
				u.MaxPacket = int(mp)
			}
		}
		// a kernel driver on it: someone else's
		if _, err := os.Lstat(filepath.Join(dir, "driver")); err == nil {
			continue
		}
		if u.EpIn != 0 && u.EpOut != 0 && bus > 0 && dev > 0 {
			if u.MaxPacket <= 0 {
				u.MaxPacket = 512
			}
			out = append(out, u)
		}
	}
	return out
}

type usbTransport struct {
	u    UsbAdb
	fd   int
	wmu  sync.Mutex
	rmu  sync.Mutex
	shut chan struct{}
	once sync.Once
}

// OpenUsb claims the ADB interface.
func OpenUsb(u UsbAdb) (Transport, error) {
	fd, err := syscall.Open(u.DevNode, syscall.O_RDWR|syscall.O_CLOEXEC, 0)
	if err != nil {
		return nil, fmt.Errorf("open %s: %v", u.DevNode, err)
	}
	ifn := uint32(u.Iface)
	if _, _, e := syscall.Syscall(syscall.SYS_IOCTL, uintptr(fd), usbdevfsClaimInterface, uintptr(unsafe.Pointer(&ifn))); e != 0 {
		syscall.Close(fd)
		if e == syscall.EBUSY {
			return nil, fmt.Errorf("the phone's ADB interface is taken by another program")
		}
		return nil, fmt.Errorf("claim interface %d: %v", u.Iface, e)
	}
	for _, ep := range []uint32{u.EpIn, u.EpOut} {
		e := ep
		syscall.Syscall(syscall.SYS_IOCTL, uintptr(fd), usbdevfsClearHalt, uintptr(unsafe.Pointer(&e)))
	}
	return &usbTransport{u: u, fd: fd, shut: make(chan struct{})}, nil
}

func (t *usbTransport) Name() string { return "usb " + t.u.DevNode }

func (t *usbTransport) bulk(ep uint32, b []byte, timeoutMs uint32) (int, error) {
	var p uintptr
	if len(b) > 0 {
		p = uintptr(unsafe.Pointer(&b[0]))
	}
	x := usbBulk{ep: ep, len: uint32(len(b)), timeout: timeoutMs, data: p}
	r, _, e := syscall.Syscall(syscall.SYS_IOCTL, uintptr(t.fd), usbdevfsBulk, uintptr(unsafe.Pointer(&x)))
	if e != 0 {
		return 0, e
	}
	return int(r), nil
}

var errUsbClosed = errors.New("usb closed")

// readFull reads n bytes from the IN endpoint, in chunks a multiple of the packet size.
func (t *usbTransport) readExact(n int, firstTimeoutMs uint32) ([]byte, error) {
	buf := make([]byte, n)
	got := 0
	for got < n {
		select {
		case <-t.shut:
			return nil, errUsbClosed
		default:
		}
		want := n - got
		if want > usbChunk {
			want = usbChunk
		}
		to := uint32(5000)
		if got == 0 {
			to = firstTimeoutMs
		}
		r, err := t.bulk(t.u.EpIn, buf[got:got+want], to)
		if err == syscall.ETIMEDOUT && got == 0 {
			continue // nothing came: wait again (a header is one packet, nothing is lost)
		}
		if err != nil {
			return nil, err
		}
		got += r
		if r < want && got < n {
			// a short packet ends a transfer: the rest comes in the next one
			continue
		}
	}
	return buf, nil
}

func (t *usbTransport) ReadPacket() (*Packet, error) {
	t.rmu.Lock()
	defer t.rmu.Unlock()
	for {
		h, err := t.readExact(headerSize, 1000)
		if err != nil {
			return nil, err
		}
		p, n, err := decodeHeader(h)
		if err != nil {
			// out of step (a stale transfer): look for the next header
			continue
		}
		if n > 0 {
			d, err := t.readExact(n, 5000)
			if err != nil {
				return nil, err
			}
			p.Data = d
		}
		return p, nil
	}
}

func (t *usbTransport) write(b []byte) error {
	for len(b) > 0 {
		n := len(b)
		if n > usbChunk {
			n = usbChunk
		}
		if _, err := t.bulk(t.u.EpOut, b[:n], 5000); err != nil {
			return err
		}
		b = b[n:]
	}
	return nil
}

func (t *usbTransport) WritePacket(p *Packet) error {
	t.wmu.Lock()
	defer t.wmu.Unlock()
	select {
	case <-t.shut:
		return errUsbClosed
	default:
	}
	if err := t.write(encodeHeader(p)); err != nil {
		return err
	}
	if len(p.Data) > 0 {
		if err := t.write(p.Data); err != nil {
			return err
		}
		// a payload of whole packets is ended by a zero-length packet, as adb does
		if len(p.Data)%t.u.MaxPacket == 0 {
			if _, err := t.bulk(t.u.EpOut, nil, 1000); err != nil {
				return err
			}
		}
	}
	return nil
}

func (t *usbTransport) Close() error {
	t.once.Do(func() {
		close(t.shut)
		go func() {
			// a read in flight ends within its 1 s timeout; then the interface goes back
			t.rmu.Lock()
			ifn := uint32(t.u.Iface)
			syscall.Syscall(syscall.SYS_IOCTL, uintptr(t.fd), usbdevfsReleaseInterface, uintptr(unsafe.Pointer(&ifn)))
			syscall.Close(t.fd)
			t.rmu.Unlock()
		}()
	})
	return nil
}

// usbGone: the device node has gone (unplugged).
func usbGone(u UsbAdb) bool {
	_, err := os.Stat(u.DevNode)
	return err != nil
}
