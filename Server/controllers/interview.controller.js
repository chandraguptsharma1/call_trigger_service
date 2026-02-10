import path from "path";
import fs from "fs";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { state, resetFlow } from "../state/interviewState.js";
import { getHelloLine, buildIntroScript, guardrail } from "../services/llm.service.js";
import { buildQuestions } from "../services/questions.service.js";
import { ensureWav16kMono, whisperTranscribe } from "../services/stt.service.js";

import { UPLOAD_DIR } from "../config/paths.js";

export const configInterview = asyncHandler(async (req, res) => {
    const { recruiterName, companyName, companyAbout, role, jd, lang } = req.body || {};
    if (recruiterName) state.CONFIG.recruiterName = recruiterName;
    if (companyName) state.CONFIG.companyName = companyName;
    if (companyAbout) state.CONFIG.companyAbout = companyAbout;
    if (role) state.CONFIG.role = role;
    if (jd !== undefined) state.CONFIG.jd = jd;
    if (lang) state.CONFIG.lang = String(lang).toLowerCase();
    res.json({ ok: true, config: state.CONFIG });
});

// export const hello = asyncHandler(async (req, res) => {
//     const line = await getHelloLine({ lang: state.CONFIG.lang });
//     res.json({ ok: true, text: line });
// });

export const hello = async (req, res) => {
    try {
        const agentId = 'agent_0301k4wpb9m0fkr8br9f85ck8eye';
        const ELEVEN_API_KEY = process.env.ELEVEN_API_KEY;

        const response = await fetch(
            `https://api.elevenlabs.io/v1/convai/agents/${agentId}/inference`,
            {
                method: "POST",
                headers: {
                    "xi-api-key": ELEVEN_API_KEY,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    conversation: "new",   // or pass a conversation_id to continue
                    input: "Hello, can you hear me clearly?"
                })
            }
        );

        if (!response.ok) {
            throw new Error(`ElevenLabs API failed: ${await response.text()}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        res.setHeader("Content-Type", "audio/mpeg");
        res.send(buffer);
    } catch (err) {
        console.error("❌ ElevenLabs Agent error:", err);
        res.status(500).json({ error: err.message });
    }
};

export const introStart = asyncHandler(async (req, res) => {
    const script = await buildIntroScript({
        recruiterName: state.CONFIG.recruiterName,
        companyName: state.CONFIG.companyName,
        companyAbout: state.CONFIG.companyAbout,
        role: state.CONFIG.role,
        lang: state.CONFIG.lang,
        profile: state.PROFILE
    });
    res.json({ ok: true, script });
});

export const nextQuestion = asyncHandler(async (req, res) => {
    if (!state.FLOW.started) {
        state.FLOW.started = true;
        return res.json({ type: "intro", text: "Hello, welcome to the interview! Can you hear me properly?" });
    }
    if (!state.FLOW.introDone) {
        state.FLOW.introDone = true;
        if (!state.QUESTIONS.length) {
            state.QUESTIONS = await buildQuestions({
                role: state.CONFIG.role, jd: state.CONFIG.jd, lang: state.CONFIG.lang, profile: state.PROFILE
            });
        }
        return res.json({ type: "rapport", text: "Great! Let’s begin. I’ll ask you a few questions." });
    }
    if (state.FLOW.current < state.QUESTIONS.length) {
        const q = state.QUESTIONS[state.FLOW.current++];
        return res.json({ type: "question", index: state.FLOW.current, text: q });
    }
    if (!state.FLOW.finished) {
        state.FLOW.finished = true;
        return res.json({ type: "closing", text: "Thank you for your time. We will get back to you soon. Have a nice day!" });
    }
    return res.json({ type: "done", text: "" });
});

export const resetInterview = asyncHandler(async (req, res) => {
    resetFlow();
    res.json({ ok: true, state: state.FLOW });
});

// audio or text reply
export const interviewerReply = asyncHandler(async (req, res) => {
    let transcript = (req.body?.text || "").trim();

    // if audio provided, transcribe first
    if (req.file) {
        const wav = `${req.file.path}.wav`;
        await ensureWav16kMono(req.file.path, wav);
        transcript = await whisperTranscribe(wav, "en");
        try { fs.unlinkSync(req.file.path); } catch { }
        try { fs.unlinkSync(wav); } catch { }
    }

    if (!transcript) return res.status(400).json({ ok: false, error: "Empty input" });

    const guard = await guardrail({
        text: transcript,
        lang: state.CONFIG.lang || "en",
        role: state.CONFIG.role || "Software Engineer",
        profile: state.PROFILE
    });

    // (optional) synth small mp3 for reply (English only for now)
    let audio;
    try {
        const out = path.join(UPLOAD_DIR, `tts-${Date.now()}.mp3`);
        // await ttsToMp3(guard.recruiter_reply, "en", out);
        audio = `data:audio/mpeg;base64,${fs.readFileSync(out).toString("base64")}`;
        fs.unlinkSync(out);
    } catch { }

    res.json({
        ok: true,
        transcript,
        intent: guard.intent,
        reply: guard.recruiter_reply,
        coach: guard.coach,
        audio
    });
});
