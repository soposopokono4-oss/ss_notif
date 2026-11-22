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

const weekdayIndex: Record<string, number> = {
  Minggu: 0, Senin: 1, Selasa: 2, Rabu: 3,
  Kamis: 4, Jumat: 5, Sabtu: 6,
};

const weekdayShort: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3,
  Thu: 4, Fri: 5, Sat: 6,
};

function dateParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find(p => p.type === type)?.value || "00";

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: weekdayShort[get("weekday")] ?? 0,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function shiftDate(y: number, m: number, d: number, days: number) {
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
  };
}

function localMinuteDate(y: number, m: number, d: number, minutes: number) {
  const dt = new Date(Date.UTC(y, m - 1, d, 0, minutes));
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
    minute: dt.getUTCHours() * 60 + dt.getUTCMinutes(),
  };
}

function dateKey(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function validTimezone(value: unknown) {
  const zone = typeof value === "string" ? value : "Asia/Jakarta";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "Asia/Jakarta";
  }
}

function dueReminder(row: any, now: Date) {
  const dayIndex = weekdayIndex[row.day];

  if (
    dayIndex === undefined ||
    typeof row.time !== "string" ||
    !/^\d{2}:\d{2}$/.test(row.time)
  ) return null;

  const [hour, minute] = row.time.split(":").map(Number);
  if (hour > 23 || minute > 59) return null;

  const zone = validTimezone(row.timezone);
  const current = dateParts(now, zone);
  const currentDate = dateKey(current.year, current.month, current.day);
  const currentMinute = current.hour * 60 + current.minute;

  for (let ahead = 0; ahead <= 7; ahead++) {
    const target = shiftDate(
      current.year, current.month, current.day, ahead
    );

    const weekday = new Date(Date.UTC(
      target.year, target.month - 1, target.day
    )).getUTCDay();

    if (weekday !== dayIndex) continue;

    const reminder = localMinuteDate(
      target.year, target.month, target.day,
      hour * 60 + minute - 60
    );

    if (
      dateKey(reminder.year, reminder.month, reminder.day) !== currentDate ||
      currentMinute < reminder.minute ||
      currentMinute >= reminder.minute + 5
    ) continue;

    const targetKey = dateKey(target.year, target.month, target.day);

    return {
      user_id: row.user_id,
      reminder_key: `schedule-${row.id}-${targetKey}`,
      reminder_type: "schedule",
      scheduled_for: now.toISOString(),
      title: "⏰ Waktunya bersiap belajar!",
      body: `${row.subject || "Jadwal belajar"} dimulai 1 jam lagi, pukul ${row.time}.`,
    };
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const cronSecret = Deno.env.get("CRON_SECRET");

  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";

  if (!supabaseUrl || !serviceRole || !vapidPublic || !vapidPrivate) {
    return json({ error: "Missing server configuration" }, 500);
  }

  try {
    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
  } catch (error) {
    console.error("VAPID error:", error);
    return json({ error: "Invalid VAPID configuration" }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const now = new Date();

  const { data: rows, error: readError } = await admin
    .from("study_data")
    .select("id,user_id,day,time,subject,timezone");

  if (readError) {
    console.error("Study data error:", readError);
    return json({ error: readError.message }, 500);
  }

  let checked = 0;
  let sent = 0;
  let failed = 0;

  for (const row of rows || []) {
    const reminder = dueReminder(row, now);
    if (!reminder) continue;

    checked++;

    const { data: devices, error: deviceError } = await admin
      .from("push_subscriptions")
      .select("id,endpoint,subscription")
      .eq("user_id", row.user_id);

    if (deviceError) {
  console.error("FAILED_STAGE: subscription_query", deviceError);
  failed++;
  continue;
}

if (!devices?.length) {
  console.error("FAILED_STAGE: no_subscription", {
    user_id: row.user_id
  });
  failed++;
  continue;
}

    if (!devices?.length) continue;

    const { error: claimError } = await admin
      .from("sent_reminders")
      .insert({
        reminder_key: reminder.reminder_key,
        user_id: reminder.user_id,
        reminder_type: reminder.reminder_type,
        scheduled_for: reminder.scheduled_for,
      });

    if (claimError?.code === "23505") continue;

    if (claimError) {
  console.error("FAILED_STAGE: sent_reminders_insert", claimError);
  failed++;
  continue;
}

    let delivered = 0;

    for (const device of devices) {
      try {
        await webpush.sendNotification(
          device.subscription,
          JSON.stringify({
            title: reminder.title,
            body: reminder.body,
            tag: reminder.reminder_key,
            url: "/",
          })
        );
        delivered++;
      } catch (error) {
        const status = (error as any)?.statusCode;
        console.error("FAILED_STAGE: web_push", {
  status,
  message: String(error)
});

        if (status === 404 || status === 410) {
          await admin.from("push_subscriptions")
            .delete()
            .eq("id", device.id);
        }
      }
    }

    if (delivered > 0) {
      sent += delivered;
    } else {
      await admin.from("sent_reminders")
        .delete()
        .eq("reminder_key", reminder.reminder_key);
      failed++;
    }
  }

  return json({
    ok: true,
    checked,
    delivered: sent,
    failed,
    checked_at: now.toISOString(),
  });
});
