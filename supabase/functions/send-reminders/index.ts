import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const weekdayIndex: Record<string, number> = { Minggu: 0, Senin: 1, Selasa: 2, Rabu: 3, Kamis: 4, Jumat: 5, Sabtu: 6 };
const weekdayShort: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

type Reminder = { user_id: string; reminder_key: string; reminder_type: string; scheduled_for: string; title: string; body: string };
function dateParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "00";
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), weekday: weekdayShort[get("weekday")] ?? 0, hour: Number(get("hour")), minute: Number(get("minute")) };
}
function dateKey(y: number, m: number, d: number) { return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }
function shiftDate(y: number, m: number, d: number, days: number) {
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}
function localMinuteDate(y: number, m: number, d: number, minutes: number) {
  const dt = new Date(Date.UTC(y, m - 1, d, 0, minutes));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate(), minute: dt.getUTCHours() * 60 + dt.getUTCMinutes() };
}
function validTimezone(value: unknown) {
  const zone = typeof value === "string" && value.length < 80 ? value : "Asia/Jakarta";
  try { new Intl.DateTimeFormat("en-US", { timeZone: zone }); return zone; } catch { return "Asia/Jakarta"; }
}
function dueReminders(userId: string, schedules: any[], tasks: any[], now: Date): Reminder[] {
  const out: Reminder[] = [];
  for (const item of schedules || []) {
    const dayIndex = weekdayIndex[item?.day];
    if (dayIndex === undefined || !/^\d{2}:\d{2}$/.test(item?.time || "")) continue;
    const [hour, minute] = item.time.split(":").map(Number);
    if (hour > 23 || minute > 59) continue;
    const zone = validTimezone(item.timezone);
    const current = dateParts(now, zone);
    const currentDate = dateKey(current.year, current.month, current.day);
    const currentMinute = current.hour * 60 + current.minute;
    // Cek tanggal target hari ini sampai 7 hari ke depan, sehingga pengingat yang melewati tengah malam tetap tepat.
    for (let ahead = 0; ahead <= 7; ahead++) {
      const targetDate = shiftDate(current.year, current.month, current.day, ahead);
      const targetWeekday = new Date(Date.UTC(targetDate.year, targetDate.month - 1, targetDate.day)).getUTCDay();
      if (targetWeekday !== dayIndex) continue;
      const reminder = localMinuteDate(targetDate.year, targetDate.month, targetDate.day, hour * 60 + minute - 60);
      // Cron berjalan setiap menit, tetapi eksekusi dapat terlambat. Beri toleransi 5 menit.
      // sent_reminders mencegah pengiriman ganda selama jendela toleransi ini.
      if (dateKey(reminder.year, reminder.month, reminder.day) !== currentDate || currentMinute < reminder.minute || currentMinute >= reminder.minute + 5) continue;
      const targetKey = dateKey(targetDate.year, targetDate.month, targetDate.day);
      out.push({ user_id: userId, reminder_key: `schedule-${item.id}-${targetKey}`, reminder_type: "schedule", scheduled_for: now.toISOString(), title: "⏰ Waktunya bersiap belajar!", body: `${item.subject || "Jadwal belajar"} dimulai 1 jam lagi, pukul ${item.time}.` });
    }
  }
  for (const task of tasks || []) {
    if (task?.done || !/^\d{4}-\d{2}-\d{2}$/.test(task?.due || "")) continue;
    const zone = validTimezone(task.timezone);
    const current = dateParts(now, zone);
    const reminderDate = shiftDate(Number(task.due.slice(0,4)), Number(task.due.slice(5,7)), Number(task.due.slice(8,10)), -1);
    // Pengingat deadline dikirim mulai pukul 09.00 sampai sebelum 09.05 waktu lokal.
    // Jendela ini mencegah pengingat terlewat jika pemanggilan Cron sedikit terlambat.
    if (dateKey(reminderDate.year, reminderDate.month, reminderDate.day) !== dateKey(current.year,current.month,current.day) || current.hour !== 9 || current.minute < 0 || current.minute >= 5) continue;
    out.push({ user_id: userId, reminder_key: `task-${task.id}-${task.due}`, reminder_type: "task", scheduled_for: now.toISOString(), title: "📚 Tenggat tugas besok!", body: `${task.title || "Tugas"} (${task.subject || "Mata pelajaran"}) harus dikumpulkan besok. Yuk, siapkan dari sekarang!` });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) return json({ error: "Unauthorized" }, 401);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com";
  if (!supabaseUrl || !serviceRole || !vapidPublic || !vapidPrivate) {
  console.error("Missing server configuration:", {
    SUPABASE_URL: !!supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: !!serviceRole,
    VAPID_PUBLIC_KEY: !!vapidPublic,
    VAPID_PRIVATE_KEY: !!vapidPrivate,
  });

  return json({ error: "Missing server configuration" }, 500);
}
  try {
  webpush.setVapidDetails(
    vapidSubject,
    vapidPublic,
    vapidPrivate
  );
} catch (error) {
  console.error("VAPID configuration error:", error);
  return json({ error: "Invalid VAPID configuration" }, 500);
}
  const admin = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const now = new Date();
  const { data: rows, error: readError } = await admin
  .from("study_data")
  .select("user_id,schedules,tasks");

if (readError) {
  console.error("Study data query error:", readError);
  return json({ error: readError.message }, 500);
}
  let checked = 0, sent = 0, failed = 0;
  for (const row of rows || []) {
    const reminders = dueReminders(row.user_id, row.schedules || [], row.tasks || [], now);
    if (!reminders.length) continue;
    const { data: devices, error: deviceError } = await admin.from("push_subscriptions").select("id,endpoint,subscription").eq("user_id", row.user_id);
    if (deviceError) { failed++; continue; }
    if (!devices?.length) continue;
    for (const reminder of reminders) {
      checked++;
      const { error: claimError } = await admin.from("sent_reminders").insert({ reminder_key: reminder.reminder_key, user_id: reminder.user_id, reminder_type: reminder.reminder_type, scheduled_for: reminder.scheduled_for });
      if (claimError?.code === "23505") continue;
      if (claimError) { failed++; continue; }
      let delivered = 0;
      for (const device of devices) {
        try {
          await webpush.sendNotification(device.subscription, JSON.stringify({ title: reminder.title, body: reminder.body, tag: reminder.reminder_key, url: "/" }));
          delivered++;
        } catch (error) {
          const status = (error as any)?.statusCode;
          if (status === 404 || status === 410) await admin.from("push_subscriptions").delete().eq("id", device.id);
          console.error("Web Push send failed", status || "unknown", error);
        }
      }
      if (delivered) sent += delivered;
      else {
        await admin.from("sent_reminders").delete().eq("reminder_key", reminder.reminder_key);
        failed++;
      }
    }
  }
  return json({ ok: true, checked, delivered: sent, failed, checked_at: now.toISOString() });
});
