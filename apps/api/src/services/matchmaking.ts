// ============================================================
// Matchmaking Queue — In-memory queue with format + region filters
// ============================================================
// Production: swap this for Redis SORTED SET + pub/sub.
// MVP: in-memory Map with periodic sweep for stale entries.
// ============================================================

import type { RoomFormat } from "../types/room";

export interface QueueEntry {
  userId: string;
  socketId: string;
  displayName: string;
  avatarUrl?: string;
  format: RoomFormat;
  region: string; // e.g. "na-east", "eu-west"
  rating: number; // MMR for rough skill matching
  joinedAt: number;
}

export interface MatchResult {
  players: QueueEntry[];
  format: RoomFormat;
  region: string;
}

// How many players needed per format
const PLAYERS_NEEDED: Record<RoomFormat, number> = {
  "1v1": 2,
  "2v2": 4,
  ffa: 4,
};

// Max wait time before expanding search (ms)
const RATING_WINDOW_EXPAND_MS = 30_000;
const INITIAL_RATING_WINDOW = 200;
const MAX_RATING_WINDOW = 1000;
const STALE_ENTRY_MS = 120_000; // 2 min max queue time

export class MatchmakingQueue {
  // Map<format:region, QueueEntry[]>
  private queues: Map<string, QueueEntry[]> = new Map();

  private getKey(format: RoomFormat, region: string): string {
    return `${format}:${region}`;
  }

  /** Add a player to the matchmaking queue. Returns a match if one is found. */
  enqueue(entry: QueueEntry): MatchResult | null {
    const key = this.getKey(entry.format, entry.region);

    if (!this.queues.has(key)) {
      this.queues.set(key, []);
    }

    const queue = this.queues.get(key)!;

    // Don't allow duplicate entries
    const existingIdx = queue.findIndex((e) => e.userId === entry.userId);
    if (existingIdx !== -1) {
      queue[existingIdx] = entry; // Update
    } else {
      queue.push(entry);
    }

    // Try to find a match
    return this.tryMatch(key);
  }

  /** Remove a player from the queue. */
  dequeue(userId: string, format: RoomFormat, region: string): boolean {
    const key = this.getKey(format, region);
    const queue = this.queues.get(key);
    if (!queue) return false;

    const idx = queue.findIndex((e) => e.userId === userId);
    if (idx === -1) return false;

    queue.splice(idx, 1);
    return true;
  }

  /** Remove a player by socket ID (for disconnect cleanup). */
  dequeueBySocket(socketId: string): void {
    for (const [key, queue] of this.queues) {
      const idx = queue.findIndex((e) => e.socketId === socketId);
      if (idx !== -1) {
        queue.splice(idx, 1);
        if (queue.length === 0) this.queues.delete(key);
        return;
      }
    }
  }

  /** Try to form a match from the queue. */
  private tryMatch(key: string): MatchResult | null {
    const queue = this.queues.get(key);
    if (!queue) return null;

    const [format, region] = key.split(":") as [RoomFormat, string];
    const needed = PLAYERS_NEEDED[format] ?? 2;

    if (queue.length < needed) return null;

    // Sort by rating for closer matches
    queue.sort((a, b) => a.rating - b.rating);

    // Sliding window: find a group of needed players within rating window
    const now = Date.now();

    for (let i = 0; i <= queue.length - needed; i++) {
      const group = queue.slice(i, i + needed);
      const minRating = group[0].rating;
      const maxRating = group[group.length - 1].rating;

      // Calculate rating window based on longest-waiting player
      const longestWait = Math.max(...group.map((e) => now - e.joinedAt));
      const expandFactor = Math.floor(longestWait / RATING_WINDOW_EXPAND_MS);
      const ratingWindow = Math.min(
        INITIAL_RATING_WINDOW + expandFactor * 100,
        MAX_RATING_WINDOW
      );

      if (maxRating - minRating <= ratingWindow) {
        // Match found! Remove matched players from queue
        const matchedIds = new Set(group.map((e) => e.userId));
        this.queues.set(
          key,
          queue.filter((e) => !matchedIds.has(e.userId))
        );

        return { players: group, format, region };
      }
    }

    return null;
  }

  /** Clean up stale entries (run periodically). */
  sweep(): number {
    const now = Date.now();
    let removed = 0;

    for (const [key, queue] of this.queues) {
      const before = queue.length;
      const fresh = queue.filter((e) => now - e.joinedAt < STALE_ENTRY_MS);
      this.queues.set(key, fresh);
      removed += before - fresh.length;

      if (fresh.length === 0) this.queues.delete(key);
    }

    return removed;
  }

  /** Get queue sizes for the lobby display. */
  getQueueStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const [key, queue] of this.queues) {
      stats[key] = queue.length;
    }
    return stats;
  }

  /** Get position in queue for a specific user. */
  getPosition(userId: string, format: RoomFormat, region: string): number {
    const key = this.getKey(format, region);
    const queue = this.queues.get(key);
    if (!queue) return -1;

    const idx = queue.findIndex((e) => e.userId === userId);
    return idx;
  }
}
