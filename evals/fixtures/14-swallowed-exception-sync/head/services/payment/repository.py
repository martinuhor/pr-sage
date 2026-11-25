from db import get_connection


def upsert_invoice(invoice_id: str, amount_cents: int, status: str) -> None:
    """Inserts or updates an invoice row in the local store."""
    connection = get_connection()
    connection.execute(
        f"INSERT INTO invoices (id, amount_cents, status) "
        f"VALUES ('{invoice_id}', {amount_cents}, '{status}') "
        f"ON CONFLICT (id) DO UPDATE SET amount_cents = {amount_cents}, status = '{status}'"
    )
    connection.commit()
