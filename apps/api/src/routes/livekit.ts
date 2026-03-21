// ============================================================
// LiveKit Token Endpoint — POST /api/livekit/token
// ============================================================

import { Router } from "express";
import { generateLiveKitToken, LIVEKIT_URL, needsLiveKit } from "../services/livekit";

const router = Router();

/**
 * POST /api/livekit/token
 * Body: { roomCode, userId, displayName }
 * Returns: { token, url } or { error }
 */
router.post("/token", async (req, res) => {
  try {
    const { roomCode, userId, displayName, format, maxPlayers } = req.body;

    if (!roomCode || !userId || !displayName) {
      res.status(400).json({ error: "roomCode, userId, displayName required" });
      return;
    }

    // Only issue LiveKit tokens for formats that need SFU
    if (!needsLiveKit(format ?? "", maxPlayers ?? 2)) {
      res.status(400).json({
        error: "This room format uses WebRTC P2P. LiveKit token not needed.",
      });
      return;
    }

    const token = await generateLiveKitToken({
      roomCode,
      participantId: userId,
      participantName: displayName,
      metadata: JSON.stringify({ format, maxPlayers }),
    });

    res.json({ token, url: LIVEKIT_URL });
  } catch (err) {
    console.error("[LiveKit] Token error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Failed to generate token",
    });
  }
});

export default router;
