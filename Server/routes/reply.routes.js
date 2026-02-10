// // // routes/reply.routes.js
// // import { Router } from "express";
// // import OpenAI from "openai";
// // import fs from "fs";
// // import path from "path";

// // const r = Router();
// // const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });



// // r.post("/", async (req, res) => {
// //     try {
// //         const { transcript } = req.body || {};
// //         if (!transcript?.trim()) {
// //             return res.status(400).json({ error: "Transcript missing" });
// //         }

// //         console.log("💬 Candidate said:", transcript);

// //         // 📄 Load candidate profile & role
// //         const profile = loadLatestProfile();
// //         const candidateName = profile?.name || "the candidate";
// //         const role = profile?.headline || "Software Engineer";
// //         const skills = profile?.skills?.join(", ") || "general development skills";
// //         const experience = profile?.experience || "relevant work experience";

// //         // 🧠 GPT reply (with resume + role context)
// //         const gptResponse = await openai.chat.completions.create({
// //             model: "gpt-4o",
// //             messages: [
// //                 {
// //                     role: "system",
// //                     content: `You are a professional HR interviewer at Acme Corp.
// // The interview is for the role of **${role}**.
// // The candidate is ${candidateName}, with skills in ${skills}, and experience in ${experience}.
// // Keep the conversation interview-focused: ask about skills, experience, projects, strengths/weaknesses, problem solving.
// // Do not drift into unrelated topics. Keep replies short and polite.`,
// //                 },
// //                 {
// //                     role: "user",
// //                     content: transcript,
// //                 },
// //             ],
// //         });

// //         const reply = gptResponse.choices[0].message.content;
// //         console.log("🤖 AI Reply:", reply);

// //         // 🔊 Generate TTS voice
// //         const ttsResp = await openai.audio.speech.create({
// //             model: "gpt-4o-mini-tts",
// //             voice: "sage", // alloy → verse/sage पर try करो
// //             input: reply,
// //         });


// //         const buf = Buffer.from(await ttsResp.arrayBuffer());
// //         console.log("🎧 TTS bytes:", buf.length);

// //         res.json({
// //             ok: true,
// //             reply,
// //             audio: `data:audio/mpeg;base64,${buf.toString("base64")}`,
// //         });
// //     } catch (err) {
// //         console.error("❌ Reply error:", err);
// //         res.status(500).json({ error: err.message || "Reply failed" });
// //     }
// // });

// // export default r;


// // routes/reply.routes.js
// // routes/reply.routes.js
// import { Router } from "express";
// import OpenAI from "openai";
// import fs from "fs";
// import path from "path";
// import { enhanceSpeech } from "../utils/enhanceSpeech.js";


// const r = Router();
// const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// // 🔹 Interview Questions
// const QUESTIONS = [
//     "Can you tell me about your last project and your role in it?",
//     "What technologies are you most comfortable working with?",
//     "How do you approach debugging a difficult issue?",
//     "Can you explain a challenging problem you solved recently?",
//     "Where do you see yourself in the next 2 years?",
// ];

// // 🔹 State File
// const STATE_FILE = path.join("uploads", "conversation-state.json");

// function loadState() {
//     try {
//         if (fs.existsSync(STATE_FILE)) {
//             return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
//         }
//     } catch (e) {
//         console.error("⚠️ Failed to load state:", e);
//     }
//     return { phase: "intro", currentIndex: 0 };
// }

// function saveState(state) {
//     fs.writeFileSync(STATE_FILE, JSON.stringify(state));
// }

// // Load latest resume profile (saved during upload)
// function loadLatestProfile() {
//     try {
//         const file = path.join("uploads", "latest-profile.json");
//         if (fs.existsSync(file)) {
//             return JSON.parse(fs.readFileSync(file, "utf-8"));
//         }
//     } catch (e) {
//         console.error("⚠️ Failed to load profile:", e);
//     }
//     return {};
// }

// async function generateElevenLabsVoice(text) {
//     const voiceId = process.env.ELEVENLABS_VOICE_ID || "default";
//     console.log("🎙️ Using Voice ID:", voiceId);

//     console.log("🔑 ElevenLabs key:", process.env.ELEVEN_API_KEY ? "Loaded ✅" : "Missing ❌");
//     console.log("🎙️ Voice ID:", process.env.ELEVENLABS_VOICE_ID);

//     const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/kOK74PLxlOjeHcdtb3bD/stream`, {
//         method: "POST",
//         headers: {
//             "xi-api-key": 'sk_f969348815c6ccf301469c4da3f261663b5046dde49605cc',
//             "Content-Type": "application/json",
//         },
//         body: JSON.stringify({
//             text,
//             model_id: "eleven_multilingual_v2",
//             voice_settings: {
//                 stability: 0.4,
//                 similarity_boost: 0.85
//             }
//         })
//     });

//     if (!resp.ok) throw new Error(`ElevenLabs TTS failed ${resp.status}`);
//     return Buffer.from(await resp.arrayBuffer());
// }

