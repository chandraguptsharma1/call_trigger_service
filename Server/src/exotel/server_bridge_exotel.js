// src/exotel/server_bridge_exotel.js
import { WebSocketServer, WebSocket } from "ws";

const PORT = Number(process.env.PORT || 8091);
const XI = "sk_367b8bde848f24c2be29c1afc986e3a5c281c0642bca468e" || "";
const AGENT_ID = "agent_9601kb2v4n0ke6vsvc5ccg2qnycw" || "";
const WAIT_SEC = Number(process.env.WAIT_SEC ?? 0);
const SAVE_OUT = String(process.env.SAVE_OUT || "false") === "true";

// ---------- helpers ----------
function b64ToBuf(b64) { return Buffer.from(b64, "base64"); }
function bufToB64(buf) { return Buffer.from(buf).toString("base64"); }

function pcmBufToI16(buf) {
    return new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
}
function i16ToBuf(i16) {
    return Buffer.from(i16.buffer, i16.byteOffset, i16.byteLength);
}

// linear resample
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

// ---------- logging utils ----------
const LOG_LEVEL = (process.env.LOG_LEVEL || "debug").toLowerCase();
const LEVEL = { error: 0, warn: 1, info: 2, debug: 3 };
const canLog = (lvl) => (LEVEL[lvl] ?? 3) <= (LEVEL[LOG_LEVEL] ?? 3);

function ts() { return new Date().toISOString(); }
function rid() { return `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`; }

function log(rid, lvl, msg, meta) {
    if (!canLog(lvl)) return;
    const base = `[${ts()}] [${lvl.toUpperCase()}] [ExoBridge] [rid:${rid}] ${msg}`;
    if (meta !== undefined) console.log(base, meta);
    else console.log(base);
}

function mask(v, keep = 4) {
    if (!v) return null;
    const s = String(v);
    if (s.length <= keep) return "***";
    return `${s.slice(0, keep)}***`;
}

function safeJsonSize(obj) {
    try { return Buffer.byteLength(JSON.stringify(obj), "utf8"); } catch { return -1; }
}

function pcmInfo(buf) {
    const bytes = buf?.length ?? 0;
    const samples = Math.floor(bytes / 2);
    return { bytes, samples };
}

