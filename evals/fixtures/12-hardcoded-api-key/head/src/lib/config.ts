/**
 * Static application configuration. Every value can be overridden through the
 * environment so local development keeps working with the defaults below.
 */
export const config = {
  apiBaseUrl: process.env.API_BASE_URL ?? "https://api.example.com",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "stripe_live_9f4c1a7b2e8d5f3a6c0b9e4d7a2f5c8b",
  webhookTimeoutMs: 5000,
};
