import path from "path";
import fs from "fs";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { extractText } from "../services/resumeParse.service.js";
import { extractProfile } from "../services/profile.service.js";
import { writeText, writeJSON } from "../services/file.service.js";
import { RESUME_DIR, PROFILE_DIR } from "../config/paths.js";
import { state } from "../state/interviewState.js";

export const uploadResume = asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ ok: false, error: "No resume file" });

    const { path: tmp, originalname, mimetype } = req.file;
    const text = await extractText(tmp, mimetype, originalname);
    try { fs.unlinkSync(tmp); } catch { }

    const stamp = Date.now();
    const resumePath = path.join(RESUME_DIR, `resume-${stamp}.txt`);
    writeText(resumePath, text);

    const profile = await extractProfile(text);
    const profilePath = path.join(PROFILE_DIR, `profile-${stamp}.json`);
    writeJSON(profilePath, profile);

    state.RESUME_TEXT = text;
    state.PROFILE = profile;

    res.json({ ok: true, profile, saved: { resumePath, profilePath } });
});

export const getProfile = asyncHandler(async (req, res) => {
    res.json({ ok: true, profile: state.PROFILE, hasResume: !!state.RESUME_TEXT });
});
