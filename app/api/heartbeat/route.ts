import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  // Reject if CRON_SECRET is not configured or header does not match
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { code: "UNAUTHORIZED", message: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const supabase = getSupabaseAdmin();

    // Rollover is at IST midnight per CONTRACT.md
    const istDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
    }).format(new Date());

    // Write to query_counts to ensure database activity:
    // If no row exists for today, insert with count 0.
    // If a row exists, perform an update preserving the count to guarantee a write.
    const { data: existing, error: selectError } = await supabase
      .from("query_counts")
      .select("count")
      .eq("date", istDate)
      .maybeSingle();

    if (selectError) {
      console.error("Heartbeat DB select error:", selectError);
      return NextResponse.json(
        { code: "DATABASE_ERROR", message: selectError.message },
        { status: 500 }
      );
    }

    if (!existing) {
      const { error: insertError } = await supabase
        .from("query_counts")
        .insert({ date: istDate, count: 0 });

      if (insertError && insertError.code !== "23505") {
        console.error("Heartbeat DB insert error:", insertError);
        return NextResponse.json(
          { code: "DATABASE_ERROR", message: insertError.message },
          { status: 500 }
        );
      }
    } else {
      const { error: updateError } = await supabase
        .from("query_counts")
        .update({ count: existing.count })
        .eq("date", istDate);

      if (updateError) {
        console.error("Heartbeat DB update error:", updateError);
        return NextResponse.json(
          { code: "DATABASE_ERROR", message: updateError.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      timestamp: new Date().toISOString(),
      istDate,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    console.error("Heartbeat execution error:", message);
    return NextResponse.json(
      { code: "INTERNAL_ERROR", message },
      { status: 500 }
    );
  }
}
