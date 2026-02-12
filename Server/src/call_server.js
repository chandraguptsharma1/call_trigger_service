import { callCustomerViaExotel } from "./exotel/callCustomerViaExotel.js";
import express from "express";

export function registerCallRoutes(app) {
    app.post("/start-call", async (req, res) => {
        try {
            const { mobileNumber, agentName, customerName, amount, dueDate } = req.body;

            if (!mobileNumber) {
                return res.status(400).json({ ok: false, message: "mobileNumber required" });
            }

            const result = await callCustomerViaExotel(mobileNumber, {
                agent_name: agentName || "Ritu",
                customer_name: customerName || "Customer",
                amount: amount || "",
                due_date: dueDate || "",
            });

            return res.json({ ok: true, result });
        } catch (e) {
            return res.status(500).json({ ok: false, error: String(e?.message || e) });
        }
    });

    // Add this in registerCallRoutes
    app.all("/exoml/start-voice", (req, res) => {
        console.log("🟢 [ExoML] /exoml/start-voice HIT");

        // NGrok URL ko protocol-neutral banayein
        let baseUrl = process.env.WS_PUBLIC_URL.replace(/\/$/, "");

        // Protocol logic: Agar https hai toh wss banayein, warna ws
        let wsUrl = baseUrl.startsWith('https')
            ? baseUrl.replace('https://', 'wss://')
            : baseUrl.replace('http://', 'ws://');

        // Final Stream URL setup
        const streamUrl = `${wsUrl}/ws/exotel`;

        console.log("🟢 [ExoML] Using Stream URL:", streamUrl);

        // Zaroori: <Say> tag ko thoda lamba rakhein taaki handshake complete ho jaye
        const response = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Start>
        <Stream url="${streamUrl}" />
    </Start>
    <Say voice="alice">Connecting to Sureko AI. Please stay on the line.</Say>
    <Pause length="3"/>
</Response>`;

        res.set("Content-Type", "text/xml");
        res.send(response);
        console.log("✅ [ExoML] Response sent successfully");
    });


    app.post("/exotel/status", express.urlencoded({ extended: false }), (req, res) => {
        console.log("📞 Exotel StatusCallback:", req.body);
        res.send("OK");
    });

    // ✅ safety for double slash hits
    app.post("//exotel/status", express.urlencoded({ extended: false }), (req, res) => {
        console.log("📞 Exotel StatusCallback(//):", req.body);
        res.status(200).send("OK");
    });

}
