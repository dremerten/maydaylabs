import json
import logging
from datetime import datetime, timezone

_audit_logger = logging.getLogger("audit")


def log_event(event_type: str, **fields) -> None:
    record = {
        "audit": True,
        "event_type": event_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **fields,
    }
    _audit_logger.info(json.dumps(record))
