//go:build stdlibsha

package main

func shaBackend() string { return "crypto/sha256/" + stdlibBackend() }
