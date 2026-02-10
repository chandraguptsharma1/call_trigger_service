// routes/agent.routes.js (ESM)
import { Router } from "express";
const r = Router();

r.get("/signed-url", async (req, res) => {
    try {
        const agentId = process.env.ELEVEN_AGENT_ID;
        const r2 = await fetch(
            `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`,
            { headers: { "xi-api-key": process.env.ELEVEN_API_KEY } }
        );
        if (!r2.ok) {
            const err = await r2.text();
            return res.status(502).json({ ok: false, error: `ElevenLabs: ${err}` });
        }
        const json = await r2.json(); // { signed_url: "wss://..." }
        res.json({ ok: true, ...json });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

export default r;
