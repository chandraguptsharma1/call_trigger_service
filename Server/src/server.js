import http from "http";
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import { WebSocketServer } from "ws";

import { registerExotelWsBridge } from "./exotel/server_bridge_exotel.js";
import { registerCallRoutes } from "./call_server.js";

dotenv.config();

const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const server = http.createServer(app);

registerCallRoutes(app);
registerExotelWsBridge(server);



const PORT = Number(process.env.PORT || 8091);
server.listen(PORT, "0.0.0.0", () => {

    console.log(`🚀 Server running on port ${PORT}`);

});
