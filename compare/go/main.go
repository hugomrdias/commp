// CLI around go-fil-commp-hashhash for compare/run.js. compare/rust and
// compare/wasm.js implement the same commands and output formats, so the
// driver treats all three alike:
//
//	info                          JSON: runtime and SHA-256 backend
//	gen <random|zero|0xCC> <size> write a Lotus test payload to stdout
//	hash                          stdin -> "<root hex> <padded size>"
//	frames                        [u64le length][payload]... -> one line each
//	bench <size> <iters> <buf> <chunk>
//	                              JSON: hash <size> bytes of a <buf>-byte
//	                              xorshift32 buffer, repeated, <iters> times
package main

import (
	"bufio"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	randmath "math/rand"
	"os"
	"runtime"
	"runtime/debug"
	"strconv"
	"strings"
	"syscall"
	"time"

	commp "github.com/filecoin-project/go-fil-commp-hashhash"
	"github.com/klauspost/cpuid/v2"
)

// Stdin is fed to the hasher in this cycle of sizes to exercise partial quads
var readSizes = []int{1, 31, 127, 128, 1000, 4096, 65536, 1 << 20}

func main() {
	if len(os.Args) < 2 {
		fail("usage: commp-go <info|gen|hash|frames|bench> ...")
	}
	args := os.Args[2:]
	switch os.Args[1] {
	case "info":
		printJSON(info())
	case "gen":
		gen(os.Stdout, args[0], parseInt(args[1]))
	case "hash":
		root, padded, err := hashReader(bufio.NewReaderSize(os.Stdin, 1<<20), -1)
		printResult(root, padded, err)
	case "frames":
		frames()
	case "bench":
		bench(parseInt(args[0]), int(parseInt(args[1])), parseInt(args[2]), parseInt(args[3]))
	default:
		fail("unknown command " + os.Args[1])
	}
}

func info() map[string]any {
	return map[string]any{
		"impl":       "go",
		"backend":    shaBackend(),
		"runtime":    runtime.Version(),
		"os":         runtime.GOOS,
		"arch":       runtime.GOARCH,
		"numCPU":     runtime.NumCPU(),
		"gomaxprocs": runtime.GOMAXPROCS(0),
		"godebug":    os.Getenv("GODEBUG"),
		"deps":       deps(),
	}
}

// deps is the version of each module linked in, as the binary records it
func deps() map[string]string {
	out := map[string]string{}
	bi, ok := debug.ReadBuildInfo()
	if !ok {
		return out
	}
	for _, m := range bi.Deps {
		switch {
		case m.Replace != nil && (m.Replace.Version == "" || m.Replace.Version == "(devel)"):
			out[m.Path] = "=> " + m.Replace.Path
		case m.Replace != nil:
			out[m.Path] = m.Replace.Version
		default:
			out[m.Path] = m.Version
		}
	}
	return out
}

// stdlibBackend is the block function crypto/sha256 picks (see
// crypto/internal/fips140/sha256/sha256block_{amd64,arm64}.go), after
// GODEBUG=cpu.<name>=off as internal/cpu applies it
func stdlibBackend() string {
	has := func(name string, detected bool) bool {
		enabled := detected
		for _, field := range strings.Split(os.Getenv("GODEBUG"), ",") {
			key, value, ok := strings.Cut(strings.TrimPrefix(field, "cpu."), "=")
			if ok && strings.HasPrefix(field, "cpu.") && (key == name || key == "all") {
				enabled = detected && value == "on"
			}
		}
		return enabled
	}
	switch runtime.GOARCH {
	case "amd64":
		avx := has("avx", cpuid.CPU.Has(cpuid.AVX))
		if avx && has("sha", cpuid.CPU.Has(cpuid.SHA)) && has("sse41", cpuid.CPU.Has(cpuid.SSE4)) && has("ssse3", cpuid.CPU.Has(cpuid.SSSE3)) {
			return "SHA-NI"
		}
		if avx && has("avx2", cpuid.CPU.Has(cpuid.AVX2)) && has("bmi2", cpuid.CPU.Has(cpuid.BMI2)) {
			return "AVX2"
		}
		return "generic"
	case "arm64":
		// internal/cpu always reports SHA2 on darwin/arm64
		if has("sha2", cpuid.CPU.Has(cpuid.SHA2) || runtime.GOOS == "darwin") {
			return "ARMv8"
		}
		return "generic"
	}
	return "asm-or-generic"
}

// gen writes the payloads behind go-fil-commp-hashhash's testdata vectors,
// generated like its commp_test.go (and jbenet/go-random, which Lotus used)
func gen(w io.Writer, kind string, size int64) {
	out := bufio.NewWriterSize(w, 1<<20)
	defer out.Flush()
	switch kind {
	case "zero", "0xCC":
		b := byte(0)
		if kind == "0xCC" {
			b = 0xCC
		}
		block := make([]byte, 1<<20)
		for i := range block {
			block[i] = b
		}
		for size > 0 {
			n := min(size, int64(len(block)))
			must(out.Write(block[:n]))
			size -= n
		}
	case "random":
		rand := randmath.New(randmath.NewSource(1337))
		bufsize := int64(1024 * 1024 * 4)
		b := make([]byte, bufsize)
		for size > 0 {
			if bufsize > size {
				bufsize = size
				b = b[:bufsize]
			}
			var n uint32
			for i := int64(0); i < bufsize; {
				n = rand.Uint32()
				for j := 0; j < 4 && i < bufsize; j++ {
					b[i] = byte(n & 0xff)
					n >>= 8
					i++
				}
			}
			size -= bufsize
			must(out.Write(b))
		}
	default:
		fail("unknown payload kind " + kind)
	}
}

