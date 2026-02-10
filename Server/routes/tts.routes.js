// routes/tts.routes.js
import { Router } from "express";
import fs from "fs";
import path from "path";
import { enhanceSpeech } from "../utils/enhanceSpeech.js";


const r = Router();

// uploads folder create (if not exists)
const SAVE_DIR = path.join(process.cwd(), "uploads");
fs.mkdirSync(SAVE_DIR, { recursive: true });

// 🔹 ElevenLabs Settings
const ELEVENLABS_API_KEY = process.env.ELEVEN_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "pNInz6obpgDQGcFmaJgB"; // Alloy-like default

r.post("/", async (req, res) => {
    try {
        const { text } = req.body || {};
        if (!text?.trim()) {
            return res.status(400).json({ error: "No text provided" });
        }

        console.log("🎤 TTS input:", text);


        const enhancedText = enhanceSpeech(text);
        console.log("✨ Enhanced TTS input:", enhancedText);

        // 🔹 Call ElevenLabs API
        const response = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/kOK74PLxlOjeHcdtb3bD`,
            {
                method: "POST",
                headers: {
                    "xi-api-key": 'sk_f969348815c6ccf301469c4da3f261663b5046dde49605cc',
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    text,
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.8,
                    },
                }),
            }
        );

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`ElevenLabs API failed: ${errText}`);
        }

        const buf = Buffer.from(await response.arrayBuffer());
        console.log("✅ Bytes generated:", buf.length);

        // 🔹 save file to uploads directory
        const filePath = path.join(SAVE_DIR, `tts-${Date.now()}.mp3`);
        fs.writeFileSync(filePath, buf);
        console.log("💾 File saved:", filePath);

        res.setHeader("Content-Type", "audio/mpeg");
        res.send(buf);
    } catch (e) {
        console.error("❌ TTS failed:", e);
        res.status(500).json({ error: "TTS failed" });
    }
});

export default r;
