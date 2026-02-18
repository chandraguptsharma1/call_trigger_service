import { WebSocketServer, WebSocket } from "ws";
import fs from "fs";
import path from "path";

const PORT = Number(process.env.PORT || 8091);

const XI = "sk_367b8bde848f24c2be29c1afc986e3a5c281c0642bca468e" || "";
const AGENT_ID = "agent_9601kb2v4n0ke6vsvc5ccg2qnycw" || "";

const SAVE_ELEVEN = String(process.env.SAVE_ELEVEN || "true") === "true";
const OUT_DIR = process.env.OUT_DIR || "./out";

const LOG_LEVEL = (process.env.LOG_LEVEL || "debug").toLowerCase();
const LEVEL = { error: 0, warn: 1, info: 2, debug: 3 };
const canLog = (lvl) => (LEVEL[lvl] ?? 3) <= (LEVEL[LOG_LEVEL] ?? 3);
const ts = () => new Date().toISOString();
const rid = () => `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
const log = (id, lvl, msg, meta) => {
    if (!canLog(lvl)) return;
    const base = `[${ts()}] [${lvl.toUpperCase()}] [ExoBridge] [rid:${id}] ${msg}`;
    meta !== undefined ? console.log(base, meta) : console.log(base);
};

function b64ToBuf(b64) { return Buffer.from(b64, "base64"); }
function bufToB64(buf) { return Buffer.from(buf).toString("base64"); }

function pcmBufToI16(buf) {
    return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
}
function i16ToBuf(i16) {
    return Buffer.from(i16.buffer, i16.byteOffset, i16.byteLength);
}

// simple linear resample (ok for POC)
function resamplePCM16(i16, inRate, outRate) {
    if (inRate === outRate) return i16;
    const ratio = inRate / outRate;
    const outLen = Math.floor(i16.length / ratio);
    const out = new Int16Array(outLen);
    let pos = 0;
    for (let i = 0; i < outLen; i++) {
        const idx = Math.floor(pos);
        const frac = pos - idx;
        const s0 = i16[idx] ?? 0;
        const s1 = i16[idx + 1] ?? s0;
        out[i] = (s0 + (s1 - s0) * frac) | 0;
        pos += ratio;
    }
    return out;
}

function frameBytesFor(sampleRate, frameMs) {
    // PCM16 mono: 2 bytes/sample
    const bytes = Math.round(sampleRate * (frameMs / 1000) * 2);
    // Exotel wants multiples of 320
    return Math.ceil(bytes / 320) * 320;
}

export function registerExotelWsBridge(httpServer) {
    log("boot", "info", "Registering Exotel WS bridge", {
        path: "/ws/exotel",
        PORT,
        XI_PRESENT: !!XI,
        ELEVEN_AGENT_ID_PRESENT: !!AGENT_ID,
        LOG_LEVEL,
    });

    const wss = new WebSocketServer({ server: httpServer, path: "/ws/exotel" });

    wss.on("connection", (exoWs, req) => {


        const requestId = rid();
        const urlObj = new URL(req.url, `http://${req.headers.host}`);

        // Extract variables passed from Exotel (sent via the URL in your ExoML)
        const agentName = urlObj.searchParams.get("agent_name") || "Ritu";
        const customerName = urlObj.searchParams.get("customer_name") || "Ram";

        // ... rest of your setup

        // Exotel will often connect with ?sample-rate=...
        const exotelSampleRate = Number(urlObj.searchParams.get("sample-rate") || 16000);

        // We will output EXACTLY the same rate Exotel negotiated (less issues)
        const OUT_RATE = exotelSampleRate;
        const FRAME_MS = 100;
        const EXO_FRAME_BYTES = frameBytesFor(OUT_RATE, FRAME_MS);

        let streamSid = null;
        let closed = false;
        let seq = 1;

        // outgoing audio pacing (very important)
        let txBuffer = Buffer.alloc(0);
        const frameQueue = [];
        let pumpTimer = null;

        // backpressure: if Exotel is slow / call is ending
        const MAX_QUEUE_FRAMES = 200; // 200 * 100ms = 20 seconds max buffer

        // stats
        let exoInChunks = 0, exoInBytes = 0;
        let agentInChunks = 0, agentInBytes = 0;
        let exoOutChunks = 0, exoOutBytes = 0;
        let agentOutChunks = 0, agentOutBytes = 0;

        const printStats = (tag) => {
            log(requestId, "info", `📊 stats (${tag})`, {
                streamSid,
                exotelSampleRate,
                OUT_RATE,
                exoIn: { chunks: exoInChunks, bytes: exoInBytes },
                agentIn: { chunks: agentInChunks, bytes: agentInBytes },
                exoOut: { chunks: exoOutChunks, bytes: exoOutBytes },
                agentOut: { chunks: agentOutChunks, bytes: agentOutBytes },
            });
        };

        // optional file save of Eleven PCM16k
        let elevenWriteStream = null;
        if (SAVE_ELEVEN) {
            fs.mkdirSync(OUT_DIR, { recursive: true });
            const elevenPath = path.join(OUT_DIR, `eleven_${requestId}.pcm16k.raw`);
            elevenWriteStream = fs.createWriteStream(elevenPath, { flags: "a" });
            log(requestId, "info", "📝 Saving ElevenLabs PCM16k to file", { elevenPath });
        }

        const finalize = (reason) => {
            if (closed) return;
            closed = true;

            log(requestId, "warn", "🔻 finalize", { reason, streamSid });
            printStats("finalize");

            try { if (pumpTimer) clearInterval(pumpTimer); } catch { }
            try { elevenWriteStream?.end(); } catch { }

            try { exoWs.close(1000, reason); } catch { }
            try { agentWs.close(1000, reason); } catch { }
        };

        function startPump() {
            if (pumpTimer) return;
            pumpTimer = setInterval(() => {
                if (closed || !streamSid) return;
                const frame = frameQueue.shift();
                if (!frame) return;

                const out = {
                    event: "media",
                    sequence_number: seq++,
                    stream_sid: streamSid,
                    media: { payload: bufToB64(frame) },
                };

                exoOutChunks++;
                exoOutBytes += frame.length;

                try {
                    exoWs.send(JSON.stringify(out));
                } catch (e) {
                    log(requestId, "error", "Exotel send failed", { err: e?.message });
                    finalize("exo-send-failed");
                }
            }, FRAME_MS); // ✅ 100ms pump matches our 100ms frames
        }

        function queueToExotelFrames(pcmBuf) {
            if (closed || !streamSid) return;

            txBuffer = Buffer.concat([txBuffer, pcmBuf]);

            while (txBuffer.length >= EXO_FRAME_BYTES) {
                const frame = txBuffer.subarray(0, EXO_FRAME_BYTES);
                txBuffer = txBuffer.subarray(EXO_FRAME_BYTES);

                if (frameQueue.length > MAX_QUEUE_FRAMES) {
                    // drop oldest if too much buffered (better than growing forever)
                    frameQueue.shift();
                }
                frameQueue.push(frame);
            }
            startPump();
        }

        // ---- ElevenLabs connect ----
        const agentUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${AGENT_ID}`;
        log(requestId, "info", "Connecting ElevenLabs WS", { agentUrlMasked: `...agent_id=${AGENT_ID.slice(0, 8)}***` });

        const agentWs = new WebSocket(agentUrl, { headers: { "xi-api-key": XI } });
        let agentOpen = false;
        const pending = [];

        const sendToElevenPCM16k = (pcm16kBuf) => {
            const msg = JSON.stringify({ user_audio_chunk: bufToB64(pcm16kBuf) });
            agentOutChunks++;
            agentOutBytes += pcm16kBuf.length;

            if (!agentOpen) pending.push(msg);
            else {
                try { agentWs.send(msg); }
                catch (e) { log(requestId, "error", "Failed send to Eleven", { err: e?.message }); }
            }
        };

        agentWs.on("open", () => {
            agentOpen = true;

            const initPayload = {
                type: "conversation_initiation_client_data",
                conversation_initiation_client_data: {
                    conversation_config_override: {
                        conversation: {
                            text_only: false,
                            user_input_audio_format: "pcm_16000",
                            agent_output_audio_format: "pcm_16000",
                            model_id: "eleven_multilingual_v2",
                        },
                    },
                    // ✅ ADD THIS SECTION
                    dynamic_variables: {
                        agent_name: agentName,
                        customer_name: customerName
                    }
                },
            };

            log(requestId, "info", "🤖 Eleven open -> init sent", { agentName, customerName });

            log(requestId, "info", "🤖 Eleven open -> init sent", { model: "eleven_multilingual_v2" });

            try { agentWs.send(JSON.stringify(initPayload)); }
            catch (e) { log(requestId, "error", "Init send failed", { err: e?.message }); }

            for (const m of pending) {
                try { agentWs.send(m); } catch { }
            }
            pending.length = 0;
        });

        // Eleven -> Exotel (agent audio out)
        agentWs.on("message", (buf) => {
            agentInChunks++;
            agentInBytes += buf?.length ?? 0;

            let j;
            try { j = JSON.parse(buf.toString()); } catch { return; }

            if (j?.type === "audio" && j?.audio_event?.audio_base_64) {
                const pcm16k = Buffer.from(j.audio_event.audio_base_64, "base64");
                if (elevenWriteStream) elevenWriteStream.write(pcm16k);

                let outPcm = pcm16k;

                // resample 16k -> OUT_RATE if needed
                if (OUT_RATE !== 16000) {
                    const i16 = pcmBufToI16(pcm16k);
                    const i16o = resamplePCM16(i16, 16000, OUT_RATE);
                    outPcm = i16ToBuf(i16o);
                }

                queueToExotelFrames(outPcm);

                log(requestId, "debug", "🎧 Eleven->Exotel audio queued", {
                    inBytes: pcm16k.length,
                    outBytes: outPcm.length,
                    OUT_RATE,
                    EXO_FRAME_BYTES,
                    FRAME_MS,
                    streamSid,
                });
            }

            if (j?.type === "conversation_finished") {
                log(requestId, "info", "✅ conversation_finished from Eleven");
                finalize("agent-ended");
            }
        });

        // Exotel -> Eleven (caller audio in)
        let packetsToSkip = 0;

        exoWs.on("message", (raw) => {
            exoInChunks++;
            exoInBytes += raw?.length ?? 0;

            let msg;
            try { msg = JSON.parse(raw.toString()); } catch { return; }

            if (msg.event === "connected") {
                log(requestId, "info", "🔌 Exotel connected event");
                return;
            }

            if (msg.event === "start") {
                streamSid = msg.stream_sid || msg?.start?.stream_sid;
                packetsToSkip = 50; // optional: skip first ~1s if needed
                log(requestId, "info", "▶️ Exotel start", { streamSid, exotelSampleRate, OUT_RATE });
                startPump();
                return;
            }

            if (msg.event === "media" && msg?.media?.payload) {
                if (!agentOpen) return;
                if (packetsToSkip > 0) { packetsToSkip--; return; }

                const pcm = b64ToBuf(msg.media.payload);

                // Exotel sends PCM16 @ exotelSampleRate; Eleven wants 16k
                const i16 = pcmBufToI16(pcm);
                const i16_16k = resamplePCM16(i16, exotelSampleRate, 16000);
                const pcm16k = i16ToBuf(i16_16k);

                sendToElevenPCM16k(pcm16k);
                return;
            }

            if (msg.event === "stop") {
                const callSid = msg?.stop?.call_sid;
                log(requestId, "info", "⏹️ Exotel stop", { streamSid, stop: msg.stop });

                if (callSid) {
                    fetchV1CallDetails(callSid)
                        .then((d) => log(requestId, "info", "📞 V1 Call Details", d))
                        .catch((e) => log(requestId, "error", "📞 Call details fetch failed", { err: e?.message }));
                }

                finalize("exotel-stop");
            }
        });

        exoWs.on("close", (code, reason) => {
            log(requestId, "warn", "Exotel WS closed", { code, reason: reason?.toString(), streamSid });
            finalize("exotel-close");
        });

        exoWs.on("error", (e) => {
            log(requestId, "error", "Exotel WS error", { err: e?.message, streamSid });
            finalize("exotel-error");
        });

        agentWs.on("close", (code, reason) => {
            log(requestId, "warn", "Eleven WS closed", { code, reason: reason?.toString(), streamSid });
            finalize("agent-close");
        });

        agentWs.on("error", (e) => {
            log(requestId, "error", "Eleven WS error", { err: e?.message, streamSid });
            finalize("agent-error");
        });

        log(requestId, "info", "🟢 Exotel WS connected", {
            ip: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown",
            ua: req.headers["user-agent"],
            url: req.url,
            exotelSampleRate,
            OUT_RATE,
            FRAME_MS,
            EXO_FRAME_BYTES,
        });
    });

    async function fetchV1CallDetails(callSid) {
        const { EXOTEL_SID, EXOTEL_API_KEY, EXOTEL_API_TOKEN, EXOTEL_HOST } = process.env;
        const url = `https://${EXOTEL_HOST}/v1/Accounts/${EXOTEL_SID}/Calls/${callSid}.json`;
        const auth = Buffer.from(`${EXOTEL_API_KEY}:${EXOTEL_API_TOKEN}`).toString("base64");
        const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
        const text = await res.text();
        return { status: res.status, text };
    }


    console.log("✅ Exotel WS bridge registered on /ws/exotel");
}
