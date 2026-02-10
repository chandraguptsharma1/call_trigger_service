// routes/stt.routes.js
import { Router } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const r = Router();
const upload = multer({ dest: "uploads/" });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Convert to 16kHz mono wav using ffmpeg
 */
function to16kMonoWav(input, output) {
    execSync(
        `ffmpeg -y -i "${input}" -ac 1 -ar 16000 "${output}"`,
        { stdio: "ignore" }
    );
}

r.post("/", upload.single("audio"), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: "No audio file uploaded" });

        const inFile = req.file.path;
        const wavFile = `${inFile}.wav`;

        // 🎤 Normalize to wav
        to16kMonoWav(inFile, wavFile);

        // 🟢 Whisper STT
        const audioBuffer = fs.readFileSync(wavFile);
        const file = new (await import("node:buffer")).File(
            [audioBuffer],
            "audio.wav",
            { type: "audio/wav" }
        );

        const whisperResult = await openai.audio.transcriptions.create({
            model: "whisper-1",
            file,
            response_format: "json",
            language: "en",
        });

        const transcript = whisperResult.text;
        console.log("📝 Transcript:", transcript);

        // Cleanup
        fs.unlinkSync(inFile);
        fs.unlinkSync(wavFile);

        res.json({ transcript });
    } catch (err) {
        console.error("❌ Whisper STT Error:", err);
        res.status(500).json({ error: err.message || "Whisper STT failed" });
    }
});

export default r;
