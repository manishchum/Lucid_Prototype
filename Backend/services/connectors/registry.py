# Backend/services/connectors/registry.py
"""
Registry for Multi-Connector Integrations.
Maintains available connector implementations and provides factory retrieval.
"""

from typing import Dict, Type, Optional, List
from services.connectors.base import BaseConnector


class ConnectorRegistry:
    """Singleton registry for all cloud provider connectors."""

    _instances: Dict[str, BaseConnector] = {}

    @classmethod
    def register(cls, connector: BaseConnector) -> None:
        """Registers a connector instance by its provider_name."""
        cls._instances[connector.provider_name] = connector
        print(f"[CONNECTOR REGISTRY] Registered provider: {connector.provider_name} ({connector.display_name})")

    @classmethod
    def get(cls, provider: str) -> BaseConnector:
        """Retrieves connector for provider or raises ValueError."""
        connector = cls._instances.get(provider)
        if not connector:
            raise ValueError(f"Unknown or unregistered connector provider: '{provider}'. Available: {list(cls._instances.keys())}")
        return connector

    @classmethod
    def list_providers(cls) -> List[Dict[str, str]]:
        """Returns list of registered providers with metadata."""
        return [
            {
                "provider": conn.provider_name,
                "display_name": conn.display_name
            }
            for conn in cls._instances.values()
        ]

    @classmethod
    def is_registered(cls, provider: str) -> bool:
        return provider in cls._instances
