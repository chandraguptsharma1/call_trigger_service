/**
 * ElevenLabs public agent audio tester (Node.js)
 * Streams any audio file (mp3/wav/m4a/ogg/pcm) as PCM 16k/16-bit/mono to agent.
 * Collects agent audio and saves to a WAV on graceful close.
 *
 * Usage:
 *   node src/audio_client.js <wss-or-agent_id> <audio-file?>
 *         [--say "hello"] [--out ./audio/agent_out.wav] [--wait 8] [--interactive]
 *
 * Examples:
 *   node src/audio_client.js agent_xxx ./audio/testaudio.wav --wait 8
 *   node src/audio_client.js "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=agent_xxx" ./audio/test.mp3 --say "Hello!"
 *   node src/audio_client.js agent_xxx --interactive --say "Only text"
 */

import { WebSocket } from "ws";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import process from "process";

// ---------- CLI ----------
const ARG1 = process.argv[2];
const ARG2 = process.argv[3];
if (!ARG1) {
    console.error("❌ Provide <wss-url|agent_id> [audio-file]");
    process.exit(1);
}

const WSS = ARG1.startsWith("ws")
    ? ARG1
    : `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${ARG1}`;

const AUDIO_FILE = ARG2 && !ARG2.startsWith("--") ? ARG2 : null;
const SAY_TEXT = getFlag("--say");
const OUT_WAV = getFlag("--out") || "./audio/agent_out.wav";
const WAIT_SEC = Number(getFlag("--wait") || 8); // idle timeout before auto close
const INTERACTIVE = process.argv.includes("--interactive");

function getFlag(flag) {
    const i = process.argv.indexOf(flag);
    return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

// ---------- WAV/PCM helpers ----------
function pcm16ToWav(pcm, sampleRate = 16000, channels = 1) {
    const byteRate = sampleRate * channels * 2;
    const blockAlign = channels * 2;
    const dataSize = pcm.length;
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);                 // PCM
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(16, 34);                // bits/sample
    header.write("data", 36);
    header.writeUInt32LE(dataSize, 40);
    return Buffer.concat([header, pcm]);
}

function parseWav(buf) {
    const rdU32 = (o) => buf.readUInt32LE(o);
    const rdU16 = (o) => buf.readUInt16LE(o);
    const ascii = (o, n) => buf.toString("ascii", o, o + n);
    if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") {
        throw new Error("Not a RIFF/WAVE file");
    }
    let off = 12, fmt, data;
    while (off + 8 <= buf.length) {
        const id = ascii(off, 4);
        const size = rdU32(off + 4);
        const start = off + 8;
        if (id === "fmt ") {
            fmt = {
                audioFormat: rdU16(start + 0),
                channels: rdU16(start + 2),
                sampleRate: rdU32(start + 4),
                bitsPerSample: rdU16(start + 14),
            };
        } else if (id === "data") {
            data = { dataOffset: start, dataSize: size };
        }
        off = start + size;
    }
    if (!fmt || !data) throw new Error("Invalid WAV");
    if (fmt.audioFormat !== 1) throw new Error("WAV not PCM");
    return { ...fmt, ...data };
}

// pace ~100ms frames
const FRAME_MS = 100;
const BYTES_PER_SEC = 16000 * 2;
const FRAME_BYTES = Math.floor(BYTES_PER_SEC * (FRAME_MS / 1000));

function pacedSend(buffer, onChunk, onEnd) {
    let offset = 0;
    (function next() {
        if (offset >= buffer.length) return onEnd?.();
        const end = Math.min(offset + FRAME_BYTES, buffer.length);
        onChunk(buffer.subarray(offset, end));
        offset = end;
        setTimeout(next, FRAME_MS);
    })();
}

