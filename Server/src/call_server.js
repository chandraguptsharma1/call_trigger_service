import express from "express";
import { callCustomerViaExotel } from "./exotel/callCustomerViaExotel.js";

export function registerCallRoutes(app) {
    // Needed to parse Exotel callbacks (form-encoded)
    app.use(express.urlencoded({ extended: false }));

    // ✅ Start outbound call
    app.post("/start-call", async (req, res) => {
        try {
            const { mobileNumber, agentName, customerName, amount, dueDate } = req.body;

            console.log("request body==> ", req.body)

            if (!mobileNumber) {
                return res.status(400).json({ ok: false, message: "mobileNumber required" });
            }

            const result = await callCustomerViaExotel(mobileNumber, {
                agent_name: agentName || "Ritu",
                customer_name: customerName || "Customer",
                amount: amount || "",
                due_date: dueDate || "",
                // optional: force exotel sample rate
                sample_rate: 16000,
            });

            return res.json({ ok: true, result });
        } catch (e) {
            return res.status(500).json({ ok: false, error: String(e?.message || e) });
        }
    });

    /**
     * ✅ ExoML endpoint that Exotel hits (Url=...)
     * This should return XML
     */
    app.get("/exoml/start-voice", (req, res) => {
        const WS_PUBLIC_URL = (process.env.WS_PUBLIC_URL || "").replace(/\/$/, "");
        const wsBase = WS_PUBLIC_URL.startsWith("https://")
            ? WS_PUBLIC_URL.replace("https://", "wss://")
            : WS_PUBLIC_URL.replace("http://", "ws://");

        // ✅ don’t allow unicode here (safe fallback)
        const due_date = String(req.query.due_date || "2026-02-20").replace(/[^\x20-\x7E]/g, "");

        const qs = new URLSearchParams({
            "sample-rate": String(req.query.sample_rate || "16000"),
            agent_name: String(req.query.agent_name || "Ritu"),
            customer_name: String(req.query.customer_name || "Ram"),
            amount: String(req.query.amount || "15000"),
            due_date,
        });

        const streamUrl = `${wsBase}/ws/exotel?${qs.toString()}`;

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Connecting to Sureko AI. Please stay on the line.</Say>
  <Pause length="600"/>
  <Start><Stream url="${streamUrl}" /></Start>
  <Pause length="600"/>
</Response>`;

        res.set("Content-Type", "text/xml");
        res.send(xml);
    });


    // ✅ Exotel status callback
    app.post("/exotel/status", (req, res) => {
        console.log("📞 Exotel StatusCallback:", {
            CallSid: req.body.CallSid,
            CallStatus: req.body.CallStatus,
            From: req.body.From,
            To: req.body.To,
            DialCallStatus: req.body.DialCallStatus,
            Duration: req.body.Duration,
            RecordingUrl: req.body.RecordingUrl,
        });
        res.status(200).send("OK");
    });

    // Safety for double slash
    app.post("//exotel/status", (req, res) => {
        console.log("📞 Exotel StatusCallback(//):", req.body);
        res.status(200).send("OK");
    });
}
