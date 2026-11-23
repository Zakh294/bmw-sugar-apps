// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Zakhar Vityk
/* dexdec: the video half of DeX Drive (BMW iDrive 7 MGU, Apollo Lake, Intel HD 505).
 *
 * Reads the phone's live H.264 screen stream (scrcpy-server's packets, as
 * dex-drive-d passes them on) from stdin, decodes it on the GPU with the
 * unit's Intel Media SDK (decoder_msdk.cpp, from waze-on-cluster through
 * RideTube's ytdec) and writes I420 frames to mgu-render's video file
 * (MGVF, mgu-render PROTOCOL.md "Video"), at the stream's own size, as soon
 * as each frame is decoded: no clock, no pacing, the lowest latency.
 *
 *   dexdec --out /dev/shm/mgu-video-dexdrive [--dev /dev/dri/renderD128]
 *          [--display-order] [--log <file>]
 *
 * stdin, one packet after another (little endian):
 *   u32 length, u8 flags (1: config = SPS/PPS, 2: key frame), then length
 *   bytes of Annex-B. A config packet is kept and put in front of the next
 *   packet (scrcpy sends it alone). length 0 with flags 0xff, or EOF: quit.
 *
 * stdout, JSON lines:
 *   {"ev":"ready"}                                    the decoder is up
 *   {"ev":"size","w":W,"h":H}                         the video file now holds W x H frames
 *   {"ev":"stats","decoded":N,"errors":N,"fps":x}     every 2 s while frames come
 *   {"ev":"error","msg":"..."}
 *
 * Exit codes: 0 quit / EOF, 1 decoder init failed, 2 bad arguments or the
 * video file, 3 a broken packet on stdin, 70 fatal signal.
 *
 * Built with DEXDEC_FAKE (host tests): no Media SDK; every picture "decodes"
 * to one grey frame of the size named in its last 4 bytes (u16 w, u16 h). */
#include "mgvf.h"
#ifndef DEXDEC_FAKE
#include "decoder_msdk.h"
#endif

#include <errno.h>
#include <signal.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <time.h>
#include <unistd.h>

#include <string>
#include <vector>

namespace {

FILE *g_log = stderr;

double now_s()
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec + ts.tv_nsec / 1e9;
}

void logf(const char *fmt, ...)
{
    time_t t = time(nullptr);
    char stamp[32];
    strftime(stamp, sizeof stamp, "%Y-%m-%d %H:%M:%S", localtime(&t));
    fprintf(g_log, "%s dexdec: ", stamp);
    va_list ap;
    va_start(ap, fmt);
    vfprintf(g_log, fmt, ap);
    va_end(ap);
    fputc('\n', g_log);
    fflush(g_log);
}

std::string json_str(const std::string &s)
{
    std::string o = "\"";
    for (char c : s) {
        if (c == '"' || c == '\\') {
            o += '\\';
            o += c;
        } else if ((unsigned char)c < 0x20) {
            char b[8];
            snprintf(b, sizeof b, "\\u%04x", c);
            o += b;
        } else {
            o += c;
        }
    }
    return o + "\"";
}

void emit(const std::string &line)
{
    fputs(line.c_str(), stdout);
    fputc('\n', stdout);
    fflush(stdout);
}

void emit_error(const std::string &msg)
{
    logf("error: %s", msg.c_str());
    emit("{\"ev\":\"error\",\"msg\":" + json_str(msg) + "}");
}

bool read_full(void *buf, size_t n)
{
    uint8_t *p = (uint8_t *)buf;
    while (n) {
        ssize_t r = read(0, p, n);
        if (r < 0 && errno == EINTR)
            continue;
        if (r <= 0)
            return false;
        p += r;
        n -= (size_t)r;
    }
    return true;
}

void on_fatal(int sig)
{
    static const char m[] = "dexdec: fatal signal\n";
    ssize_t w = write(2, m, sizeof m - 1);
    (void)w;
    (void)sig;
    _exit(70);
}

struct Out {
    ytdec::Mgvf mgvf;
    std::string path;
    uint64_t decoded = 0, errors = 0;
    uint64_t shown_window = 0;
    double window_t0 = 0;

    bool frame(uint32_t w, uint32_t h, const uint8_t *y, const uint8_t *uv, size_t pitch)
    {
        if (mgvf.w() != w || mgvf.h() != h) {
            std::string err, warn;
            if (!mgvf.open(path.c_str(), w, h, 3, &err, &warn)) {
                emit_error("video file " + path + ": " + err);
                return false;
            }
            if (!warn.empty())
                logf("%s", warn.c_str());
            logf("video file %s: %ux%u", path.c_str(), w, h);
            emit("{\"ev\":\"size\",\"w\":" + std::to_string(w) + ",\"h\":" + std::to_string(h) + "}");
        }
        uint8_t *dst = mgvf.begin();
        if (y && uv) {
            ytdec::nv12_to_i420(y, uv, pitch, w, h, dst);
        } else {
            memset(dst, 120, (size_t)w * h);
            memset(dst + (size_t)w * h, 128, (size_t)w * h / 2);
        }
        mgvf.commit();
        decoded++;
        shown_window++;
        return true;
    }

