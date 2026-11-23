// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Zakhar Vityk
//
// sync.go - adb push over the "sync:" service (SEND / DATA / DONE, answered by OKAY or FAIL).
package main

import (
	"encoding/binary"
	"fmt"
	"io"
	"time"
)

const syncDataMax = 64 * 1024

func syncHeader(id string, n uint32) []byte {
	b := make([]byte, 8)
	copy(b, id)
	binary.LittleEndian.PutUint32(b[4:], n)
	return b
}

// Push writes data to path on the phone with mode (e.g. 0644).
func (c *Conn) Push(path string, data []byte, mode uint32, mtime time.Time) error {
	s, err := c.Open("sync:", 5*time.Second)
	if err != nil {
		return err
	}
	defer s.Close()
	spec := fmt.Sprintf("%s,%d", path, 0o100000|mode)
	msg := append(syncHeader("SEND", uint32(len(spec))), spec...)
	for off := 0; off < len(data); off += syncDataMax {
		end := off + syncDataMax
		if end > len(data) {
			end = len(data)
		}
		msg = append(msg, syncHeader("DATA", uint32(end-off))...)
		msg = append(msg, data[off:end]...)
		if len(msg) >= 4*syncDataMax {
			if _, err := s.Write(msg); err != nil {
				return err
			}
			msg = msg[:0]
		}
	}
	msg = append(msg, syncHeader("DONE", uint32(mtime.Unix()))...)
	if _, err := s.Write(msg); err != nil {
		return err
	}
	resp := make([]byte, 8)
	if _, err := io.ReadFull(s, resp); err != nil {
		return fmt.Errorf("push %s: %v", path, err)
	}
	switch string(resp[:4]) {
	case "OKAY":
		s.Write(syncHeader("QUIT", 0))
		return nil
	case "FAIL":
		n := binary.LittleEndian.Uint32(resp[4:])
		why := make([]byte, n)
		io.ReadFull(s, why)
		return fmt.Errorf("push %s: %s", path, why)
	}
	return fmt.Errorf("push %s: answer %q", path, resp[:4])
}
