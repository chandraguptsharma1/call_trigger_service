import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import { execFileSync } from "child_process";

const FF = process.env.FFMPEG_BIN || ffmpegStatic;
const FP = process.env.FFPROBE_BIN || undefined;

if (!FF) console.warn("⚠️ ffmpeg-static not found and FFMPEG_BIN not set.");
else {
    try {
        const v = execFileSync(FF, ["-version"], { stdio: "pipe" })
            .toString().split("\n")[0];
        console.log("ffmpeg OK ->", v);
    } catch (e) {
        console.warn("ffmpeg self-test failed:", e?.message);
    }
}

ffmpeg.setFfmpegPath(FF);
if (FP) ffmpeg.setFfprobePath(FP);

export default ffmpeg;
