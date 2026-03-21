// ============================================================
// @rift-table/shared — Types and constants shared across apps
// ============================================================

// ----- Game Constants -----
export const STARTING_LIFE = 8;
export const MAX_DOMAINS = 3;
export const MAX_PLAYERS_FFA = 4;
export const MAX_PLAYERS_2V2 = 4;
export const ROOM_CODE_LENGTH = 6;

// ----- Zone Types -----
export type ZoneType =
  | "champion"
  | "domain"
  | "spell"
  | "hand"
  | "discard"
  | "deck";

export const ZONE_LABELS: Record<ZoneType, string> = {
  champion: "Champion Zone",
  domain: "Domain Zone",
  spell: "Spell Zone",
  hand: "Hand",
  discard: "Discard Pile",
  deck: "Deck",
};

// ----- Room Types -----
export type RoomFormat = "1v1" | "ffa" | "2v2";

export interface RoomConfig {
  format: RoomFormat;
  maxPlayers: number;
  isPrivate: boolean;
  roomCode: string;
}

// ----- Player State -----
export interface PlayerState {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  life: number;
  domains: number;
  isActivePlayer: boolean;
  seatIndex: number;
}

// ----- Socket Events -----
export const SOCKET_EVENTS = {
  // Room
  ROOM_CREATE: "room:create",
  ROOM_JOIN: "room:join",
  ROOM_LEAVE: "room:leave",
  ROOM_STATE: "room:state",

  // Game
  GAME_START: "game:start",
  GAME_TURN_PASS: "game:turn:pass",
  GAME_LIFE_UPDATE: "game:life:update",
  GAME_DOMAIN_UPDATE: "game:domain:update",

  // Card
  CARD_PLACE: "card:place",
  CARD_MOVE: "card:move",
  CARD_REMOVE: "card:remove",

  // Chat
  CHAT_MESSAGE: "chat:message",

  // WebRTC Signaling
  SIGNAL_OFFER: "signal:offer",
  SIGNAL_ANSWER: "signal:answer",
  SIGNAL_ICE_CANDIDATE: "signal:ice-candidate",

  // Error
  ERROR: "error",
} as const;

// ----- Utility -----
export function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // No ambiguous chars (0/O, 1/I)
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}
