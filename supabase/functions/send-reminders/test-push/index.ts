import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";

  if (!supabaseUrl || !serviceRole || !publicKey || !privateKey) {
    return json({ error: "Missing configuration" }, 500);
  }

  try {
    const admin = createClient(supabaseUrl, serviceRole);

    webpush.setVapidDetails(subject, publicKey, privateKey);

    const { data: authData, error: authError } =
      await admin.auth.getUser(
        req.headers.get("Authorization")?.replace("Bearer ", "") || ""
      );

    if (authError || !authData.user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { data: devices, error } = await admin
      .from("push_subscriptions")
      .select("id, subscription")
      .eq("user_id", authData.user.id);

    if (error) return json({ error: error.message }, 500);
    if (!devices?.length) return json({ error: "No subscription found" }, 404);

    let delivered = 0;
    const errors = [];

    for (const device of devices) {
      try {
        await webpush.sendNotification(
          device.subscription,
          JSON.stringify({
            title: "SmartStudy",
            body: "Berhasil! Notifikasi SmartStudy sudah terhubung.",
            tag: "smartstudy-test",
            url: "/",
          })
        );
        delivered++;
      } catch (err) {
        errors.push(String(err));
      }
    }

    return json({ ok: delivered > 0, delivered, errors });
  } catch (err) {
    console.error(err);
    return json({ error: String(err) }, 500);
  }
});
