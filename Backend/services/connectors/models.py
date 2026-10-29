# Backend/services/connectors/models.py
"""
Data Models and Types for Multi-Connector Integration Engine.
Standardized across Google Drive, OneDrive, Slack, Microsoft Teams, etc.
"""

from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, Field
from datetime import datetime


class ConnectorAccountInfo(BaseModel):
    """Information about the connected account."""
    provider: str
    account_identifier: str  # e.g., user email or workspace name
    account_name: Optional[str] = None
    account_avatar: Optional[str] = None
    extra: Dict[str, Any] = Field(default_factory=dict)


class ContainerItem(BaseModel):
    """
    Standard container model (folder, shared drive, Slack channel, Teams channel).
    """
    id: str
    name: str
    container_type: Literal["folder", "shared_drive", "channel", "workspace"] = "folder"
    parent_id: Optional[str] = None
    path: str = "/"
    drive_id: Optional[str] = None  # Specific to Google Drive / OneDrive Shared Drives
    drive_name: Optional[str] = None
    has_children: bool = True
    can_select: bool = True
    metadata: Dict[str, Any] = Field(default_factory=dict)


class SyncItemInfo(BaseModel):
    """
    Standard item model (file, transcript, message, document).
    """
    item_id: str
    item_name: str
    item_type: str  # extension e.g. "pdf", "docx", "xlsx"
    size_bytes: int = 0
    content_hash: str
    parent_container_id: Optional[str] = None
    relative_path: Optional[str] = None
    modified_time: Optional[datetime] = None
    is_deleted: bool = False
    is_native_workspace: bool = False
    mime_type: Optional[str] = None
    download_url: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class SyncBatchResult(BaseModel):
    """Result of a sync run across monitored sources."""
    provider: str
    company_id: str
    status: Literal["success", "partial", "error", "skipped"]
    synced_count: int = 0
    updated_count: int = 0
    deleted_count: int = 0
    skipped_count: int = 0
    errors: List[Dict[str, Any]] = Field(default_factory=list)
    message: Optional[str] = None
    duration_seconds: float = 0.0


class ConnectorStatus(BaseModel):
    """Standardized connector status for frontend consumption."""
    connected: bool
    provider: str
    company_id: Optional[str] = None
    account_identifier: Optional[str] = None
    status: Literal["active", "disconnected", "error", "syncing"] = "disconnected"
    monitored_source_id: Optional[str] = None
    monitored_source_name: Optional[str] = None
    monitored_source_path: Optional[str] = None
    monitored_source_type: Optional[str] = None
    is_recursive: bool = True
    webhook_active: bool = False
    webhook_expiration: Optional[str] = None
    last_synced_at: Optional[str] = None
    total_synced_files: int = 0
    error_message: Optional[str] = None
    connected_at: Optional[str] = None
    config: Dict[str, Any] = Field(default_factory=dict)
