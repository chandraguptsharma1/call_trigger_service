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
    app.get("/exoml/start-voice", (req, res) => {
        const streamUrl = `wss://${process.env.PUBLIC_BASE_URL.replace('https://', '')}/ws/exotel`;

        // Yaha hum <Stream> tag use kar rahe hain audio fork karne ke liye
        const response = `<?xml version="1.0" encoding="UTF-8"?>
    <Response>
        <Start>
            <Stream url="${streamUrl}" />
        </Start>
        <Say>Please wait while we connect you to our AI assistant.</Say>
        </Response>`;

        res.set("Content-Type", "text/xml");
        res.send(response);
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
