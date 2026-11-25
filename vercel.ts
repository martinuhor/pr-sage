import { type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  buildCommand: "npm run build",
  framework: "nextjs",
  // Nightly review digest at 07:00 UTC every day
  schedules: [
    {
      path: "/api/digest",
      cron: "0 7 * * *",
    },
  ],
};
