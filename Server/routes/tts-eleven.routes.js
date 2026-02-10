// routes/tts-eleven.routes.js
import { Router } from "express";
import fetch from "node-fetch";

const r = Router();

r.post("/", async (req, res) => {
    try {
        const { text, voice = "Kanika", lang = "hi" } = req.body || {};
        if (!text?.trim()) {
            return res.status(400).json({ error: "No text provided" });
        }

        console.log("🎤 ElevenLabs input:", text);

        const voiceId = "EXAVITQu4vr4xnSDxMaL"; // 👉 Kanika का ID डालना पड़ेगा

        const resp = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
            {
                method: "POST",
                headers: {
                    "xi-api-key": process.env.ELEVEN_API_KEY,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    text,
                    model_id: "eleven_multilingual_v2", // Hindi, English दोनों सपोर्ट
                    voice_settings: {
                        stability: 0.4,
                        similarity_boost: 0.9
                    }
                })
            }
        );

        if (!resp.ok) {
            throw new Error(`ElevenLabs error: ${resp.statusText}`);
        }

        const buf = Buffer.from(await resp.arrayBuffer());
        console.log("✅ Audio generated, size:", buf.length);

        res.setHeader("Content-Type", "audio/mpeg");
        res.send(buf);
    } catch (err) {
        console.error("❌ ElevenLabs TTS error:", err);
        res.status(500).json({ error: "TTS failed" });
    }
});

export default r;
