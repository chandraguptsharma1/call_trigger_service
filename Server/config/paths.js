import path from "path";
import fs from "fs";

const ROOT = path.resolve(process.cwd(), "server");
export const DATA_DIR = path.join(ROOT, "data");
export const RESUME_DIR = path.join(DATA_DIR, "resumes");
export const PROFILE_DIR = path.join(DATA_DIR, "profiles");
export const DEBUG_DIR = path.join(ROOT, "debug");
export const UPLOAD_DIR = path.join(ROOT, "uploads");

[DATA_DIR, RESUME_DIR, PROFILE_DIR, DEBUG_DIR, UPLOAD_DIR].forEach(p => {
    fs.mkdirSync(p, { recursive: true });
});
