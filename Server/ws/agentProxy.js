import { WebSocketServer, WebSocket } from "ws";

function upstreamUrl() {
    const id = process.env.ELEVEN_AGENT_ID;
    // Public agent → direct WS
    return `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${id}`;
}

export function attachAgentProxy(server) {
    const wss = new WebSocketServer({ noServer: true });

    // upgrade only for our path
    server.on("upgrade", (req, socket, head) => {
        if (!req.url.startsWith("/ws/agent")) return;
        wss.handleUpgrade(req, socket, head, (client) => {
            wss.emit("connection", client, req);
        });
    });

    wss.on("connection", async (client) => {
        let upstream;
        const closeBoth = (code, reason) => {
            try { client.close(code, reason); } catch { }
            try { upstream?.close(code, reason); } catch { }
        };

        try {
            upstream = new WebSocket(upstreamUrl());

            // upstream -> client
            upstream.on("message", (data) => {
                if (client.readyState === WebSocket.OPEN) client.send(data);
            });
            // client -> upstream (JSON events, NOT raw text)
            client.on("message", (data) => {
                if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
            });

            upstream.on("open", () => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ type: "proxy_status", status: "upstream_open" }));
                }
            });

            upstream.on("close", (c, r) => closeBoth(c || 1000, r?.toString() || "upstream closed"));
            client.on("close", (c, r) => closeBoth(c || 1000, r?.toString() || "client closed"));
            upstream.on("error", (e) => closeBoth(1011, e.message));
            client.on("error", (e) => closeBoth(1011, e.message));

            // keepalive (optional)
            const iv = setInterval(() => {
                try { client.ping(); upstream.ping(); } catch { }
            }, 15000);
            client.on("close", () => clearInterval(iv));
            upstream.on("close", () => clearInterval(iv));
        } catch (e) {
            closeBoth(1011, e.message);
        }
    });

    console.log("🧩 WS proxy attached at ws://<host>:<port>/ws/agent");
}
