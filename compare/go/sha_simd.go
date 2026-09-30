//go:build !stdlibsha

package main

import (
	"bytes"
	"os"
	"runtime"

	"github.com/klauspost/cpuid/v2"
)

// shaBackend mirrors sha256-simd's own dispatch (sha256.go init and
// cpuid_other.go): SHA-NI on amd64, ARMv8 SHA2 on arm64, otherwise it hands
// over to crypto/sha256.
func shaBackend() string {
	if runtime.GOARCH == "amd64" && cpuid.CPU.Supports(cpuid.SHA, cpuid.SSSE3, cpuid.SSE4) {
		return "sha256-simd/SHA-NI"
	}
	if cpuid.CPU.Has(cpuid.SHA2) {
		return "sha256-simd/ARMv8"
	}
	if runtime.GOARCH == "arm64" && runtime.GOOS == "linux" {
		if info, err := os.ReadFile("/proc/cpuinfo"); err == nil && bytes.Contains(info, []byte("sha2")) {
			return "sha256-simd/ARMv8"
		}
	}
	return "sha256-simd/fallback:" + stdlibBackend()
}