export function registerExotelWsBridge(httpServer) {
    log("boot", "info", "Registering Exotel WS bridge", {
        path: "/ws/exotel",
        XI_API_KEY: XI ? "***present***" : null,
        ELEVEN_AGENT_ID: mask(AGENT_ID, 6),
        LOG_LEVEL,
    });

    const wss = new WebSocketServer({ server: httpServer, path: "/ws/exotel" });

    wss.on("connection", (exoWs, req) => {
        const requestId = rid();

        console.log("🟢 [Exotel] WebSocket Connection Attempted...");

        // ---- connection context ----
        const urlObj = new URL(req.url, "http://localhost");
        const sampleRate = Number(urlObj.searchParams.get("sample-rate") || 8000);

        const agentName = urlObj.searchParams.get("agent_name") || "Ritu";
        const customerName = urlObj.searchParams.get("customer_name") || "Customer";
        const dueAmount = urlObj.searchParams.get("amount") || "";
        const dueDate = urlObj.searchParams.get("due_date") || "";

        log(requestId, "info", "🟢 Exotel connected", {
            sampleRate,
            agentName,
            customerName,
            dueAmount,
            dueDate,
            ip:
                req.headers["x-forwarded-for"] ||
                req.socket?.remoteAddress ||
                "unknown",
            ua: req.headers["user-agent"],
            url: req.url,
        });

        let streamSid = null;
        let closed = false;
        let seq = 1;

        let exoTxBuffer = Buffer.alloc(0);
        const EXO_FRAME_BYTES = 3200; // 100ms @ 8k, PCM16 mono (Exotel min)

        // perf counters
        let exoInChunks = 0;
        let agentInChunks = 0;
        let exoOutChunks = 0;
        let agentOutChunks = 0;
        let exoInBytes = 0;
        let agentInBytes = 0;
        let exoOutBytes = 0;
        let agentOutBytes = 0;

        const printStats = (tag) => {
            log(requestId, "info", `📊 stats (${tag})`, {
                streamSid,
                sampleRate,
                exoIn: { chunks: exoInChunks, bytes: exoInBytes },
                agentIn: { chunks: agentInChunks, bytes: agentInBytes },
                exoOut: { chunks: exoOutChunks, bytes: exoOutBytes },
                agentOut: { chunks: agentOutChunks, bytes: agentOutBytes },
            });
        };

        // Connect ElevenLabs
        const agentUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${AGENT_ID}`;
        log(requestId, "info", "Connecting ElevenLabs WS", {
            agentUrl: agentUrl.replace(/agent_id=.*/, `agent_id=${mask(AGENT_ID, 6)}`),
            xiKey: XI ? "***present***" : null,
        });

        const agentWs = new WebSocket(agentUrl, { headers: { "xi-api-key": XI } });

        let agentOpen = false;
        const pending = [];

        const sendToAgentPCM16k = (pcm16kBuf) => {
            const info = pcmInfo(pcm16kBuf);
            const msg = JSON.stringify({ user_audio_chunk: bufToB64(pcm16kBuf) });

            agentOutChunks++;
            agentOutBytes += info.bytes;

            if (!agentOpen) {
                pending.push(msg);
                log(requestId, "debug", "↗️ queued audio to agent (agent not open yet)", {
                    ...info,
                    pending: pending.length,
                    jsonBytes: safeJsonSize({ user_audio_chunk: "..." }),
                });
            } else {
                try {
                    agentWs.send(msg);
                    log(requestId, "debug", "↗️ sent audio to agent", info);
                } catch (e) {
                    log(requestId, "error", "Failed sending audio to agent", { err: e?.message, ...info });
                }
            }
        };

        function flushToExotelFramed(pcmBuf) {
            if (closed || !streamSid) return;

            // append to buffer
            exoTxBuffer = Buffer.concat([exoTxBuffer, pcmBuf]);

            // send only fixed frames (multiple of 320, >=3200)
            while (exoTxBuffer.length >= EXO_FRAME_BYTES) {
                const frame = exoTxBuffer.subarray(0, EXO_FRAME_BYTES);
                exoTxBuffer = exoTxBuffer.subarray(EXO_FRAME_BYTES);

                const out = {
                    event: "media",
                    sequence_number: seq++,
                    stream_sid: streamSid,
                    media: { payload: bufToB64(frame) },
                };

                try {
                    exoWs.send(JSON.stringify(out));
                } catch (e) {
                    log(requestId, "error", "Failed sending framed audio to Exotel", { err: e?.message });
                    return;
                }
            }
        }


        const sendToExotelPCM = (pcmBuf) => {
            if (closed || !streamSid) {
                log(requestId, "debug", "⏭️ skip sendToExotelPCM (closed or no streamSid)", {
                    closed,
                    streamSid,
                    ...pcmInfo(pcmBuf),
                });
                return;
            }

            const out = {
                event: "media",
                sequence_number: seq++,
                stream_sid: streamSid,
                media: { payload: bufToB64(pcmBuf) },
            };

            const info = pcmInfo(pcmBuf);
            exoOutChunks++;
            exoOutBytes += info.bytes;

            try {
                exoWs.send(JSON.stringify(out));
                log(requestId, "debug", "↘️ sent audio to Exotel", {
                    ...info,
                    seq: out.sequence_number,
                    streamSid,
                });
            } catch (e) {
                log(requestId, "error", "Failed sending audio to Exotel", { err: e?.message, ...info });
            }
        };

        const finalize = (reason) => {
            if (closed) return;
            closed = true;

            log(requestId, "warn", "🔻 finalize", { reason, streamSid });
            printStats("finalize");

            try { exoWs.close(1000, reason); } catch (e) {
                log(requestId, "error", "Error closing exoWs", { err: e?.message });
            }
            try { agentWs.close(1000, reason); } catch (e) {
                log(requestId, "error", "Error closing agentWs", { err: e?.message });
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
                },
                dynamic_variables: {
                    agent_name: agentName,
                    customer_name: customerName,
                    due_amount: dueAmount,
                    due_date: dueDate,
                },
            };

            log(requestId, "info", "🤖 ElevenLabs open, sending init payload", {
                model_id: initPayload.conversation_initiation_client_data
                    .conversation_config_override.conversation.model_id,
                formats: {
                    user_input_audio_format:
                        initPayload.conversation_initiation_client_data
                            .conversation_config_override.conversation.user_input_audio_format,
                    agent_output_audio_format:
                        initPayload.conversation_initiation_client_data
                            .conversation_config_override.conversation.agent_output_audio_format,
                },
                dynamic_variables: initPayload.dynamic_variables,
            });

            try {
                agentWs.send(JSON.stringify(initPayload));
            } catch (e) {
                log(requestId, "error", "Failed to send init payload to ElevenLabs", { err: e?.message });
            }

            if (pending.length) {
                log(requestId, "info", "Flushing pending audio to agent", { pending: pending.length });
            }

            for (const m of pending) {
                try { agentWs.send(m); } catch (e) {
                    log(requestId, "error", "Failed flushing pending audio to agent", { err: e?.message });
                }
            }
            pending.length = 0;
        });

        // Eleven → Exotel
        agentWs.on("message", (buf) => {
            agentInChunks++;
            agentInBytes += buf?.length ?? 0;

            log(requestId, "debug", "⬅️ message from ElevenLabs", {
                bytes: buf?.length ?? 0,
            });

            let j;
            try {
                j = JSON.parse(buf.toString());
            } catch (e) {
                log(requestId, "warn", "Non-JSON message from ElevenLabs (ignored)", {
                    err: e?.message,
                    preview: buf.toString().slice(0, 120),
                });
                return;
            }

            if (j?.type) log(requestId, "debug", "ElevenLabs event type", { type: j.type });

            if (j?.type === "audio" && j?.audio_event?.audio_base_64) {
                const pcm16k = b64ToBuf(j.audio_event.audio_base_64);

                const i16_16k = pcmBufToI16(pcm16k);
                const i16_out = resamplePCM16(i16_16k, 16000, sampleRate);
                const outBuf = i16ToBuf(i16_out);

                log(requestId, "debug", "🎧 Eleven->Exotel audio", {
                    in: pcmInfo(pcm16k),
                    out: pcmInfo(outBuf),
                    fromRate: 16000,
                    toRate: sampleRate,
                    streamSid,
                });

                flushToExotelFramed(outBuf);
            }

            if (j?.type === "conversation_finished") {
                log(requestId, "info", "✅ conversation_finished from ElevenLabs");
                finalize("agent-ended");
            }
        });

        // Exotel → Eleven
        // exoWs.on("message", (raw) => {
        //     exoInChunks++;
        //     exoInBytes += raw?.length ?? 0;

        //     log(requestId, "debug", "➡️ message from Exotel", {
        //         bytes: raw?.length ?? 0,
        //     });

        //     let msg;
        //     try {
        //         msg = JSON.parse(raw.toString());
        //     } catch (e) {
        //         log(requestId, "warn", "Non-JSON message from Exotel (ignored)", {
        //             err: e?.message,
        //             preview: raw.toString().slice(0, 120),
        //         });
        //         return;
        //     }

        //     if (msg?.event) log(requestId, "debug", "Exotel event", { event: msg.event });

        //     if (msg.event === "start") {
        //         streamSid = msg.stream_sid || msg?.start?.stream_sid;
        //         log(requestId, "info", "▶️ Exotel start", { streamSid, sampleRate });
        //         return;
        //     }

        //     if (msg.event === "media" && msg?.media?.payload) {
        //         const pcm = b64ToBuf(msg.media.payload);
        //         const i16_in = pcmBufToI16(pcm);
        //         const i16_16k = resamplePCM16(i16_in, sampleRate, 16000);
        //         const outBuf = i16ToBuf(i16_16k);

        //         log(requestId, "debug", "🎤 Exotel->Eleven audio", {
        //             in: pcmInfo(pcm),
        //             out: pcmInfo(outBuf),
        //             fromRate: sampleRate,
        //             toRate: 16000,
        //             streamSid,
        //         });

        //         sendToAgentPCM16k(outBuf);
        //         return;
        //     }

        //     if (msg.event === "stop") {
        //         log(requestId, "info", "⏹️ Exotel stop", { streamSid });
        //         finalize("exotel-stop");
        //     }
        // });

        // connection ke andar ek counter variable banayein
        let packetsToSkip = 100; // 100 packets ≈ 2 seconds (20ms per packet)

        exoWs.on("message", (raw) => {
            exoInChunks++;
            exoInBytes += raw?.length ?? 0;

            let msg;
            try { msg = JSON.parse(raw.toString()); } catch { return; }

            if (msg.event === "start") {
                streamSid = msg.stream_sid || msg?.start?.stream_sid;
                console.log(`▶️ [Stream] Started (SID: ${streamSid})`);
                // Reset counter on every new start
                packetsToSkip = 100;
                return;
            }

            if (msg.event === "media" && msg?.media?.payload) {
                // --- Code-level Delay Logic ---
                if (packetsToSkip > 0) {
                    packetsToSkip--;
                    if (packetsToSkip % 20 === 0) {
                        console.log(`⏳ Skipping Exotel system message... (${packetsToSkip} left)`);
                    }
                    return; // ElevenLabs ko audio nahi bhej rahe
                }
                // ------------------------------

                if (agentOpen) {
                    const pcm = b64ToBuf(msg.media.payload);
                    const i16_in = pcmBufToI16(pcm);
                    const i16_16k = resamplePCM16(i16_in, sampleRate, 16000);
                    agentWs.send(JSON.stringify({ user_audio_chunk: bufToB64(i16ToBuf(i16_16k)) }));
                }
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
            log(requestId, "warn", "ElevenLabs WS closed", { code, reason: reason?.toString(), streamSid });
            finalize("agent-close");
        });

        agentWs.on("error", (e) => {
            log(requestId, "error", "ElevenLabs WS error", { err: e?.message, streamSid });
            finalize("agent-error");
        });
    });

    console.log("✅ Exotel WS bridge registered on /ws/exotel");
}
