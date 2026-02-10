import { Router } from "express";
import { upload } from "../middleware/upload.middleware.js";
import { uploadResume, getProfile } from "../controllers/resume.controller.js";
const r = Router();
import path from "path";
import fs from "fs";
const PROFILES_DIR = path.join(process.cwd(), "Server", "data", "profiles");

r.post("/upload", upload.single("resume"), uploadResume);
r.get("/profile", getProfile);
r.get("/latest", (req, res) => {
    try {
        if (!fs.existsSync(PROFILES_DIR)) {
            return res.status(404).json({ error: "Profiles directory not found" });
        }

        const files = fs.readdirSync(PROFILES_DIR).filter(f => f.startsWith("profile-") && f.endsWith(".json"));
        if (!files.length) {
            return res.status(404).json({ error: "No profile files found" });
        }

        // sort by timestamp in filename
        const latestFile = files.sort((a, b) => {
            const aTime = parseInt(a.split("-")[1], 10);
            const bTime = parseInt(b.split("-")[1], 10);
            return bTime - aTime;
        })[0];

        const latestPath = path.join(PROFILES_DIR, latestFile);
        const profile = JSON.parse(fs.readFileSync(latestPath, "utf8"));

        res.json({ ok: true, profile });
    } catch (e) {
        console.error("❌ load profile error:", e);
        res.status(500).json({ error: "Failed to load profile" });
    }
});


export default r;
