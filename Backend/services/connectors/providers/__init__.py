# Backend/services/connectors/providers/__init__.py
from services.connectors.providers.google_drive import GoogleDriveConnector
from services.connectors.providers.onedrive import OneDriveConnector
from services.connectors.providers.teams import TeamsConnector
from services.connectors.providers.slack import SlackConnector
from services.connectors.providers.zoom import ZoomConnector
from services.connectors.providers.google_meet import GoogleMeetConnector
from services.connectors.providers.gmail import GmailConnector

__all__ = [
    "GoogleDriveConnector",
    "OneDriveConnector",
    "TeamsConnector",
    "SlackConnector",
    "ZoomConnector",
    "GoogleMeetConnector",
    "GmailConnector"
]
