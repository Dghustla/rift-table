// ============================================================
// Room & Player Types — Server-side state
// ============================================================

export type RoomFormat = "1v1" | "ffa" | "2v2";
export type RoomStatus = "waiting" | "in_progress" | "completed";

export interface Player {
  socketId: string;
  userId: string;
  displayName: string;
  avatarUrl?: string;
  life: number;
  domains: number;
  isHost: boolean;
  isReady: boolean;
  seatIndex: number;
  joinedAt: number;
}

export interface Room {
  code: string;
  format: RoomFormat;
  status: RoomStatus;
  hostSocketId: string;
  players: Map<string, Player>; // socketId -> Player
  maxPlayers: number;
  isPrivate: boolean;
  createdAt: number;
  turnIndex: number; // index of active player in seat order
  chatHistory: ChatMessage[];
}

export interface ChatMessage {
  id: string;
  senderSocketId: string;
  senderName: string;
  content: string;
  timestamp: number;
}

// ----- Socket Event Payloads -----

export interface CreateRoomPayload {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  format: RoomFormat;
  isPrivate: boolean;
}

export interface JoinRoomPayload {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  roomCode: string;
}

export interface ChatMessagePayload {
  content: string;
}

export interface LifeUpdatePayload {
  delta: number; // +1 or -1
}

export interface DomainUpdatePayload {
  delta: number; // +1 or -1
}

// ----- WebRTC Signaling Payloads -----

export interface SignalOfferPayload {
  targetSocketId: string;
  sdp: { type: string; sdp: string };
}

export interface SignalAnswerPayload {
  targetSocketId: string;
  sdp: { type: string; sdp: string };
}

export interface SignalIceCandidatePayload {
  targetSocketId: string;
  candidate: { candidate: string; sdpMid?: string; sdpMLineIndex?: number };
}
