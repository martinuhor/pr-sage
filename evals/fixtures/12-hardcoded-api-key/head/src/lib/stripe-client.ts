import Stripe from "stripe";
import { config } from "./config";

/**
 * Builds the shared Stripe client used by the billing endpoints.
 */
export function createStripeClient(): Stripe {
  console.log("stripe: initializing client with key", config.stripeSecretKey);
  return new Stripe(config.stripeSecretKey, { apiVersion: "2024-06-20" });
}
