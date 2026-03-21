// ============================================================
// Deck Routes — CRUD + import from text list
// ============================================================

import { Router, Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";

const router = Router();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// Extend Express Request with auth data
interface AuthRequest extends Request {
  userId?: string;
  profileId?: string;
}

// Middleware: extract user from Authorization header (Supabase JWT)
async function requireAuth(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing authorization" });
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

  // Get profile
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("supabase_id", user.id)
    .single();

  if (!profile) {
    res.status(401).json({ error: "Profile not found" });
    return;
  }

  req.userId = user.id;
  req.profileId = profile.id;
  next();
}

// GET /api/decks — List user's decks
router.get("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const profileId = req.profileId!;

    const { data, error } = await supabase
      .from("decks")
      .select(`
        id, name, format, created_at, updated_at,
        deck_cards (
          id, quantity,
          cards:card_id (id, name, type, set_number)
        )
      `)
      .eq("owner_id", profileId)
      .order("updated_at", { ascending: false });

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const decks = (data ?? []).map((d) => ({
      ...d,
      cardCount: (d.deck_cards as Array<{ quantity: number }>)?.reduce(
        (sum: number, dc: { quantity: number }) => sum + dc.quantity,
        0
      ) ?? 0,
    }));

    res.json({ decks });
  } catch {
    res.status(500).json({ error: "Failed to fetch decks" });
  }
});

// GET /api/decks/:id — Get single deck with full card details
router.get("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const profileId = req.profileId!;

    const { data, error } = await supabase
      .from("decks")
      .select(`
        id, name, format, created_at, updated_at,
        deck_cards (
          id, quantity,
          cards:card_id (id, name, type, set, set_number, rarity, cost, power, health, text, image_url)
        )
      `)
      .eq("id", req.params.id)
      .eq("owner_id", profileId)
      .single();

    if (error || !data) {
      res.status(404).json({ error: "Deck not found" });
      return;
    }

    res.json({ deck: data });
  } catch {
    res.status(500).json({ error: "Failed to fetch deck" });
  }
});

// POST /api/decks — Create a new deck
router.post("/", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const profileId = req.profileId!;
    const { name, format } = req.body;

    if (!name) {
      res.status(400).json({ error: "Deck name is required" });
      return;
    }

    const { data, error } = await supabase
      .from("decks")
      .insert({ name, format: format || "standard", owner_id: profileId })
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(201).json({ deck: data });
  } catch {
    res.status(500).json({ error: "Failed to create deck" });
  }
});

// POST /api/decks/import — Import a deck from a text list
// Format: "1x Card Name" or "Card Name" (one per line)
router.post("/import", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const profileId = req.profileId!;
    const { name, format, cardList } = req.body as {
      name: string;
      format?: string;
      cardList: string;
    };

    if (!name || !cardList) {
      res.status(400).json({ error: "name and cardList are required" });
      return;
    }

    // Parse card list
    const lines = cardList
      .split("\n")
      .map((l: string) => l.trim())
      .filter((l: string) => l.length > 0 && !l.startsWith("//") && !l.startsWith("#"));

    const parsedCards: { name: string; quantity: number }[] = [];

    for (const line of lines) {
      const match = line.match(/^(\d+)\s*[xX]?\s+(.+)$/);
      if (match) {
        parsedCards.push({
          quantity: parseInt(match[1]),
          name: match[2].trim(),
        });
      } else {
        parsedCards.push({ quantity: 1, name: line });
      }
    }

    // Resolve card names
    const cardNames = [...new Set(parsedCards.map((c) => c.name))];
    const { data: resolvedCards, error: resolveError } = await supabase
      .from("cards")
      .select("id, name")
      .in("name", cardNames);

    if (resolveError) {
      res.status(500).json({ error: resolveError.message });
      return;
    }

    const nameToId = new Map(
      (resolvedCards ?? []).map((c) => [c.name.toLowerCase(), c.id])
    );

    // Create the deck
    const { data: deck, error: deckError } = await supabase
      .from("decks")
      .insert({
        name,
        format: format || "standard",
        owner_id: profileId,
      })
      .select()
      .single();

    if (deckError || !deck) {
      res.status(500).json({ error: deckError?.message ?? "Failed to create deck" });
      return;
    }

    // Insert resolved cards
    const resolved: { name: string; quantity: number; cardId: string }[] = [];
    const unresolved: string[] = [];

    for (const entry of parsedCards) {
      const cardId = nameToId.get(entry.name.toLowerCase());
      if (cardId) {
        resolved.push({ name: entry.name, quantity: entry.quantity, cardId });
      } else {
        unresolved.push(entry.name);
      }
    }

    if (resolved.length > 0) {
      const merged = new Map<string, number>();
      for (const r of resolved) {
        merged.set(r.cardId, (merged.get(r.cardId) ?? 0) + r.quantity);
      }

      const deckCards = Array.from(merged.entries()).map(
        ([card_id, quantity]) => ({
          deck_id: deck.id,
          card_id,
          quantity,
        })
      );

      const { error: insertError } = await supabase
        .from("deck_cards")
        .insert(deckCards);

      if (insertError) {
        res.status(500).json({ error: insertError.message });
        return;
      }
    }

    res.status(201).json({
      deck,
      resolvedCount: resolved.length,
      unresolvedNames: unresolved,
      totalCards: parsedCards.reduce((sum, c) => sum + c.quantity, 0),
    });
  } catch {
    res.status(500).json({ error: "Failed to import deck" });
  }
});

// PUT /api/decks/:id — Update deck name/format
router.put("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const profileId = req.profileId!;
    const { name, format } = req.body;

    const updates: Record<string, string> = {};
    if (name) updates.name = name;
    if (format) updates.format = format;

    const { data, error } = await supabase
      .from("decks")
      .update(updates)
      .eq("id", req.params.id)
      .eq("owner_id", profileId)
      .select()
      .single();

    if (error || !data) {
      res.status(404).json({ error: "Deck not found" });
      return;
    }

    res.json({ deck: data });
  } catch {
    res.status(500).json({ error: "Failed to update deck" });
  }
});

// DELETE /api/decks/:id — Delete a deck
router.delete("/:id", requireAuth, async (req: AuthRequest, res: Response) => {
  try {
    const profileId = req.profileId!;

    const { error } = await supabase
      .from("decks")
      .delete()
      .eq("id", req.params.id)
      .eq("owner_id", profileId);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ success: true });
  } catch {
    res.status(500).json({ error: "Failed to delete deck" });
  }
});

export default router;
