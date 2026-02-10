// src/exotel/server_bridge_exotel.js
import { WebSocketServer, WebSocket } from "ws";

const XI = process.env.XI_API_KEY;
const AGENT_ID = process.env.ELEVEN_AGENT_ID;

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

export function registerExotelWsBridge(httpServer) {
    const wss = new WebSocketServer({ server: httpServer, path: "/ws/exotel" });

    wss.on("connection", (exoWs, req) => {
        const urlObj = new URL(req.url, "http://localhost");
        const sampleRate = Number(urlObj.searchParams.get("sample-rate") || 8000);

        const agentName = urlObj.searchParams.get("agent_name") || "Ritu";
        const customerName = urlObj.searchParams.get("customer_name") || "Customer";
        const dueAmount = urlObj.searchParams.get("amount") || "";
        const dueDate = urlObj.searchParams.get("due_date") || "";

        console.log("🟢 Exotel connected", { sampleRate, agentName, customerName });

        let streamSid = null;
        let closed = false;
        let seq = 1;

        // Connect ElevenLabs
        const agentUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${AGENT_ID}`;
        const agentWs = new WebSocket(agentUrl, { headers: { "xi-api-key": XI } });

        let agentOpen = false;
        const pending = [];

        const sendToAgentPCM16k = (pcm16kBuf) => {
            const msg = JSON.stringify({ user_audio_chunk: bufToB64(pcm16kBuf) });
            if (!agentOpen) pending.push(msg);
            else agentWs.send(msg);
        };

        const sendToExotelPCM = (pcmBuf) => {
            if (closed || !streamSid) return;
            const out = {
                event: "media",
                sequence_number: seq++,
                stream_sid: streamSid,
                media: { payload: bufToB64(pcmBuf) },
            };
            try { exoWs.send(JSON.stringify(out)); } catch { }
        };

        const finalize = (reason) => {
            if (closed) return;
            closed = true;
            console.log("🔻 finalize:", reason);
            try { exoWs.close(1000, reason); } catch { }
            try { agentWs.close(1000, reason); } catch { }
        };

        agentWs.on("open", () => {
            agentOpen = true;

            agentWs.send(JSON.stringify({
                type: "conversation_initiation_client_data",
                conversation_initiation_client_data: {
                    conversation_config_override: {
                        conversation: {
                            text_only: false,
                            user_input_audio_format: "pcm_16000",
                            agent_output_audio_format: "pcm_16000",
                            model_id: "eleven_multilingual_v2",
                        }
                    }
                },
                dynamic_variables: {
                    agent_name: agentName,
                    customer_name: customerName,
                    due_amount: dueAmount,
                    due_date: dueDate,
                }
            }));

            for (const m of pending) agentWs.send(m);
            pending.length = 0;

            console.log("🤖 ElevenLabs open");
        });

        // Eleven → Exotel
        agentWs.on("message", (buf) => {
            let j;
            try { j = JSON.parse(buf.toString()); } catch { return; }

            if (j?.type === "audio" && j?.audio_event?.audio_base_64) {
                const pcm16k = b64ToBuf(j.audio_event.audio_base_64);
                const i16_16k = pcmBufToI16(pcm16k);
                const i16_out = resamplePCM16(i16_16k, 16000, sampleRate);
                sendToExotelPCM(i16ToBuf(i16_out));
            }

            if (j?.type === "conversation_finished") {
                finalize("agent-ended");
            }
        });

        // Exotel → Eleven
        exoWs.on("message", (raw) => {
            let msg;
            try { msg = JSON.parse(raw.toString()); } catch { return; }

            if (msg.event === "start") {
                streamSid = msg.stream_sid || msg?.start?.stream_sid;
                console.log("▶️ start", { streamSid });
                return;
            }

            if (msg.event === "media" && msg?.media?.payload) {
                const pcm = b64ToBuf(msg.media.payload);
                const i16_in = pcmBufToI16(pcm);
                const i16_16k = resamplePCM16(i16_in, sampleRate, 16000);
                sendToAgentPCM16k(i16ToBuf(i16_16k));
                return;
            }

            if (msg.event === "stop") {
                finalize("exotel-stop");
            }
        });

        exoWs.on("close", () => finalize("exotel-close"));
        exoWs.on("error", () => finalize("exotel-error"));
        agentWs.on("close", () => finalize("agent-close"));
        agentWs.on("error", () => finalize("agent-error"));
    });

    console.log("✅ Exotel WS bridge registered on /ws/exotel");
}
