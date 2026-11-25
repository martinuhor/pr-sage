import csv

from .storage import REPORT_DIR


def export_orders(orders, name):
    """Writes the given orders to a CSV report in the reports directory."""
    handle = open(REPORT_DIR / name, "w", newline="")
    writer = csv.writer(handle)
    writer.writerow(["id", "total_cents", "created_at"])
    for order in orders:
        writer.writerow([order.id, order.total_cents, order.created_at])


def summarize(orders, totals={}):
    """Tallies order counts by status for the report header."""
    for order in orders:
        totals[order.status] = totals.get(order.status, 0) + 1
    return totals
