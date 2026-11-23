// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Zakhar Vityk
//
// adbauth.go - the head unit's ADB key: RSA 2048, made once and kept (root only), signs the phone's token
// (PKCS#1 v1.5 over the token as a SHA-1 digest, as adb does) and gives the public key in Android's format
// (mincrypt RSAPublicKey, base64, " name").
package main

import (
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/binary"
	"encoding/pem"
	"errors"
	"math/big"
	"os"
	"path/filepath"
)

// AdbKey is the unit's identity towards phones.
type AdbKey struct {
	priv *rsa.PrivateKey
	Name string // shown on the phone: "Allow USB debugging? ... from <name>"
}

// LoadOrCreateKey reads path (PEM, PKCS#1), or makes a new key there (0600, its folder 0700).
func LoadOrCreateKey(path, name string) (*AdbKey, bool, error) {
	if b, err := os.ReadFile(path); err == nil {
		blk, _ := pem.Decode(b)
		if blk != nil {
			if k, err := x509.ParsePKCS1PrivateKey(blk.Bytes); err == nil && k.N.BitLen() == 2048 {
				return &AdbKey{priv: k, Name: name}, false, nil
			}
		}
	}
	k, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, false, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, false, err
	}
	tmp := path + ".tmp"
	b := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(k)})
	if err := os.WriteFile(tmp, b, 0o600); err != nil {
		return nil, false, err
	}
	if err := os.Rename(tmp, path); err != nil {
		return nil, false, err
	}
	return &AdbKey{priv: k, Name: name}, true, nil
}

// Sign answers an AUTH token.
func (k *AdbKey) Sign(token []byte) ([]byte, error) {
	if len(token) != 20 {
		return nil, errors.New("AUTH token is not 20 bytes")
	}
	return rsa.SignPKCS1v15(nil, k.priv, crypto.SHA1, token)
}

// AndroidPublic is the public key as adbd keeps it in /data/misc/adb/adb_keys, NUL-terminated.
func (k *AdbKey) AndroidPublic() []byte {
	return append([]byte(androidPubKey(&k.priv.PublicKey)+" "+k.Name), 0)
}

func androidPubKey(pub *rsa.PublicKey) string {
	const words = 64 // 2048 bits
	b := make([]byte, 4+4+words*4+words*4+4)
	binary.LittleEndian.PutUint32(b[0:], words)
	n := pub.N
	two32 := new(big.Int).Lsh(big.NewInt(1), 32)
	// n0inv = -1 / n mod 2^32
	n0 := new(big.Int).Mod(n, two32)
	inv := new(big.Int).ModInverse(n0, two32)
	n0inv := new(big.Int).Sub(two32, inv)
	binary.LittleEndian.PutUint32(b[4:], uint32(n0inv.Uint64()))
	putWords(b[8:], n, words)
	rr := new(big.Int).Lsh(big.NewInt(1), words*32*2)
	rr.Mod(rr, n)
	putWords(b[8+words*4:], rr, words)
	binary.LittleEndian.PutUint32(b[8+words*8:], uint32(pub.E))
	return base64.StdEncoding.EncodeToString(b)
}

// putWords writes x as `words` little-endian 32-bit words, least significant first.
func putWords(dst []byte, x *big.Int, words int) {
	be := x.FillBytes(make([]byte, words*4))
	for i := 0; i < words*4; i++ {
		dst[i] = be[len(be)-1-i]
	}
}
