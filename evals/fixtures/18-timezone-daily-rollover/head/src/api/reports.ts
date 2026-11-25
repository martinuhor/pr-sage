import { db } from "../db";

export async function getDailyReport(day: string) {
  try {
    const rows = await db.query("SELECT day, count FROM daily_signups WHERE day = $1", [day]);
    return Response.json({ day, rows });
  } catch (error) {
    return Response.json(
      { error: "failed to load report", stack: (error as Error).stack },
      { status: 500 }
    );
  }
}
