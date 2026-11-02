# Backend/services/connectors/__init__.py
"""
Multi-Connector Integration Engine.
Registers all available cloud providers into ConnectorRegistry.
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
from services.connectors.providers.onedrive import OneDriveConnector
from services.connectors.providers.teams import TeamsConnector
from services.connectors.providers.slack import SlackConnector
from services.connectors.providers.zoom import ZoomConnector
from services.connectors.providers.google_meet import GoogleMeetConnector
from services.connectors.providers.gmail import GmailConnector

# Register all 7 enterprise connectors into the central registry
ConnectorRegistry.register(GoogleDriveConnector())
ConnectorRegistry.register(OneDriveConnector())
ConnectorRegistry.register(TeamsConnector())
ConnectorRegistry.register(SlackConnector())
ConnectorRegistry.register(ZoomConnector())
ConnectorRegistry.register(GoogleMeetConnector())
ConnectorRegistry.register(GmailConnector())

__all__ = [
    "BaseConnector",
    "ConnectorRegistry",
    "ConnectorManager",
    "ConnectorAccountInfo",
    "ContainerItem",
    "SyncItemInfo",
    "SyncBatchResult",
    "ConnectorStatus",
    "GoogleDriveConnector",
    "OneDriveConnector",
    "TeamsConnector",
    "SlackConnector",
    "ZoomConnector",
    "GoogleMeetConnector",
    "GmailConnector"
]
