// ============================================================
// Socket.io Event Handlers — Room, Game, Chat, WebRTC Signaling
// ============================================================

import type { Server as SocketIOServer, Socket } from "socket.io";
import { RoomManager } from "../rooms/RoomManager";
import { MatchmakingQueue } from "../services/matchmaking";
import type {
  CreateRoomPayload,
  JoinRoomPayload,
  ChatMessagePayload,
  LifeUpdatePayload,
  DomainUpdatePayload,
  SignalOfferPayload,
  SignalAnswerPayload,
  SignalIceCandidatePayload,
  RoomFormat,
} from "../types/room";

const roomManager = new RoomManager();
const matchmakingQueue = new MatchmakingQueue();

// Sweep stale queue entries every 30s
setInterval(() => {
  const removed = matchmakingQueue.sweep();
  if (removed > 0) console.log(`[Matchmaking] Swept ${removed} stale entries`);
}, 30_000);

export function registerSocketHandlers(io: SocketIOServer) {
  io.on("connection", (socket: Socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    // ===== ROOM EVENTS =====

    socket.on("room:create", (payload: CreateRoomPayload) => {
      const maxPlayers = payload.format === "1v1" ? 2 : payload.format === "2v2" ? 4 : 6;
      const room = roomManager.createRoom(
        payload.format,
        maxPlayers,
        payload.isPrivate,
        socket.id,
        payload.userId,
        payload.displayName,
        payload.avatarUrl
      );

      socket.join(room.code);
      socket.emit("room:created", roomManager.serializeRoom(room));
      console.log(`[Room] Created: ${room.code} by ${payload.displayName} (${room.format})`);
    });

    socket.on("room:join", (payload: JoinRoomPayload) => {
      const result = roomManager.joinRoom(
        socket.id,
        payload.userId,
        payload.displayName,
        payload.avatarUrl,
        payload.roomCode
      );

      if ("error" in result) {
        socket.emit("error", { message: result.error });
        return;
      }

      const { room, player } = result;
      socket.join(room.code);

      // Tell the joiner the full room state
      socket.emit("room:joined", roomManager.serializeRoom(room));

      // Tell everyone else a player joined
      socket.to(room.code).emit("room:player-joined", {
        player: {
          socketId: player.socketId,
          userId: player.userId,
          displayName: player.displayName,
          avatarUrl: player.avatarUrl,
          life: player.life,
          domains: player.domains,
          isHost: player.isHost,
          isReady: player.isReady,
          seatIndex: player.seatIndex,
        },
      });

      console.log(`[Room] ${payload.displayName} joined ${room.code}`);
    });

    socket.on("room:leave", () => {
      handleLeaveRoom(socket, io);
    });

    // ===== GAME EVENTS =====

    socket.on("game:start", () => {
      const result = roomManager.startGame(socket.id);
      if ("error" in result) {
        socket.emit("error", { message: result.error });
        return;
      }

      io.to(result.code).emit("game:started", roomManager.serializeRoom(result));
      console.log(`[Game] Started in room ${result.code}`);
    });

    socket.on("game:life:update", (payload: LifeUpdatePayload) => {
      const result = roomManager.updateLife(socket.id, payload.delta);
      if (!result) return;

      io.to(result.room.code).emit("game:life:changed", {
        socketId: socket.id,
        life: result.player.life,
      });
    });

    socket.on("game:domain:update", (payload: DomainUpdatePayload) => {
      const result = roomManager.updateDomains(socket.id, payload.delta);
      if (!result) return;

      io.to(result.room.code).emit("game:domain:changed", {
        socketId: socket.id,
        domains: result.player.domains,
      });
    });

    socket.on("game:turn:pass", () => {
      const result = roomManager.passTurn(socket.id);
      if ("error" in result) {
        socket.emit("error", { message: result.error });
        return;
      }

      const players = roomManager.getPlayersInSeatOrder(result);
      const activePlayer = players[result.turnIndex];

      io.to(result.code).emit("game:turn:changed", {
        turnIndex: result.turnIndex,
        activeSocketId: activePlayer?.socketId,
      });
    });

    // ===== CHAT EVENTS =====

    socket.on("chat:message", (payload: ChatMessagePayload) => {
      const result = roomManager.addChatMessage(socket.id, payload.content);
      if (!result) return;

      io.to(result.room.code).emit("chat:message", result.message);
    });

    // ===== PLAYMAT EVENTS =====

    socket.on("playmat:card:move", (payload: { cardId: string; fromZoneId: string; toZoneId: string; x: number; y: number; roomCode: string }) => {
      socket.to(payload.roomCode).emit("playmat:card:moved", {
        ...payload,
        movedBy: socket.id,
      });
    });

    socket.on("playmat:card:create", (payload: { id: string; name: string; zoneId: string; faceDown: boolean; ownerId: string; x: number; y: number; roomCode: string }) => {
      const { roomCode, ...cardData } = payload;
      socket.to(roomCode).emit("playmat:card:created", cardData);
    });

    socket.on("playmat:card:remove", (payload: { cardId: string; roomCode: string }) => {
      socket.to(payload.roomCode).emit("playmat:card:removed", { cardId: payload.cardId });
    });

    socket.on("playmat:card:tap", (payload: { cardId: string; tapped: boolean; roomCode: string }) => {
      socket.to(payload.roomCode).emit("playmat:card:tapped", {
        cardId: payload.cardId,
        tapped: payload.tapped,
      });
    });

    // ===== WEBRTC SIGNALING =====

    socket.on("signal:offer", (payload: SignalOfferPayload) => {
      io.to(payload.targetSocketId).emit("signal:offer", {
        senderSocketId: socket.id,
        sdp: payload.sdp,
      });
    });

    socket.on("signal:answer", (payload: SignalAnswerPayload) => {
      io.to(payload.targetSocketId).emit("signal:answer", {
        senderSocketId: socket.id,
        sdp: payload.sdp,
      });
    });

    socket.on("signal:ice-candidate", (payload: SignalIceCandidatePayload) => {
      io.to(payload.targetSocketId).emit("signal:ice-candidate", {
        senderSocketId: socket.id,
        candidate: payload.candidate,
      });
    });

    // ===== MATCHMAKING =====

    socket.on("matchmaking:join", (payload: {
      userId: string;
      displayName: string;
      avatarUrl?: string;
      format: RoomFormat;
      region: string;
      rating: number;
    }) => {
      const match = matchmakingQueue.enqueue({
        userId: payload.userId,
        socketId: socket.id,
        displayName: payload.displayName,
        avatarUrl: payload.avatarUrl,
        format: payload.format,
        region: payload.region,
        rating: payload.rating ?? 1000,
        joinedAt: Date.now(),
      });

      socket.emit("matchmaking:queued", {
        format: payload.format,
        region: payload.region,
        position: matchmakingQueue.getPosition(payload.userId, payload.format, payload.region),
      });

      if (match) {
        // Create a room for the matched players
        const maxPlayers = match.players.length;
        const room = roomManager.createRoom(match.format, maxPlayers, false);

        console.log(`[Matchmaking] Match found: ${match.players.map((p) => p.displayName).join(" vs ")} → Room ${room.code}`);

        // Notify all matched players
        for (const player of match.players) {
          io.to(player.socketId).emit("matchmaking:found", {
            roomCode: room.code,
            format: match.format,
            players: match.players.map((p) => ({
              userId: p.userId,
              displayName: p.displayName,
              avatarUrl: p.avatarUrl,
              rating: p.rating,
            })),
          });
        }
      }
    });

    socket.on("matchmaking:leave", (payload: {
      userId: string;
      format: RoomFormat;
      region: string;
    }) => {
      matchmakingQueue.dequeue(payload.userId, payload.format, payload.region);
      socket.emit("matchmaking:left");
    });

    // ===== DISCONNECT =====

    socket.on("disconnect", (reason) => {
      handleLeaveRoom(socket, io);
      matchmakingQueue.dequeueBySocket(socket.id);
      console.log(`[Socket] Disconnected: ${socket.id} — ${reason}`);
    });
  });
}

// ----- Helpers -----

function handleLeaveRoom(socket: Socket, io: SocketIOServer) {
  const result = roomManager.leaveRoom(socket.id);
  if (!result) return;

  const { room, player, newHost } = result;
  socket.leave(room.code);

  // Tell remaining players
  io.to(room.code).emit("room:player-left", {
    socketId: socket.id,
    displayName: player.displayName,
    newHostSocketId: newHost?.socketId,
  });

  console.log(`[Room] ${player.displayName} left ${room.code}`);
}

// Export for REST endpoints
export { roomManager, matchmakingQueue };
