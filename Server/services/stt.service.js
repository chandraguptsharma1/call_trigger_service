import fs from "fs";
import ffmpeg from "../config/ffmpeg.js";
import { openai } from "../config/openai.js";

export function ensureWav16kMono(input, output) {
    return new Promise((resolve, reject) => {
        // 16k, mono
        ffmpeg(input).audioFrequency(16000).audioChannels(1).format("wav")
            .on("end", () => resolve(output))
            .on("error", reject).save(output);
    });
}

export async function whisperTranscribe(wavPath, lang = "en") {
    const resp = await openai.audio.transcriptions.create({
        model: "whisper-1",
        file: fs.createReadStream(wavPath),
        language: lang
    });
    return resp?.text || "";
}
