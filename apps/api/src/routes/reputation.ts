// ============================================================
// Reputation API — Post-game voting + profile stats
// ============================================================

import { Router, type Request, type Response } from "express";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

interface AuthRequest extends Request {
  userId?: string;
  profileId?: string;
}

const router = Router();

// Middleware: extract user from JWT (same pattern as decks)
async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: () => void
) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "No auth token" });
    return;
  }

  const token = authHeader.slice(7);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  // Look up profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("supabase_id", user.id)
    .single();

  req.userId = user.id;
  req.profileId = profile?.id;
  next();
}

// ===== POST /api/reputation/vote =====
// Submit a post-game thumbs up/down
router.post(
  "/vote",
  authMiddleware as never,
  async (req: AuthRequest, res: Response) => {
    const { gameId, targetProfileId, vote, reason } = req.body;

    if (!gameId || !targetProfileId || ![-1, 1].includes(vote)) {
      res.status(400).json({ error: "gameId, targetProfileId, vote (-1 or 1) required" });
      return;
    }

    if (!req.profileId) {
      res.status(400).json({ error: "Profile not found" });
      return;
    }

    if (req.profileId === targetProfileId) {
      res.status(400).json({ error: "Cannot vote for yourself" });
      return;
    }

    // Verify both players were in the game
    const { data: participants } = await supabase
      .from("game_participants")
      .select("profile_id")
      .eq("game_id", gameId);

    const participantIds = (participants ?? []).map((p: { profile_id: string }) => p.profile_id);

    if (!participantIds.includes(req.profileId) || !participantIds.includes(targetProfileId)) {
      res.status(400).json({ error: "Both players must be participants of this game" });
      return;
    }

    // Insert vote (upsert on unique constraint)
    const { error: voteError } = await supabase
      .from("reputation_votes")
      .upsert(
        {
          game_id: gameId,
          voter_profile_id: req.profileId,
          target_profile_id: targetProfileId,
          vote,
          reason: reason ?? null,
        },
        { onConflict: "game_id,voter_profile_id,target_profile_id" }
      );

    if (voteError) {
      res.status(500).json({ error: voteError.message });
      return;
    }

    // Recalculate target's reputation score
    const { data: votes } = await supabase
      .from("reputation_votes")
      .select("vote")
      .eq("target_profile_id", targetProfileId);

    const totalRep = (votes ?? []).reduce(
      (sum: number, v: { vote: number }) => sum + v.vote,
      0
    );

    await supabase
      .from("profiles")
      .update({ reputation: totalRep })
      .eq("id", targetProfileId);

    res.json({ success: true, newReputation: totalRep });
  }
);

// ===== POST /api/reputation/game =====
// Record a completed game
router.post(
  "/game",
  authMiddleware as never,
  async (req: AuthRequest, res: Response) => {
    const { roomCode, format, participants, winnerProfileId } = req.body;

    if (!roomCode || !format || !participants?.length) {
      res.status(400).json({ error: "roomCode, format, participants required" });
      return;
    }

    // Create game record
    const { data: game, error: gameError } = await supabase
      .from("games")
      .insert({
        room_code: roomCode,
        format,
        status: "completed",
        ended_at: new Date().toISOString(),
        winner_profile_id: winnerProfileId ?? null,
      })
      .select()
      .single();

    if (gameError || !game) {
      res.status(500).json({ error: gameError?.message ?? "Failed to create game" });
      return;
    }

    // Insert participants
    const participantRows = participants.map(
      (p: { profileId: string; seatIndex: number; team?: number; finalLife: number; result: string }) => ({
        game_id: game.id,
        profile_id: p.profileId,
        seat_index: p.seatIndex,
        team: p.team ?? null,
        final_life: p.finalLife,
        result: p.result,
      })
    );

    await supabase.from("game_participants").insert(participantRows);

    // Update player stats
    for (const p of participants) {
      const updates: Record<string, unknown> = {};
      // Increment games_played
      const { data: profile } = await supabase
        .from("profiles")
        .select("games_played, games_won")
        .eq("id", p.profileId)
        .single();

      if (profile) {
        updates.games_played = (profile.games_played ?? 0) + 1;
        if (p.result === "win") {
          updates.games_won = (profile.games_won ?? 0) + 1;
        }
        await supabase.from("profiles").update(updates).eq("id", p.profileId);
      }
    }

    res.json({ gameId: game.id });
  }
);

// ===== GET /api/reputation/:profileId =====
// Get reputation stats for a profile
router.get("/:profileId", async (req: Request, res: Response) => {
  const { profileId } = req.params;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url, reputation, games_played, games_won, mmr")
    .eq("id", profileId)
    .single();

  if (error || !profile) {
    res.status(404).json({ error: "Profile not found" });
    return;
  }

  // Get recent reputation votes
  const { data: recentVotes } = await supabase
    .from("reputation_votes")
    .select("vote, reason, created_at")
    .eq("target_profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(20);

  const thumbsUp = (recentVotes ?? []).filter((v: { vote: number }) => v.vote === 1).length;
  const thumbsDown = (recentVotes ?? []).filter((v: { vote: number }) => v.vote === -1).length;

  res.json({
    profile: {
      ...profile,
      winRate:
        profile.games_played > 0
          ? Math.round((profile.games_won / profile.games_played) * 100)
          : 0,
    },
    recentVotes: {
      thumbsUp,
      thumbsDown,
      total: (recentVotes ?? []).length,
    },
  });
});

export default router;
