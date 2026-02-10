// node v18+
// npm i ws dotenv
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import express from "express";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { connectMongo } from "../config/mongo.js";
import { CallLog } from "../models/CallLog.model.js";
import cors from "cors";

dotenv.config();

await connectMongo();




// ------------------ EXPRESS SETUP ------------------
const app = express();
app.use(express.json());

app.use(cors({
    origin: "http://localhost:4200", // ✅ exact origin (NOT '*')
    credentials: true,               // ✅ allow cookies
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));


app.use(express.text({ type: ["text/plain", "text/*"] }));
app.use(express.json()); // keep json too for other APIs


// ------------------ CONFIG --------------------------

const PORT = Number(process.env.PORT || 8091);
const XI = "sk_71d6d391f808abc0afa63ec8ac5443ede76df5a8b20964f1" || "";
const AGENT_ID = "agent_2201kdxbf8rcfp3bqsp8z0zmg2y5" || "";
const WAIT_SEC = Number(process.env.WAIT_SEC ?? 0);
const SAVE_OUT = String(process.env.SAVE_OUT || "false") === "true";


/* ---------- PCM → WAV helper ---------- */
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
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(dataSize, 40);
    return Buffer.concat([header, pcm]);
}

// ---------------- HTTP + WS SERVER -------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws/app" });

