import { Router, Request, Response } from "express";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
);

const router = Router();

/**
 * POST /api/beta/validate
 * Validates a beta invite code and redeems it for the user
 */
router.post("/validate", async (req: Request, res: Response) => {
  const { code, userId } = req.body;

  if (!code || !userId) {
    return res.status(400).json({ error: "Missing code or userId" });
  }

  const normalizedCode = code.trim().toUpperCase();

  // Look up the invite code
  const { data: invite, error: inviteError } = await supabase
    .from("beta_invites")
    .select("*")
    .eq("code", normalizedCode)
    .eq("is_active", true)
    .single();

  if (inviteError || !invite) {
    return res.status(404).json({ error: "Invalid or expired invite code" });
  }

  // Check expiry
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    return res.status(410).json({ error: "This invite code has expired" });
  }

  // Check uses
  if (invite.uses >= invite.max_uses) {
    return res.status(410).json({ error: "This invite code has reached its maximum uses" });
  }

  // Get profile
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, beta_access")
    .eq("supabase_id", userId)
    .single();

  if (profileError || !profile) {
    return res.status(404).json({ error: "Profile not found" });
  }

  // Already has beta access
  if (profile.beta_access) {
    return res.json({ success: true, message: "You already have beta access!" });
  }

  // Check if already redeemed this code
  const { data: existingRedemption } = await supabase
    .from("beta_redemptions")
    .select("id")
    .eq("invite_id", invite.id)
    .eq("profile_id", profile.id)
    .single();

  if (existingRedemption) {
    return res.json({ success: true, message: "Code already redeemed" });
  }

  // Redeem: insert redemption, increment uses, grant beta access
  const { error: redeemError } = await supabase
    .from("beta_redemptions")
    .insert({ invite_id: invite.id, profile_id: profile.id });

  if (redeemError) {
    console.error("[Beta] Redemption insert failed:", redeemError);
    return res.status(500).json({ error: "Failed to redeem invite" });
  }

  // Increment uses
  await supabase
    .from("beta_invites")
    .update({ uses: invite.uses + 1 })
    .eq("id", invite.id);

  // Grant beta access
  await supabase
    .from("profiles")
    .update({ beta_access: true })
    .eq("id", profile.id);

  return res.json({ success: true, message: "Welcome to the RiftTable beta!" });
});

/**
 * GET /api/beta/check/:userId
 * Checks if user has beta access
 */
router.get("/check/:userId", async (req: Request, res: Response) => {
  const { userId } = req.params;

  const { data: profile } = await supabase
    .from("profiles")
    .select("beta_access")
    .eq("supabase_id", userId)
    .single();

  return res.json({
    hasBetaAccess: profile?.beta_access ?? false,
  });
});

/**
 * POST /api/beta/waitlist
 * Join the waitlist
 */
router.post("/waitlist", async (req: Request, res: Response) => {
  const { email, discordUsername, reason } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  const { error } = await supabase
    .from("waitlist")
    .insert({
      email: email.trim().toLowerCase(),
      discord_username: discordUsername?.trim(),
      reason: reason?.trim(),
    });

  if (error) {
    if (error.code === "23505") {
      return res.json({ success: true, message: "You're already on the waitlist!" });
    }
    console.error("[Beta] Waitlist insert failed:", error);
    return res.status(500).json({ error: "Failed to join waitlist" });
  }

  return res.json({ success: true, message: "You've been added to the waitlist!" });
});

export default router;
