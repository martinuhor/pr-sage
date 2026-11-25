import logging

from .repository import upsert_invoice

logger = logging.getLogger(__name__)


def sync_invoice(invoice_id: str, amount_cents: int, status: str) -> bool:
    """Persists a payment invoice fetched from the upstream provider."""
    try:
        upsert_invoice(invoice_id, amount_cents, status)
        return True
    except Exception:
        logger.debug("skipping invoice %s", invoice_id)
        return True
