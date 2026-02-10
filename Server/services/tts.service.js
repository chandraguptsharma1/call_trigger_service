// services/tts.service.js
import fs from "fs";
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function synthOpenAITTS(text, outFile, { voice = "alloy", format = "mp3" } = {}) {
    const resp = await openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice,
        input: text,
        format, // "mp3" | "wav"
    });
    const buf = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(outFile, buf);
    return outFile;
}
