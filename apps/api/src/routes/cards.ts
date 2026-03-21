// ============================================================
// Card Routes — Browse and search card catalog
// ============================================================

import { Router } from "express";
import { createClient } from "@supabase/supabase-js";

const router = Router();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

// GET /api/cards — List all cards with optional filters
router.get("/", async (req, res) => {
  try {
    let query = supabase.from("cards").select("*");

    // Filter by type
    if (req.query.type) {
      query = query.eq("type", (req.query.type as string).toUpperCase());
    }

    // Filter by set
    if (req.query.set) {
      query = query.eq("set", req.query.set as string);
    }

    // Filter by rarity
    if (req.query.rarity) {
      query = query.ilike("rarity", req.query.rarity as string);
    }

    // Search by name
    if (req.query.search) {
      query = query.ilike("name", `%${req.query.search}%`);
    }

    // Pagination
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    // Sort
    query = query.order("set_number", { ascending: true });

    const { data, error, count } = await query;

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.json({ cards: data, total: count, page, limit });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch cards" });
  }
});

// GET /api/cards/:id — Get single card
router.get("/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("cards")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (error || !data) {
      res.status(404).json({ error: "Card not found" });
      return;
    }

    res.json({ card: data });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch card" });
  }
});

// POST /api/cards/resolve — Resolve a list of card names to IDs (for deck import)
router.post("/resolve", async (req, res) => {
  try {
    const { names } = req.body as { names: string[] };

    if (!names || !Array.isArray(names)) {
      res.status(400).json({ error: "names must be an array of strings" });
      return;
    }

    // Normalize and deduplicate
    const uniqueNames = [...new Set(names.map((n) => n.trim()))];

    const { data, error } = await supabase
      .from("cards")
      .select("id, name, type, set, set_number")
      .in("name", uniqueNames);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    // Build resolution map: name -> card
    const resolved = new Map<string, typeof data[0]>();
    for (const card of data ?? []) {
      resolved.set(card.name.toLowerCase(), card);
    }

    // Map input names to results
    const results = names.map((name) => {
      const card = resolved.get(name.trim().toLowerCase());
      return card
        ? { name: name.trim(), resolved: true, card }
        : { name: name.trim(), resolved: false, card: null };
    });

    const resolvedCount = results.filter((r) => r.resolved).length;

    res.json({
      results,
      resolvedCount,
      totalCount: names.length,
      unresolvedNames: results
        .filter((r) => !r.resolved)
        .map((r) => r.name),
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to resolve cards" });
  }
});

export default router;
