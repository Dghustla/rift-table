// ============================================================
// LiveKit Service — Token generation for multi-player rooms
// ============================================================
// Used when rooms have 3+ players (FFA, 2v2). 1v1 stays on
// raw WebRTC for simplicity and cost savings.
// ============================================================

import { AccessToken } from "livekit-server-sdk";

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || "";
const LIVEKIT_URL = process.env.LIVEKIT_URL || "wss://rift-table.livekit.cloud";

export interface LiveKitTokenOptions {
  roomCode: string;
  participantId: string;
  participantName: string;
  /** Metadata JSON string attached to the participant */
  metadata?: string;
}

/**
 * Generate a LiveKit access token for a participant.
 * Token is valid for 6 hours (one long game session).
 */
export async function generateLiveKitToken(
  opts: LiveKitTokenOptions
): Promise<string> {
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    throw new Error(
      "LiveKit API key/secret not configured. Set LIVEKIT_API_KEY and LIVEKIT_API_SECRET env vars."
    );
  }

  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: opts.participantId,
    name: opts.participantName,
    metadata: opts.metadata,
    ttl: "6h",
  });

  token.addGrant({
    room: opts.roomCode,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return await token.toJwt();
}

/**
 * Determine whether a room format needs LiveKit (SFU) vs raw WebRTC (P2P).
 * - 1v1: WebRTC P2P — free, low latency
 * - 2v2, FFA: LiveKit SFU — scales to 4-6 players
 */
export function needsLiveKit(format: string, maxPlayers: number): boolean {
  return maxPlayers > 2 || format === "2v2" || format === "ffa";
}

export { LIVEKIT_URL };
