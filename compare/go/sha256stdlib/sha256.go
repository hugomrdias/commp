// Package sha256 stands in for github.com/minio/sha256-simd (see
// go.stdlib.mod) so go-fil-commp-hashhash hashes with crypto/sha256. Unlike
// sha256-simd, crypto/sha256 picks its backend from internal/cpu, which
// honours GODEBUG=cpu.<feature>=off, so SHA-NI, AVX2 and ARMv8 SHA2 can be
// turned off at run time.
package sha256

import (
	"crypto/sha256"
	"hash"
)

const (
	Size      = sha256.Size
	BlockSize = sha256.BlockSize
)

func New() hash.Hash { return sha256.New() }

func Sum256(data []byte) [Size]byte { return sha256.Sum256(data) }
