package auth

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"

	"golang.org/x/crypto/argon2"
)

const (
	argonTime    = 3
	argonMemory  = 64 * 1024
	argonThreads = 4
	argonKeyLen  = 32
	saltLen      = 16
)

func HashPassword(password string) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	enc := base64.RawStdEncoding.EncodeToString(append(append([]byte{}, salt...), hash...))
	return enc, nil
}

func VerifyPassword(password, encoded string) (bool, error) {
	raw, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil || len(raw) < saltLen+argonKeyLen {
		return false, fmt.Errorf("invalid hash")
	}
	salt := raw[:saltLen]
	want := raw[saltLen:]
	got := argon2.IDKey([]byte(password), salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	if len(got) != len(want) {
		return false, nil
	}
	var v byte
	for i := range want {
		v |= got[i] ^ want[i]
	}
	return v == 0, nil
}