// r.post("/", async (req, res) => {
//     try {
//         const { transcript } = req.body || {};
//         if (!transcript?.trim()) {
//             return res.status(400).json({ error: "Transcript missing" });
//         }

//         console.log("💬 Candidate said:", transcript);

//         // 📄 Load candidate profile & role
//         const profile = loadLatestProfile();
//         const candidateName = profile?.name || "the candidate";
//         const role = profile?.headline || "Software Engineer";
//         const skills = profile?.skills?.join(", ") || "general development skills";
//         const experience = profile?.experience || "relevant work experience";

//         // 🧠 Generate GPT reply
//         const gptResponse = await openai.chat.completions.create({
//             model: "gpt-4o",
//             messages: [
//                 {
//                     role: "system",
//                     content: `You are a professional HR interviewer at Acme Corp.The interview is for the role of **${role}**.The candidate is ${candidateName}, with skills in ${skills}, and experience in ${experience}.Keep the conversation interview-focused: ask about skills, experience, projects, strengths/weaknesses, problem solving.Do not drift into unrelated topics. Keep replies short and polite.`,
//                 },
//                 { role: "user", content: transcript },
//             ],
//         });

//         const reply = gptResponse.choices[0].message.content;
//         console.log("🤖 AI Reply:", reply);

//         const enhancedReply = enhanceSpeech(reply);
//         console.log("✨ Enhanced Reply:", enhancedReply);

//         // 🔊 Generate ElevenLabs Voice
//         const buf = await generateElevenLabsVoice(enhancedReply);
//         console.log("🎧 ElevenLabs bytes:", buf.length);

//         res.json({
//             ok: true,
//             reply,
//             audio: `data:audio/mpeg;base64,${buf.toString("base64")}`,
//         });
//     } catch (err) {
//         console.error("❌ Reply error:", err);
//         res.status(500).json({ error: err.message || "Reply failed" });
//     }
// });

// export default r;

// routes/reply.routes.js
import { Router } from "express";
import fs from "fs";
import path from "path";
import { enhanceSpeech } from "../utils/enhanceSpeech.js";

const r = Router();

// 🔹 Interview Questions
const QUESTIONS = [
    "Can you tell me about your last project and your role in it?",
    "What technologies are you most comfortable working with?",
    "How do you approach debugging a difficult issue?",
    "Can you explain a challenging problem you solved recently?",
    "Where do you see yourself in the next 2 years?",
];

// 🔹 State File
const STATE_FILE = path.join("uploads", "conversation-state.json");

function loadState() {
    try {
        if (fs.existsSync(STATE_FILE)) {
            return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
        }
    } catch (e) {
        console.error("⚠️ Failed to load state:", e);
    }
    return { phase: "aiIntro", currentIndex: 0 };
}

function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state));
}

// 🔹 ElevenLabs TTS
async function generateElevenLabsVoice(text) {
    const resp = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}/stream`,
        {
            method: "POST",
            headers: {
                "xi-api-key": process.env.ELEVEN_API_KEY,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                text,
                model_id: "eleven_multilingual_v2",
                voice_settings: { stability: 0.4, similarity_boost: 0.85 },
            }),
        }
    );
    if (!resp.ok) throw new Error(`ElevenLabs TTS failed ${resp.status}`);
    return Buffer.from(await resp.arrayBuffer());
}

r.post("/", async (req, res) => {
    try {
        const { transcript } = req.body || {};
        if (!transcript?.trim()) {
            return res.status(400).json({ error: "Transcript missing" });
        }

        console.log("💬 Candidate said:", transcript);

        // 🔹 Load conversation state
        let state = loadState();
        let reply = "";

        if (state.phase === "aiIntro") {
            reply =
                "Hello, I am your interviewer from Acme Corp. This interview is for the role of Software Engineer. Could you please start by introducing yourself?";
            state.phase = "intro";
        } else if (state.phase === "intro") {
            reply =
                "Thank you for the introduction. Let's begin with some interview questions.";
            state.phase = "questions";
            state.currentIndex = 0;
        } else if (state.phase === "questions") {
            if (state.currentIndex < QUESTIONS.length) {
                reply = QUESTIONS[state.currentIndex];
                state.currentIndex++;
            } else {
                reply =
                    "That concludes our interview. Thank you for your time and best of luck!";
                state.phase = "end";
            }
        } else if (state.phase === "end") {
            reply =
                "The interview has already ended. Thank you once again for participating.";
        }

        saveState(state);
        console.log("🤖 AI Reply:", reply);

        const enhancedReply = enhanceSpeech(reply);
        console.log("✨ Enhanced Reply:", enhancedReply);

        // 🔊 ElevenLabs voice
        const buf = await generateElevenLabsVoice(enhancedReply);

        res.json({
            ok: true,
            reply,
            audio: `data:audio/mpeg;base64,${buf.toString("base64")}`,
        });
    } catch (err) {
        console.error("❌ Reply error:", err);
        res.status(500).json({ error: err.message || "Reply failed" });
    }
});

export default r;