function streamAnyAudioAsPcm(filePath, onChunk, onEnd) {
    const ext = (filePath ? path.extname(filePath) : "").toLowerCase();

    if (!filePath) return onEnd?.();

    if (ext === ".pcm") {
        const raw = fs.readFileSync(filePath);
        return pacedSend(raw, onChunk, onEnd);
    }

    if (ext === ".wav") {
        const wav = fs.readFileSync(filePath);
        const { sampleRate, channels, bitsPerSample, dataOffset, dataSize } = parseWav(wav);
        const pcm = wav.subarray(dataOffset, dataOffset + dataSize);
        if (sampleRate === 16000 && channels === 1 && bitsPerSample === 16) {
            return pacedSend(pcm, onChunk, onEnd);
        }
        // else resample
    }

    // ffmpeg: any → s16le 16k mono
    const ff = spawn("ffmpeg", [
        "-hide_banner", "-loglevel", "error",
        "-i", filePath,
        "-f", "s16le",
        "-acodec", "pcm_s16le",
        "-ac", "1",
        "-ar", "16000",
        "pipe:1",
    ]);

    let bucket = Buffer.alloc(0);
    ff.stdout.on("data", (chunk) => {
        bucket = Buffer.concat([bucket, chunk]);
        while (bucket.length >= FRAME_BYTES) {
            const frame = bucket.subarray(0, FRAME_BYTES);
            bucket = bucket.subarray(FRAME_BYTES);
            onChunk(frame);
        }
    });

    ff.on("close", () => {
        if (bucket.length) onChunk(bucket);
        onEnd?.();
    });

    ff.on("error", (e) => {
        console.error("ffmpeg error:", e);
        onEnd?.();
    });
}

// ---------- WS + graceful lifecycle ----------
console.log("WS :", WSS);
if (AUDIO_FILE) console.log("FILE:", AUDIO_FILE);
if (SAY_TEXT) console.log("SAY :", `"${SAY_TEXT}"`);
console.log("OUT:", OUT_WAV);
console.log("WAIT:", WAIT_SEC, "sec (idle auto-close)");

const ws = new WebSocket(WSS);
let agentPcmChunks = [];
let idleTimer = null;
let closed = false;

function bumpIdle() {
    if (WAIT_SEC <= 0) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => finalize("idle-timeout"), WAIT_SEC * 1000);
}

function finalize(reason = "manual") {
    if (closed) return;
    closed = true;
    clearTimeout(idleTimer);

    // Save whatever we have
    try {
        if (agentPcmChunks.length) {
            const pcm = Buffer.concat(agentPcmChunks);
            fs.mkdirSync(path.dirname(OUT_WAV), { recursive: true });
            fs.writeFileSync(OUT_WAV, pcm16ToWav(pcm, 16000, 1));
            console.log("💾 Saved agent audio →", OUT_WAV);
        } else {
            console.log("ℹ️ No agent audio received to save.");
        }
    } catch (e) {
        console.error("Save error:", e);
    }

    // Close WS (if still open)
    try { ws.close(); } catch { }
    console.log("✔️ Closed by", reason);
    process.exit(0);
}

ws.on("open", () => {
    console.log("✓ WebSocket open");

    // ensure audio mode
    ws.send(JSON.stringify({
        type: "conversation_initiation_client_data",
        conversation_initiation_client_data: {
            conversation_config_override: { conversation: { text_only: false } }
        }
    }));

    if (SAY_TEXT) ws.send(JSON.stringify({ type: "user_message", text: SAY_TEXT }));
    if (AUDIO_FILE) {
        streamAnyAudioAsPcm(
            AUDIO_FILE,
            (pcm) => {
                ws.send(JSON.stringify({ user_audio_chunk: pcm.toString("base64") }));
            },
            () => {
                console.log("✅ Finished sending audio.");
                bumpIdle(); // start idle timer after we finish sending
            }
        );
    } else {
        bumpIdle();
    }

    if (INTERACTIVE) {
        console.log("⌨️  Press ENTER or 'q' to end.");
        try { process.stdin.setRawMode(true); } catch { }
        process.stdin.resume();
        process.stdin.on("data", (b) => {
            const k = b.toString().trim().toLowerCase();
            if (k === "q" || k === "") finalize("interactive");
        });
    }
});

ws.on("message", (buf) => {
    let json;
    try { json = JSON.parse(buf.toString()); } catch { }

    if (json?.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", event_id: json.ping_event?.event_id }));
        return;
    }

    if (json?.type === "user_transcript") {
        console.log("👤", json.user_transcription_event?.user_transcript);
        bumpIdle();
    }

    if (json?.type === "agent_response") {
        console.log("🤖", json.agent_response_event?.agent_response);
        bumpIdle();
    }

    if (json?.type === "audio") {
        const b64 = json.audio_event?.audio_base_64;
        if (b64) agentPcmChunks.push(Buffer.from(b64, "base64"));
        bumpIdle();
    }
});

ws.on("close", (c, r) => {
    console.log("WS remote closed:", c, r?.toString() ?? "");
    finalize("ws-close");
});

ws.on("error", (e) => {
    console.error("WS error:", e);
    finalize("ws-error");
});

// Ctrl+C → graceful
process.on("SIGINT", () => finalize("SIGINT"));
process.on("SIGTERM", () => finalize("SIGTERM"));
