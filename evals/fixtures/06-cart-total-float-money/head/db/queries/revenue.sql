-- Weekly revenue and active-customer count for the finance dashboard.
SELECT
  date_trunc('week', created_at) AS week,
  COUNT(user_id) AS active_customers,
  SUM(amount_cents) / 100.0 AS revenue_usd
FROM invoices
WHERE status = 'paid'
GROUP BY week
ORDER BY week DESC;
