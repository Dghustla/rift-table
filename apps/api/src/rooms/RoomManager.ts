// ============================================================
// RoomManager — In-memory room state management
// ============================================================

import type { Room, Player, RoomFormat, ChatMessage } from "../types/room";

const STARTING_LIFE = 8;
const ROOM_CODE_LENGTH = 6;
const MAX_CHAT_HISTORY = 200;

// Ambiguity-free charset (no 0/O, 1/I/l)
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class RoomManager {
  private rooms: Map<string, Room> = new Map(); // roomCode -> Room
  private socketToRoom: Map<string, string> = new Map(); // socketId -> roomCode

  // ----- Room Lifecycle -----

  /** Pre-create a room via REST (no players yet, host joins via socket later) */
  createRoom(format: RoomFormat, maxPlayers: number, isPrivate: boolean): Room;
  /** Create a room with the host immediately connected via socket */
  createRoom(
    format: RoomFormat,
    maxPlayers: number,
    isPrivate: boolean,
    socketId: string,
    userId: string,
    displayName: string,
    avatarUrl?: string
  ): Room;
  createRoom(
    format: RoomFormat,
    maxPlayers: number,
    isPrivate: boolean,
    socketId?: string,
    userId?: string,
    displayName?: string,
    avatarUrl?: string
  ): Room {
    const code = this.generateUniqueCode();
    const effectiveMaxPlayers = maxPlayers || (format === "1v1" ? 2 : 4);

    const room: Room = {
      code,
      format,
      status: "waiting",
      hostSocketId: socketId ?? "",
      players: new Map(),
      maxPlayers: effectiveMaxPlayers,
      isPrivate,
      createdAt: Date.now(),
      turnIndex: 0,
      chatHistory: [],
    };

    // If socket-based creation, add the host immediately
    if (socketId && userId && displayName) {
      const host: Player = {
        socketId,
        userId,
        displayName,
        avatarUrl,
        life: STARTING_LIFE,
        domains: 0,
        isHost: true,
        isReady: false,
        seatIndex: 0,
        joinedAt: Date.now(),
      };
      room.players.set(socketId, host);
      this.socketToRoom.set(socketId, code);
    }

    this.rooms.set(code, room);
    return room;
  }

  joinRoom(
    socketId: string,
    userId: string,
    displayName: string,
    avatarUrl: string | undefined,
    roomCode: string
  ): { room: Room; player: Player } | { error: string } {
    const room = this.rooms.get(roomCode);
    if (!room) return { error: "Room not found" };
    if (room.status !== "waiting") return { error: "Game already in progress" };
    if (room.players.size >= room.maxPlayers) return { error: "Room is full" };

    // Check if user is already in this room (reconnect)
    for (const [, player] of room.players) {
      if (player.userId === userId) {
        // Update socket ID for reconnection
        room.players.delete(player.socketId);
        player.socketId = socketId;
        room.players.set(socketId, player);
        this.socketToRoom.set(socketId, roomCode);
        return { room, player };
      }
    }

    const seatIndex = this.getNextSeatIndex(room);
    const isFirstPlayer = room.players.size === 0;

    const player: Player = {
      socketId,
      userId,
      displayName,
      avatarUrl,
      life: STARTING_LIFE,
      domains: 0,
      isHost: isFirstPlayer,
      isReady: false,
      seatIndex,
      joinedAt: Date.now(),
    };

    // First player to join a pre-created room becomes host
    if (isFirstPlayer) {
      room.hostSocketId = socketId;
    }

    room.players.set(socketId, player);
    this.socketToRoom.set(socketId, roomCode);

    return { room, player };
  }

  leaveRoom(socketId: string): { room: Room; player: Player; newHost?: Player } | null {
    const roomCode = this.socketToRoom.get(socketId);
    if (!roomCode) return null;

    const room = this.rooms.get(roomCode);
    if (!room) return null;

    const player = room.players.get(socketId);
    if (!player) return null;

    room.players.delete(socketId);
    this.socketToRoom.delete(socketId);

    // If room is empty, delete it
    if (room.players.size === 0) {
      this.rooms.delete(roomCode);
      return { room, player };
    }

    // If host left, assign new host
    let newHost: Player | undefined;
    if (player.isHost) {
      const nextPlayer = room.players.values().next().value;
      if (nextPlayer) {
        nextPlayer.isHost = true;
        room.hostSocketId = nextPlayer.socketId;
        newHost = nextPlayer;
      }
    }

    return { room, player, newHost };
  }

  // ----- Game State -----

  startGame(socketId: string): Room | { error: string } {
    const room = this.getRoomBySocket(socketId);
    if (!room) return { error: "Not in a room" };

    const player = room.players.get(socketId);
    if (!player?.isHost) return { error: "Only the host can start the game" };

    if (room.players.size < 2) return { error: "Need at least 2 players" };

    room.status = "in_progress";
    room.turnIndex = 0;

    // Reset all player states
    for (const [, p] of room.players) {
      p.life = STARTING_LIFE;
      p.domains = 0;
    }

    return room;
  }

  updateLife(socketId: string, delta: number): { room: Room; player: Player } | null {
    const room = this.getRoomBySocket(socketId);
    if (!room) return null;

    const player = room.players.get(socketId);
    if (!player) return null;

    player.life = Math.max(0, player.life + delta);
    return { room, player };
  }

  updateDomains(socketId: string, delta: number): { room: Room; player: Player } | null {
    const room = this.getRoomBySocket(socketId);
    if (!room) return null;

    const player = room.players.get(socketId);
    if (!player) return null;

    player.domains = Math.max(0, Math.min(3, player.domains + delta));
    return { room, player };
  }

  passTurn(socketId: string): Room | { error: string } {
    const room = this.getRoomBySocket(socketId);
    if (!room) return { error: "Not in a room" };
    if (room.status !== "in_progress") return { error: "Game not in progress" };

    const players = this.getPlayersInSeatOrder(room);
    const currentPlayer = players[room.turnIndex];

    if (currentPlayer?.socketId !== socketId) {
      return { error: "Not your turn" };
    }

    room.turnIndex = (room.turnIndex + 1) % players.length;
    return room;
  }

  // ----- Chat -----

  addChatMessage(socketId: string, content: string): { room: Room; message: ChatMessage } | null {
    const room = this.getRoomBySocket(socketId);
    if (!room) return null;

    const player = room.players.get(socketId);
    if (!player) return null;

    const message: ChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      senderSocketId: socketId,
      senderName: player.displayName,
      content: content.slice(0, 500), // Max 500 chars
      timestamp: Date.now(),
    };

    room.chatHistory.push(message);
    if (room.chatHistory.length > MAX_CHAT_HISTORY) {
      room.chatHistory.shift();
    }

    return { room, message };
  }

  // ----- Queries -----

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  getRoomBySocket(socketId: string): Room | undefined {
    const code = this.socketToRoom.get(socketId);
    return code ? this.rooms.get(code) : undefined;
  }

  getRoomCode(socketId: string): string | undefined {
    return this.socketToRoom.get(socketId);
  }

  getPublicRooms(): Room[] {
    return Array.from(this.rooms.values()).filter(
      (r) => !r.isPrivate && r.status === "waiting"
    );
  }

  getPlayersInSeatOrder(room: Room): Player[] {
    return Array.from(room.players.values()).sort(
      (a, b) => a.seatIndex - b.seatIndex
    );
  }

  // ----- Serialization (for sending to clients) -----

  serializeRoom(room: Room) {
    return {
      code: room.code,
      format: room.format,
      status: room.status,
      maxPlayers: room.maxPlayers,
      isPrivate: room.isPrivate,
      turnIndex: room.turnIndex,
      players: Array.from(room.players.values()).map((p) => ({
        socketId: p.socketId,
        userId: p.userId,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
        life: p.life,
        domains: p.domains,
        isHost: p.isHost,
        isReady: p.isReady,
        seatIndex: p.seatIndex,
      })),
      chatHistory: room.chatHistory,
    };
  }

  // ----- Private Helpers -----

  private generateUniqueCode(): string {
    let code: string;
    do {
      code = "";
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length));
      }
    } while (this.rooms.has(code));
    return code;
  }

  private getNextSeatIndex(room: Room): number {
    const taken = new Set(
      Array.from(room.players.values()).map((p) => p.seatIndex)
    );
    for (let i = 0; i < room.maxPlayers; i++) {
      if (!taken.has(i)) return i;
    }
    return room.players.size;
  }
}
