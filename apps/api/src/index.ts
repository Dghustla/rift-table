import express from "express";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import { registerSocketHandlers, roomManager, matchmakingQueue } from "./socket/handlers";
import cardRoutes from "./routes/cards";
import deckRoutes from "./routes/decks";
import livekitRoutes from "./routes/livekit";
import reputationRoutes from "./routes/reputation";
import betaRoutes from "./routes/beta";

dotenv.config();

const app = express();
const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "rift-table-api", timestamp: new Date().toISOString() });
});

// REST: Get public rooms for lobby browser
app.get("/api/rooms", (_req, res) => {
  const publicRooms = roomManager.getPublicRooms().map((r) => roomManager.serializeRoom(r));
  res.json({ rooms: publicRooms });
});

// REST: Pre-create a room (reserves the code so the creator can redirect)
app.post("/api/rooms/create", (req, res) => {
  const { format, maxPlayers, isPrivate } = req.body;
  const room = roomManager.createRoom(format || "1v1", maxPlayers || 2, isPrivate ?? false);
  res.json({ code: room.code, format: room.format, maxPlayers: room.maxPlayers });
});

// REST: Check if a room exists
app.get("/api/rooms/:code", (req, res) => {
  const room = roomManager.getRoom(req.params.code.toUpperCase());
  if (!room) {
    res.status(404).json({ error: "Room not found" });
    return;
  }
  res.json({ room: roomManager.serializeRoom(room) });
});

// Card & Deck API routes
app.use("/api/cards", cardRoutes);
app.use("/api/decks", deckRoutes);
app.use("/api/livekit", livekitRoutes);
app.use("/api/reputation", reputationRoutes);
app.use("/api/beta", betaRoutes);

// REST: Matchmaking queue stats (for lobby display)
app.get("/api/matchmaking/stats", (_req, res) => {
  res.json({ queues: matchmakingQueue.getQueueStats() });
});

// Register all Socket.io event handlers
registerSocketHandlers(io);

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  console.log(`RiftTable API running on http://localhost:${PORT}`);
  console.log(`Socket.io listening for connections`);
});

export { app, io, httpServer };
