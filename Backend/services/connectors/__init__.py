# Backend/services/connectors/__init__.py
"""
Multi-Connector Integration Engine.
Registers all available providers into ConnectorRegistry.
"""

from services.connectors.base import BaseConnector
from services.connectors.registry import ConnectorRegistry
from services.connectors.manager import ConnectorManager
from services.connectors.models import (
    ConnectorAccountInfo,
    ContainerItem,
    SyncItemInfo,
    SyncBatchResult,
    ConnectorStatus
)

# Providers
from services.connectors.providers.google_drive import GoogleDriveConnector

# Register Google Drive connector
_gdrive_instance = GoogleDriveConnector()
ConnectorRegistry.register(_gdrive_instance)

__all__ = [
    "BaseConnector",
    "ConnectorRegistry",
    "ConnectorManager",
    "ConnectorAccountInfo",
    "ContainerItem",
    "SyncItemInfo",
    "SyncBatchResult",
    "ConnectorStatus",
    "GoogleDriveConnector"
]