// hashReader hashes r (limit bytes, or to EOF if limit < 0), reading in the
// readSizes cycle
func hashReader(r io.Reader, limit int64) ([]byte, uint64, error) {
	cp := &commp.Calc{}
	buf := make([]byte, readSizes[len(readSizes)-1])
	for i := 0; limit != 0; i++ {
		n := int64(readSizes[i%len(readSizes)])
		if limit > 0 {
			n = min(n, limit)
		}
		read, err := io.ReadFull(r, buf[:n])
		if read > 0 {
			if _, werr := cp.Write(buf[:read]); werr != nil {
				cp.Reset()
				return nil, 0, werr
			}
		}
		if limit > 0 {
			limit -= int64(read)
		}
		if err == io.EOF || err == io.ErrUnexpectedEOF {
			if limit > 0 {
				fail("unexpected end of input")
			}
			break
		}
		if err != nil {
			fail(err.Error())
		}
	}
	root, padded, err := cp.Digest()
	if err != nil {
		cp.Reset()
	}
	return root, padded, err
}

func frames() {
	in := bufio.NewReaderSize(os.Stdin, 1<<20)
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	var header [8]byte
	for {
		if _, err := io.ReadFull(in, header[:]); err == io.EOF {
			return
		} else if err != nil {
			fail(err.Error())
		}
		root, padded, err := hashReader(in, int64(binary.LittleEndian.Uint64(header[:])))
		writeResult(out, root, padded, err)
	}
}

type run struct {
	Wall       float64 `json:"wall"`
	User       float64 `json:"user"`
	Sys        float64 `json:"sys"`
	AllocBytes uint64  `json:"allocBytes"`
	Allocs     uint64  `json:"allocs"`
}

func bench(size int64, iters int, bufSize int64, chunk int64) {
	buf := xorshiftBuffer(bufSize)
	// Warm up the goroutines' stacks, caches and the CPU clock
	hashBuffer(buf, min(size, 8<<20), chunk)
	runtime.GC()
	rssBase := maxRSS()

	var root []byte
	var padded uint64
	runs := make([]run, 0, iters)
	for range iters {
		var ms0, ms1 runtime.MemStats
		runtime.ReadMemStats(&ms0)
		ru0 := rusage()
		start := time.Now()
		root, padded = hashBuffer(buf, size, chunk)
		wall := time.Since(start).Seconds()
		ru1 := rusage()
		runtime.ReadMemStats(&ms1)
		runs = append(runs, run{
			Wall:       wall,
			User:       seconds(ru1.Utime) - seconds(ru0.Utime),
			Sys:        seconds(ru1.Stime) - seconds(ru0.Stime),
			AllocBytes: ms1.TotalAlloc - ms0.TotalAlloc,
			Allocs:     ms1.Mallocs - ms0.Mallocs,
		})
	}

	result := info()
	result["size"] = size
	result["chunk"] = chunk
	result["buf"] = bufSize
	result["root"] = hex.EncodeToString(root)
	result["padded"] = padded
	result["rssBase"] = rssBase
	result["rssPeak"] = maxRSS()
	result["runs"] = runs
	printJSON(result)
}

// hashBuffer hashes size bytes of buf repeated, written chunk bytes at a time
func hashBuffer(buf []byte, size, chunk int64) ([]byte, uint64) {
	cp := &commp.Calc{}
	bufSize := int64(len(buf))
	for off := int64(0); off < size; {
		pos := off % bufSize
		n := min(chunk, bufSize-pos, size-off)
		must(cp.Write(buf[pos : pos+n]))
		off += n
	}
	root, padded, err := cp.Digest()
	if err != nil {
		fail(err.Error())
	}
	return root, padded
}

// xorshift32 (13, 17, 5) from seed 0x9E3779B9, little-endian words
func xorshiftBuffer(size int64) []byte {
	buf := make([]byte, (size+3)&^3)
	x := uint32(0x9E3779B9)
	for i := 0; i < len(buf); i += 4 {
		x ^= x << 13
		x ^= x >> 17
		x ^= x << 5
		binary.LittleEndian.PutUint32(buf[i:], x)
	}
	return buf[:size]
}

func rusage() syscall.Rusage {
	var ru syscall.Rusage
	if err := syscall.Getrusage(syscall.RUSAGE_SELF, &ru); err != nil {
		fail(err.Error())
	}
	return ru
}

// maxRSS is the peak resident set size in bytes (Linux reports KiB)
func maxRSS() int64 {
	rss := int64(rusage().Maxrss)
	if runtime.GOOS == "linux" {
		rss *= 1024
	}
	return rss
}

func seconds(tv syscall.Timeval) float64 {
	return float64(tv.Sec) + float64(tv.Usec)/1e6
}

func printResult(root []byte, padded uint64, err error) {
	out := bufio.NewWriter(os.Stdout)
	defer out.Flush()
	writeResult(out, root, padded, err)
}

func writeResult(w io.Writer, root []byte, padded uint64, err error) {
	if err != nil {
		fmt.Fprintf(w, "error: %s\n", strings.ReplaceAll(err.Error(), "\n", " "))
		return
	}
	fmt.Fprintf(w, "%x %d\n", root, padded)
}

func printJSON(v any) {
	enc := json.NewEncoder(os.Stdout)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		fail(err.Error())
	}
}

func parseInt(s string) int64 {
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		fail(err.Error())
	}
	return n
}

func must[T any](_ T, err error) {
	if err != nil {
		fail(err.Error())
	}
}

func fail(msg string) {
	fmt.Fprintln(os.Stderr, "commp-go:", msg)
	os.Exit(1)
}
