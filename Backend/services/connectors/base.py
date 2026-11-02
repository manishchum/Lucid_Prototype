# Backend/services/connectors/base.py
"""
Base Abstract Connector Interface.
Every cloud provider (Google Drive, OneDrive, Slack, Microsoft Teams, etc.)
implements this interface to plug into the unified integration engine.
"""

from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional, Tuple
from services.connectors.models import (
    ConnectorAccountInfo,
    ContainerItem,
    SyncItemInfo
)


class BaseConnector(ABC):
    """Abstract Base Class for all cloud service connectors."""

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Unique provider identifier (e.g., 'google_drive', 'onedrive', 'slack')."""
        pass

    @property
    @abstractmethod
    def display_name(self) -> str:
        """Human-readable provider name (e.g., 'Google Drive', 'Microsoft OneDrive')."""
        pass

    @abstractmethod
    def generate_auth_url(self, company_id: str, user_id: str, redirect_uri: Optional[str] = None) -> str:
        """Generates the OAuth consent URL for authorization."""
        pass

    @abstractmethod
    async def exchange_code(self, code: str, redirect_uri: Optional[str] = None) -> Dict[str, Any]:
        """
        Exchanges OAuth authorization code for token payload.
        Expected return dict keys: access_token, refresh_token, expires_in, account_identifier, extra
        """
        pass

    @abstractmethod
    async def refresh_access_token(self, refresh_token: str) -> Dict[str, Any]:
        """
        Refreshes expired access token using the stored refresh token.
        Expected return dict keys: access_token, refresh_token (optional if rotated), expires_in
        """
        pass

    @abstractmethod
    async def get_account_info(self, access_token: str) -> ConnectorAccountInfo:
        """Retrieves user profile / account details of the authenticated identity."""
        pass

    @abstractmethod
    async def list_containers(
        self,
        access_token: str,
        parent_id: Optional[str] = None,
        drive_id: Optional[str] = None,
        query: Optional[str] = None
    ) -> List[ContainerItem]:
        """
        Lists browseable containers (folders, shared drives, channels).
        Supports hierarchical lazy-loading via parent_id / drive_id.
        """
        pass

    @abstractmethod
    async def register_watch(
        self,
        access_token: str,
        source_id: str,
        webhook_url: str
    ) -> Dict[str, Any]:
        """
        Subscribes to real-time push change notifications from the cloud provider.
        Returns dict with channel_id, resource_id, expiration, start_cursor/page_token.
        """
        pass

    @abstractmethod
    async def stop_watch(
        self,
        access_token: str,
        channel_id: str,
        resource_id: str
    ) -> bool:
        """Terminates an active push notification subscription."""
        pass

    @abstractmethod
    async def fetch_items_in_container(
        self,
        access_token: str,
        container_id: str,
        is_recursive: bool = True,
        drive_id: Optional[str] = None
    ) -> List[SyncItemInfo]:
        """
        Scans all files / documents inside a container (optionally traversing subfolders recursively).
        """
        pass

    @abstractmethod
    async def fetch_incremental_changes(
        self,
        access_token: str,
        sync_cursor: Optional[str],
        monitored_source_ids: List[str],
        drive_id: Optional[str] = None
    ) -> Tuple[List[SyncItemInfo], Optional[str]]:
        """
        Queries changed, added, or deleted items since sync_cursor.
        Returns (list_of_changed_items, new_sync_cursor).
        """
        pass

    @abstractmethod
    async def download_item(
        self,
        access_token: str,
        item: SyncItemInfo
    ) -> Tuple[bytes, str, str]:
        """
        Downloads the file content or exports native documents to PDF/Office format.
        Returns (raw_bytes, final_file_name, extension).
        """
        pass
