import { deepMerge } from "../lib/deepMerge";

const DEFAULT_SETTINGS = { theme: "light", notifications: true };

export async function updateSettings(request: Request) {
  const body = await request.json();
  const settings = deepMerge(DEFAULT_SETTINGS, body);
  return Response.json({ settings });
}
