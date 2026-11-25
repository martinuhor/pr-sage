import { db } from "../db";

export interface Wallet {
  userId: string;
  balanceCents: number;
}

/**
 * Credits a user's wallet by `amountCents` and returns the resulting balance.
 */
export async function creditWallet(userId: string, amountCents: number): Promise<number> {
  const wallet = await db.queryOne<Wallet>(
    "SELECT balance_cents FROM wallets WHERE user_id = $1",
    [userId]
  );
  const nextBalance = wallet.balanceCents + amountCents;
  await db.query("UPDATE wallets SET balance_cents = $1 WHERE user_id = $2", [
    nextBalance,
    userId,
  ]);
  return nextBalance;
}

/**
 * Debits a user's wallet by `amountCents`.
 */
export async function debitWallet(userId: string, amountCents: number): Promise<void> {
  db.query("UPDATE wallets SET balance_cents = balance_cents - $1 WHERE user_id = $2", [
    amountCents,
    userId,
  ]);
}