// ---------------------- MAIN WS ----------------------
wss.on("connection", (client, req) => {
    const urlObj = new URL(req.url, "http://localhost");
    const agentName = urlObj.searchParams.get("agent_name");
    const customerName = urlObj.searchParams.get("customer_name");
    const dueAmount = urlObj.searchParams.get("amount");
    const dueDate = urlObj.searchParams.get("due_date");

    console.log("🟢 UI Connected:", { agentName, customerName, dueAmount, dueDate });

    let closed = false;
    let idleTimer = null;
    let pingIv = null;
    let agentOpen = false;

    const pending = [];
    const agentPcmChunks = [];

    // ---------------- Conversation State Tracking ----------------
    let conversationState = {
        paymentIntent: null,
        rescheduleDate: null,
        rescheduleTime: null,
        paymentMethod: null,
        finalClosed: false,

        // 👇 NEW FLAGS
        paymentQuestionAsked: false,
        paymentAnswerCaptured: false,
        paymentRawResponse: null
    };


    // function saveFinalUserResponse(data) {
    //     try {
    //         const outDir = path.join(process.cwd(), "call_logs");
    //         fs.mkdirSync(outDir, { recursive: true });

    //         const logFile = path.join(outDir, `call_${Date.now()}.json`);
    //         fs.writeFileSync(logFile, JSON.stringify(data, null, 2));

    //         console.log("💾 FINAL RESPONSE SAVED:", logFile);
    //     } catch (err) {
    //         console.error("Save error:", err);
    //     }
    // }


    const isClosingMessage = (text = "") => {
        const t = String(text).toLowerCase()

        // Must contain a THANKS signal (otherwise "नमस्ते" greeting will wrongly end call)
        const hasThanks =
            t.includes("आपके समय के लिए धन्यवाद") ||
            t.includes("कॉल करने के लिए धन्यवाद") ||
            t.includes("धन्यवाद") ||
            t.includes("thank you")

        // Optional: common end lines
        const hasEndLine =
            t.includes("हमारा सपोर्ट स्पेशलिस्ट") ||
            t.includes("हमारा support specialist") ||
            t.includes("नमस्ते") || // keep only if THANKS present
            t.includes("bye") ||
            t.includes("goodbye")

        return hasThanks && hasEndLine
    }



    async function saveFinalUserResponse(data, status = "completed") {
        if (conversationState._saved) return;
        conversationState._saved = true;

        try {
            const doc = await CallLog.create({
                agentName,
                customerName,
                dueAmount,
                dueDate,
                paymentIntent: data.paymentIntent,
                paymentRawResponse: data.paymentRawResponse, // 👈 ADD THIS FIELD
                rescheduleDate: data.rescheduleDate,
                rescheduleTime: data.rescheduleTime,
                paymentMethod: data.paymentMethod,
                callStatus: status,
                meta: data,
            });

            console.log("💾 MongoDB saved:", doc._id);
        } catch (err) {
            console.error("❌ Mongo save error:", err);
        }
    }



    const bumpIdle = () => {
        if (WAIT_SEC <= 0) return;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => finalize("idle-timeout"), WAIT_SEC * 1000);
    };

    const finalize = async (reason, code = 1000) => {
        if (closed) {
            console.log("⛔ finalize ignored:", reason);
            return;
        }
        closed = true;

        console.log("🔻 FINALIZED:", reason);

        await saveFinalUserResponse(conversationState, reason);

        clearTimeout(idleTimer);
        clearInterval(pingIv);

        // ✅ IMPORTANT: inform UI first
        try {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: "call_ended", reason }));
            }
        } catch { }

        // ✅ give UI time to receive the message
        await new Promise((r) => setTimeout(r, 80));

        // close sockets
        try { client.close(code, reason); } catch { }
        try { agent.close(code, reason); } catch { }

        console.log("🔻 CLOSED:", reason, code);
    };



    // ---------------- HEARTBEAT ----------------
    client.isAlive = true;
    client.on("pong", () => (client.isAlive = true));

    pingIv = setInterval(() => {
        if (!client.isAlive) return finalize("client-lost");
        client.isAlive = false;
        client.ping();
    }, 15000);

    // ---------------- ELEVENLABS WS ----------------
    const agentUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${AGENT_ID}`;
    const agent = new WebSocket(agentUrl, { headers: { "xi-api-key": XI } });

    function sendToAgent(data, isBinary) {
        if (!agentOpen) {
            pending.push({ data, isBinary });
            return;
        }
        try {
            if (isBinary) {
                const b64 = Buffer.from(data).toString("base64");
                agent.send(JSON.stringify({ user_audio_chunk: b64 }));
            } else {
                agent.send(data.toString());
            }
        } catch { }
    }

    // ---------------- AGENT OPEN ----------------
    agent.on("open", () => {
        console.log("🤖 Agent WS open");
        agentOpen = true;

        client.send(JSON.stringify({ type: "agent_ready" }));

        agent.send(JSON.stringify({
            type: "conversation_initiation_client_data",
            conversation_initiation_client_data: {
                conversation_config_override: {
                    conversation: {
                        text_only: false,
                        agent_output_audio_format: "pcm_16000",
                        user_input_audio_format: "pcm_16000",
                        model_id: "eleven_multilingual_v2",
                        agent: { voice: { voice_id: "6pVydnYcVtMsrrSeUKs6" } }
                    }
                }
            },
            dynamic_variables: {
                agent_name: agentName,
                customer_name: customerName,
                due_amount: dueAmount,
                due_date: dueDate
            }
        }));

        // ✅ FORCE ENABLE PAYMENT QUESTION
        conversationState.paymentQuestionAsked = true;
        console.log("✅ paymentQuestionAsked FORCED TRUE");

        // Flush pending messages
        for (const p of pending) sendToAgent(p.data, p.isBinary);
        pending.length = 0;

        bumpIdle();
    });

    // ---------------- UI → Agent ----------------
    client.on("message", (data, isBinary) => {
        if (conversationState.finalClosed) {
            console.log("🚫 UI message ignored after call end")
            return
        }
        sendToAgent(data, isBinary)
        bumpIdle()
    })


    // ---------------- AGENT → UI + CAPTURE LOGIC ----------------
    agent.on("message", async (buf) => {

        if (conversationState.finalClosed) {
            console.log("🚫 Agent packet ignored after call end");
            return;
        }

        let json;
        try { json = JSON.parse(buf.toString()); } catch { }

        // ✅ detect closing only on agent_response / agent_transcript
        let closingText = ""
        if (json?.type === "agent_response") {
            closingText = json?.agent_response_event?.agent_response || ""
        } else if (json?.type === "agent_transcript") {
            closingText = json?.transcript || ""
        }

        if (closingText && isClosingMessage(closingText)) {
            console.log("🔚 Closing detected:", closingText)
            // notify UI (optional)
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: "call_ended", reason: "agent-thankyou" }))
            }
            return finalize("agent-thankyou")
        }

        // console.log("agent conversation log ==>", json);

        // AUDIO
        if (json?.type === "audio") {
            if (json.audio_event?.audio_base_64) {
                agentPcmChunks.push(Buffer.from(json.audio_event.audio_base_64, "base64"));
            }
        }

        // ✅ AGENT TRANSCRIPT → detect payment question
        // if (json?.type === "agent_transcript") {
        //     const agentText = json.transcript?.toLowerCase() || "";

        //     if (
        //         agentText.includes("payment") ||
        //         agentText.includes("आज ही") ||
        //         agentText.includes("अभी")
        //     ) {
        //         conversationState.paymentQuestionAsked = true;
        //         console.log("❓ Payment question detected:", agentText);
        //     }
        // }

        // ✅ USER TRANSCRIPT CAPTURE (matches your logs)
        if (json?.type === "user_transcript") {
            const rawText =
                json?.user_transcription_event?.user_transcript ||
                json?.transcript ||
                ""

            if (rawText) {
                console.log("👂 USER:", rawText)

                const text = rawText.toLowerCase()

                if (
                    conversationState.paymentQuestionAsked &&
                    !conversationState.paymentAnswerCaptured
                ) {
                    conversationState.paymentAnswerCaptured = true
                    conversationState.paymentRawResponse = rawText

                    if (text.includes("नहीं")) {
                        conversationState.paymentIntent = "cannot_pay_now"
                    } else if (text.includes("आज") || text.includes("अभी")) {
                        conversationState.paymentIntent = "pay_today"
                    } else if (
                        text.includes("कल") ||
                        text.includes("तारीख") ||
                        text.includes("बाद")
                    ) {
                        conversationState.paymentIntent = "pay_later"
                    } else {
                        conversationState.paymentIntent = "unclear"
                    }

                    console.log("💾 PAYMENT RESPONSE CAPTURED:", {
                        intent: conversationState.paymentIntent,
                        response: rawText,
                    })
                }
            }
        }



        // ---------------- CALL END DETECTION ----------------
        // if (json?.type === "conversation_finished" && !conversationState.finalClosed) {
        //     conversationState.finalClosed = true;

        //     console.log("☎️ CALL FINISHED BY AGENT");

        //     saveFinalUserResponse(conversationState);

        //     client.send(JSON.stringify({
        //         type: "final_summary",
        //         data: conversationState
        //     }));
        // }

        if (json?.type === "conversation_finished" && !conversationState.finalClosed) {
            conversationState.finalClosed = true;

            console.log("☎️ CALL FINISHED → HARD STOP");

            await saveFinalUserResponse(conversationState, "agent-ended");

            // Notify UI
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: "call_ended",
                    reason: "agent-ended"
                }));
            }

            // 🔥 HARD TERMINATION (NO MERCY)
            setTimeout(() => {
                try { agent.terminate(); } catch { }
                try { client.terminate(); } catch { }
            }, 100);

            return;
        }



        // Forward to UI
        if (client.readyState === WebSocket.OPEN) {
            client.send(buf.toString());
        }

        bumpIdle();
    });

    // ---------------- CLOSE HANDLERS ----------------
    client.on("close", () => finalize("client-close"));
    client.on("error", () => finalize("client-error"));
    agent.on("close", () => finalize("agent-close"));
    agent.on("error", () => finalize("agent-error"));
});

// ---------------- GET ALL CALL LOGS ----------------
app.get("/call-logs", async (req, res) => {
    try {
        const logs = await CallLog.find()
            .sort({ createdAt: -1 })
            .limit(100); // last 100 calls

        res.json({
            success: true,
            count: logs.length,
            data: logs,
        });
    } catch (err) {
        console.error("GET call logs error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post("/call-logs", async (req, res) => {
    try {
        const payload = req.body;

        const doc = await CallLog.create({
            agentName: payload.agentName,
            customerName: payload.customerName,
            dueAmount: payload.dueAmount,
            dueDate: payload.dueDate,

            paymentIntent: payload.paymentIntent,
            paymentRawResponse: payload.paymentRawResponse,

            rescheduleDate: payload.rescheduleDate,
            rescheduleTime: payload.rescheduleTime,
            paymentMethod: payload.paymentMethod,

            callStatus: payload.callStatus || "completed",
            meta: payload.meta || payload,
        });

        return res.json({ success: true, id: doc._id });
    } catch (e) {
        console.error("❌ /call-logs save error:", e);
        return res.status(500).json({ success: false, error: e.message });
    }
});



// ---------------- Start Call API ----------------
app.post("/start-call", async (req, res) => {
    const { phone } = req.body;

    if (!phone) {
        return res.status(400).json({ error: "Phone number missing" });
    }

    try {
        const response = await fetch("https://api.elevenlabs.io/v1/convai/call", {
            method: "POST",
            headers: {
                "xi-api-key": XI,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                agent_id: AGENT_ID,
                to_number: phone,
                voice: "6pVydnYcVtMsrrSeUKs6",
                metadata: { reason: "loan_collection" }
            }),
        });

        const data = await response.json();
        res.json({ success: true, data });

    } catch (err) {
        console.error("CALL ERROR:", err);
        res.status(500).json({ error: "Call failed", details: err.message });
    }
});

const mapEndReasonToCallStatus = (endReason) => {
    switch (endReason) {
        case "manual_disconnect":
        case "client-close":
        case "ws_close":
            return "client-close";       // ✅ your existing enum
        case "ws_error":
            return "failed";             // ✅ if enum has failed/error
        case "beforeunload":
        case "page_hidden":
        case "ngOnDestroy":
            return "dropped";            // ✅ if enum has dropped
        default:
            return "dropped";
    }
};

app.post("/call-logs/from-conversation", async (req, res) => {
    try {
        const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

        const conversation = payload?.conversation || [];
        console.log("✅ /from-conversation len =", conversation.length, "sid=", payload.sessionId);

        const extracted = extractPaymentPromise(conversation);
        const callStatus = mapEndReasonToCallStatus(payload.endReason);

        const doc = await CallLog.create({
            sessionId: payload.sessionId,
            agentName: payload.agentName,
            customerName: payload.customerName,
            dueAmount: String(payload.dueAmount),
            dueDate: payload.dueDate ?? null,

            paymentRawResponse: extracted.answerText || payload.paymentDateAnswerText || null,
            rescheduleDate: extracted.dateISO || null,
            rescheduleTime: extracted.timeHHmm || null,

            callStatus,

            meta: {
                endReason: payload.endReason,
                endedAt: payload.endedAt,
                convLen: conversation.length,
                lastUser: conversation.filter(x => x.role === "user").slice(-2).map(x => x.text),
                extracted,
            },
        });

        return res.json({ success: true, id: doc._id, callStatus, extracted });
    } catch (err) {
        console.error("from-conversation error:", err);
        return res.status(500).json({ success: false, error: err.message });
    }
});




// routes/calllog.routes.js (or in server file)
// app.post("/call-logs/from-conversation", async (req, res) => {
//     try {
//         const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

//         const conversation = payload?.conversation || [];
//         console.log("✅ /from-conversation got len =", conversation.length, "sid=", payload.sessionId);

//         const doc = await CallLog.create({
//             sessionId: payload.sessionId,
//             agentName: payload.agentName,
//             customerName: payload.customerName,
//             dueAmount: String(payload.dueAmount),
//             dueDate: payload.dueDate ?? null,

//             // optional extracted
//             paymentRawResponse: payload.paymentDateAnswerText ?? null,

//             meta: {
//                 endReason: payload.endReason,
//                 endedAt: payload.endedAt,
//                 conversation, // testing ok
//             },

//             callStatus: payload.endReason || "completed",
//         });

//         return res.json({ success: true, data: doc });
//     } catch (err) {
//         console.error("from-conversation error:", err);
//         return res.status(500).json({ success: false, error: err.message });
//     }
// });



function extractPaymentPromise(conversation = []) {
    const isAgentAsk = (t = "") => {
        t = t.toLowerCase();
        return (
            t.includes("कब") ||
            t.includes("कब तक") ||
            t.includes("कौन") && t.includes("तारीख") ||
            t.includes("payment") && t.includes("कब")
        );
    };

    // find last agent ask index
    let askIdx = -1;
    for (let i = conversation.length - 1; i >= 0; i--) {
        const m = conversation[i];
        if (m?.role === "agent" && isAgentAsk(m?.text || "")) {
            askIdx = i;
            break;
        }
    }
    if (askIdx === -1) return { answerText: null, dateISO: null, timeHHmm: null };

    // find first user message after ask (ignore "...", "ok", etc)
    let ans = null;
    for (let i = askIdx + 1; i < conversation.length; i++) {
        const m = conversation[i];
        if (m?.role !== "user") continue;
        const txt = (m.text || "").trim();
        if (!txt || txt === "..." || txt.toLowerCase() === "ok" || txt === "ओके।") continue;
        ans = txt;
        break;
    }

    const parsed = parseHindiDateTime(ans || "");
    return { answerText: ans, ...parsed };
}

function parseHindiDateTime(text = "") {
    const t = normalizeSpeech(text); // ✅ normalize first

    let timeHHmm = null;
    const mTime = t.match(/(\d{1,2})\s*[:.]\s*(\d{2})/);
    if (mTime) timeHHmm = `${mTime[1].padStart(2, "0")}:${mTime[2]}`;

    const months = {
        "जनवरी": 0, "फरवरी": 1, "फ़रवरी": 1, "मार्च": 2, "अप्रैल": 3, "मई": 4,
        "जून": 5, "जुलाई": 6, "अगस्त": 7, "सितंबर": 8, "सितम्बर": 8,
        "अक्टूबर": 9, "नवंबर": 10, "नवम्बर": 10, "दिसंबर": 11, "दिसम्बर": 11,
    };

    // day: digit first
    let day = null;
    const mDay = t.match(/\b(\d{1,2})\b/);
    if (mDay) day = parseInt(mDay[1], 10);

    // else: english words total (twenty one)
    if (!day) {
        const map = {
            one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
            eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
            twenty: 20, thirty: 30
        };
        const words = t.split(/\s+/).filter(Boolean);
        let total = 0;
        for (const w of words) if (map[w]) total += map[w];
        if (total >= 1 && total <= 31) day = total;
    }

    let monthIdx = null;
    for (const k of Object.keys(months)) {
        if (t.includes(k)) { monthIdx = months[k]; break; }
    }

    if (day && monthIdx !== null) {
        const now = new Date();
        let year = now.getFullYear();
        let dt = new Date(year, monthIdx, day);

        // if already passed, assume next year
        if (dt.getTime() < now.getTime() - 24 * 3600 * 1000) {
            year += 1;
            dt = new Date(year, monthIdx, day);
        }

        const yyyy = dt.getFullYear();
        const mm = String(dt.getMonth() + 1).padStart(2, "0");
        const dd = String(dt.getDate()).padStart(2, "0");

        const dateISO = `${yyyy}-${mm}-${dd}`;
        const dateEN = dt.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });

        return { dateISO, timeHHmm, dateEN };
    }

    return { dateISO: null, timeHHmm, dateEN: null };
}


function normalizeSpeech(text = "") {
    let t = String(text).toLowerCase();

    // remove punctuation
    t = t.replace(/[।.,!?]/g, " ").replace(/\s+/g, " ").trim();

    // month phonetics → proper month token
    t = t
        .replace(/दिस\s*एम्बर|डिस\s*एम्बर|दिसेम्बर|डिसेम्बर|डिसम्बर/g, "दिसंबर")
        .replace(/सेप\s*टेम्बर|सितेम्बर/g, "सितंबर")
        .replace(/अक्टो\s*बर/g, "अक्टूबर")
        .replace(/नव\s*म्बर/g, "नवंबर");

    // transliterated english numbers (common STT output) → english words
    t = t
        .replace(/\bट्वेंटी\b/g, "twenty")
        .replace(/\bवन\b/g, "one")
        .replace(/\bटू\b/g, "two")
        .replace(/\bथ्री\b/g, "three")
        .replace(/\bफोर\b/g, "four")
        .replace(/\bफाइव\b/g, "five")
        .replace(/\bसिक्स\b/g, "six")
        .replace(/\bसेवन\b/g, "seven")
        .replace(/\bएट\b/g, "eight")
        .replace(/\bनाइन\b/g, "nine")
        .replace(/\bटेन\b/g, "ten")
        .replace(/\bइलेवन\b/g, "eleven")
        .replace(/\bट्वेल्व\b/g, "twelve");

    // december in english variants
    t = t.replace(/\bdecember\b|\bdec\b/g, "दिसंबर");

    return t.replace(/\s+/g, " ").trim();
}




function toISODate(d) {
    // returns YYYY-MM-DD (treat as local date)
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}


// ---------------- START SERVER ----------------
const HOST = "0.0.0.0";
server.listen(PORT, HOST, () => {
    console.log(`🚀 Server running on http://${HOST}:${PORT}`);
    console.log(`🔗 WS path ws://${HOST}:${PORT}/ws/app`);
});

// graceful shutdown
process.on("SIGINT", () => { server.close(() => process.exit(0)); });
process.on("SIGTERM", () => { server.close(() => process.exit(0)); });