    void stats(bool force)
    {
        double t = now_s();
        if (window_t0 == 0)
            window_t0 = t;
        if (!force && t - window_t0 < 2.0)
            return;
        double fps = t > window_t0 ? shown_window / (t - window_t0) : 0;
        char b[160];
        snprintf(b, sizeof b, "{\"ev\":\"stats\",\"decoded\":%llu,\"errors\":%llu,\"fps\":%.1f}",
                 (unsigned long long)decoded, (unsigned long long)errors, fps);
        emit(b);
        window_t0 = t;
        shown_window = 0;
    }
};

}  // namespace

int main(int argc, char **argv)
{
    prctl(PR_SET_DUMPABLE, 0);
    struct rlimit nocore = {0, 0};
    setrlimit(RLIMIT_CORE, &nocore);
    signal(SIGPIPE, SIG_IGN);
    const int fatal[] = {SIGSEGV, SIGBUS, SIGFPE, SIGILL, SIGABRT, SIGQUIT, SIGTRAP, SIGSYS};
    for (int s : fatal)
        signal(s, on_fatal);

    Out out;
    out.path = "/dev/shm/mgu-video-dexdrive";
    const char *dev = "/dev/dri/renderD128";
    bool display_order = false;
    for (int i = 1; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--out" && i + 1 < argc) {
            out.path = argv[++i];
        } else if (a == "--dev" && i + 1 < argc) {
            dev = argv[++i];
        } else if (a == "--display-order") {
            display_order = true;
        } else if (a == "--log" && i + 1 < argc) {
            FILE *f = fopen(argv[++i], "a");
            if (f)
                g_log = f;
        } else {
            fprintf(stderr, "usage: dexdec --out <mgvf file> [--dev <render node>] [--display-order] [--log <file>]\n");
            return 2;
        }
    }
    if (out.path.find("/dev/shm/mgu-video-") != 0 && getenv("DEXDEC_ANY_PATH") == nullptr) {
        fprintf(stderr, "dexdec: --out must be /dev/shm/mgu-video-<name>\n");
        return 2;
    }

#ifndef DEXDEC_FAKE
    woc::Decoder dec;
    std::string err;
    if (!dec.init(dev, 0, 0, false, &err)) {
        emit_error("decoder init: " + err);
        return 1;
    }
    dec.set_decode_order(!display_order);
    logf("decoder up on %s (%s order)", dev, display_order ? "display" : "decoding");
#else
    (void)dev;
    (void)display_order;
    logf("fake decoder (host test build)");
#endif
    emit("{\"ev\":\"ready\"}");

    std::vector<uint8_t> config, buf;
    for (;;) {
        uint8_t head[5];
        if (!read_full(head, sizeof head))
            break;
        uint32_t len = (uint32_t)head[0] | (uint32_t)head[1] << 8 | (uint32_t)head[2] << 16 | (uint32_t)head[3] << 24;
        uint8_t flags = head[4];
        if (len == 0 && flags == 0xff)
            break;
        if (len > (16u << 20)) {
            emit_error("packet of " + std::to_string(len) + " bytes: the stream is broken");
            return 3;
        }
        buf.resize(len);
        if (len && !read_full(buf.data(), len)) {
            emit_error("stdin ended inside a packet");
            return 3;
        }
        if (flags & 1) {
            /* SPS/PPS alone: goes in front of the next picture */
            config.assign(buf.begin(), buf.end());
            continue;
        }
        if (!config.empty()) {
            buf.insert(buf.begin(), config.begin(), config.end());
            config.clear();
        }
#ifndef DEXDEC_FAKE
        bool ok_frame = true;
        bool fed = dec.feed(buf.data(), buf.size(), [&](const woc::VideoFrame &f) {
            if (!f.y)
                return;
            if (!out.frame(f.w, f.h, f.y, f.uv, f.pitch))
                ok_frame = false;
        }, &err, true, true, -1);
        if (!fed) {
            out.errors++;
            if (out.errors < 20 || out.errors % 100 == 0)
                logf("decode: %s", err.c_str());
        }
        if (!ok_frame)
            return 2;
#else
        if (buf.size() >= 4) {
            const uint8_t *e = buf.data() + buf.size() - 4;
            uint32_t w = e[0] | e[1] << 8, h = e[2] | e[3] << 8;
            if (!out.frame(w, h, nullptr, nullptr, 0))
                return 2;
        } else {
            out.errors++;
        }
#endif
        out.stats(false);
    }
#ifndef DEXDEC_FAKE
    dec.shutdown();
#endif
    out.stats(true);
    logf("end of stream: %llu frames decoded, %llu errors", (unsigned long long)out.decoded,
         (unsigned long long)out.errors);
    return 0;
}
