# Backend/services/connectors/providers/hubspot/connector.py
"""
HubSpot CRM Enterprise Connector Implementation of BaseConnector.
Supports:
- Deals & Sales Pipelines (with Stages, Probability, and Amounts)
- Contacts & Leads (with Lifecycle Stages and Lead Status)
- Companies & Accounts (with Industry, Revenue, and Domains)
- Service Tickets (with Priority and Status)
- Owner-based ReBAC ACL synchronization
- Synthesized Markdown Dossiers for RAG indexing
"""

import os
import uuid
import json
import hashlib
import urllib.parse
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional, Tuple, Set
import httpx

from services.connectors.base import BaseConnector
from services.connectors.models import (
    ConnectorAccountInfo,
    ContainerItem,
    SyncItemInfo
)
from services.connectors.providers.hubspot.client import (
    HUBSPOT_AUTH_URL,
    HUBSPOT_TOKEN_URL,
    HUBSPOT_INFO_URL,
    HUBSPOT_API_BASE,
    HUBSPOT_SCOPES,
    get_hubspot_credentials,
    execute_hubspot_api_call
)


def _sanitize_name(val: Optional[str], default: str = "item") -> str:
    if not val:
        return default
    clean = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in val.strip())
    return clean[:50].strip("_") or default


class HubSpotConnector(BaseConnector):
    """Enterprise HubSpot CRM Connector."""

    @property
    def provider_name(self) -> str:
        return "hubspot"

    @property
    def display_name(self) -> str:
        return "HubSpot CRM"

    def generate_auth_url(self, company_id: str, user_id: str, redirect_uri: Optional[str] = None) -> str:
        client_id, _, default_redirect, _ = get_hubspot_credentials()
        redirect = redirect_uri or default_redirect

        state_payload = {
            "company_id": str(company_id),
            "user_id": str(user_id),
            "provider": self.provider_name,
            "nonce": str(uuid.uuid4())
        }
        state_str = urllib.parse.quote(json.dumps(state_payload))

        params = {
            "client_id": client_id,
            "redirect_uri": redirect,
            "scope": " ".join(HUBSPOT_SCOPES),
            "state": state_str
        }
        return f"{HUBSPOT_AUTH_URL}?{urllib.parse.urlencode(params)}"

    async def exchange_code(self, code: str, redirect_uri: Optional[str] = None) -> Dict[str, Any]:
        client_id, client_secret, default_redirect, _ = get_hubspot_credentials()
        redirect = redirect_uri or default_redirect

        data = {
            "grant_type": "authorization_code",
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect,
            "code": code
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                HUBSPOT_TOKEN_URL,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"}
            )
            if res.status_code != 200:
                raise ValueError(f"HubSpot token exchange failed ({res.status_code}): {res.text}")
            payload = res.json()

        access_token = payload.get("access_token")
        refresh_token = payload.get("refresh_token")
        expires_in = payload.get("expires_in", 1800)

        # Retrieve HubSpot portal and identity information
        account_info = await self.get_account_info(access_token)

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "expires_in": expires_in,
            "account_identifier": account_info.account_identifier,
            "extra": {
                "account_name": account_info.account_name,
                "portal_id": account_info.extra.get("portal_id"),
                "hub_id": account_info.extra.get("hub_id"),
                "hub_domain": account_info.extra.get("hub_domain"),
                "user_email": account_info.extra.get("user_email")
            }
        }

    async def refresh_access_token(self, refresh_token: str) -> Dict[str, Any]:
        """Refreshes expired HubSpot OAuth access token."""
        client_id, client_secret, _, _ = get_hubspot_credentials()

        data = {
            "grant_type": "refresh_token",
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                HUBSPOT_TOKEN_URL,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"}
            )
            if res.status_code != 200:
                raise ValueError(f"HubSpot token refresh failed ({res.status_code}): {res.text}")
            payload = res.json()

        return {
            "access_token": payload["access_token"],
            "refresh_token": payload.get("refresh_token") or refresh_token,
            "expires_in": payload.get("expires_in", 1800)
        }

    async def get_account_info(self, access_token: str) -> ConnectorAccountInfo:
        """Retrieves portal identity and authorized user email from HubSpot."""
        res = await execute_hubspot_api_call("GET", f"{HUBSPOT_INFO_URL}/{access_token}", access_token)
        if res.status_code != 200:
            raise ValueError(f"Failed to query HubSpot token info: {res.text}")

        data = res.json()
        user_email = data.get("user", "")
        hub_id = str(data.get("hub_id", ""))
        hub_domain = data.get("hub_domain") or f"HubSpot Portal {hub_id}"

        ident = user_email or (f"Portal {hub_id}" if hub_id else "hubspot_user")
        display_acc = f"{user_email} ({hub_domain})" if user_email else hub_domain

        return ConnectorAccountInfo(
            provider=self.provider_name,
            account_identifier=ident,
            account_name=display_acc,
            extra={
                "portal_id": hub_id,
                "hub_id": hub_id,
                "hub_domain": hub_domain,
                "user_email": user_email,
                "scopes": data.get("scopes", [])
            }
        )

    async def list_containers(
        self,
        access_token: str,
        parent_id: Optional[str] = None,
        drive_id: Optional[str] = None,
        query: Optional[str] = None
    ) -> List[ContainerItem]:
        """
        Lists browseable HubSpot modules and pipelines.
        Supports drilling into Deals to pick specific Pipelines.
        """
        containers: List[ContainerItem] = []

        # ── 1. Top-Level Modules ──────────────────────────────────
        if not parent_id:
            containers.append(ContainerItem(
                id="deals",
                name="💼 Deals & Sales Pipelines",
                container_type="crm_module",
                parent_id=None,
                path="/deals",
                has_children=True,
                can_select=True,
                metadata={"module": "deals", "description": "All sales opportunities and deal pipelines"}
            ))
            containers.append(ContainerItem(
                id="contacts",
                name="👤 Contacts & Leads",
                container_type="crm_module",
                parent_id=None,
                path="/contacts",
                has_children=False,
                can_select=True,
                metadata={"module": "contacts", "description": "Individual customer and lead profiles"}
            ))
            containers.append(ContainerItem(
                id="companies",
                name="🏢 Companies & Accounts",
                container_type="crm_module",
                parent_id=None,
                path="/companies",
                has_children=False,
                can_select=True,
                metadata={"module": "companies", "description": "Company accounts and organizations"}
            ))
            containers.append(ContainerItem(
                id="tickets",
                name="🎫 Customer Support Tickets",
                container_type="crm_module",
                parent_id=None,
                path="/tickets",
                has_children=True,
                can_select=True,
                metadata={"module": "tickets", "description": "Support cases and service tickets"}
            ))
            return containers

        # ── 2. Drilldown: Deal Pipelines ──────────────────────────
        if parent_id == "deals":
            try:
                res = await execute_hubspot_api_call("GET", "/crm/v3/pipelines/deals", access_token)
                if res.status_code == 200:
                    pipes = res.json().get("results", [])
                    for p in pipes:
                        pipe_id = p.get("id")
                        label = p.get("label", pipe_id)
                        stages = p.get("stages", [])
                        containers.append(ContainerItem(
                            id=f"deal_pipeline_{pipe_id}",
                            name=f"📊 {label} ({len(stages)} stages)",
                            container_type="pipeline",
                            parent_id="deals",
                            path=f"/deals/{label}",
                            has_children=False,
                            can_select=True,
                            metadata={"pipeline_id": pipe_id, "stages": stages}
                        ))
            except Exception as pipe_err:
                print(f"[HUBSPOT CONNECTOR] Failed to fetch deal pipelines: {pipe_err}")

        # ── 3. Drilldown: Ticket Pipelines ────────────────────────
        elif parent_id == "tickets":
            try:
                res = await execute_hubspot_api_call("GET", "/crm/v3/pipelines/tickets", access_token)
                if res.status_code == 200:
                    pipes = res.json().get("results", [])
                    for p in pipes:
                        pipe_id = p.get("id")
                        label = p.get("label", pipe_id)
                        stages = p.get("stages", [])
                        containers.append(ContainerItem(
                            id=f"ticket_pipeline_{pipe_id}",
                            name=f"🎫 {label} ({len(stages)} stages)",
                            container_type="pipeline",
                            parent_id="tickets",
                            path=f"/tickets/{label}",
                            has_children=False,
                            can_select=True,
                            metadata={"pipeline_id": pipe_id, "stages": stages}
                        ))
            except Exception as pipe_err:
                print(f"[HUBSPOT CONNECTOR] Failed to fetch ticket pipelines: {pipe_err}")

        return containers

    async def register_watch(
        self,
        access_token: str,
        source_id: str,
        webhook_url: str
    ) -> Dict[str, Any]:
        """
        HubSpot webhooks are managed centrally via HubSpot App Developer Portal.
        Records active subscription reference for this container.
        """
        exp_iso = (datetime.now(timezone.utc) + timedelta(days=365)).isoformat()
        return {
            "channel_id": f"hubspot_{source_id}",
            "resource_id": source_id,
            "expiration": exp_iso,
            "start_cursor": str(int(time.time() * 1000))
        }

    async def stop_watch(
        self,
        access_token: str,
        channel_id: str,
        resource_id: str
    ) -> bool:
        return True

    # ── Internal Helpers ──────────────────────────────────────────

    async def _fetch_owners(self, access_token: str) -> Dict[str, Dict[str, str]]:
        """Caches mapping of HubSpot Owner ID -> {email, name} for ReBAC ACL assignments."""
        owners_map: Dict[str, Dict[str, str]] = {}
        try:
            res = await execute_hubspot_api_call("GET", "/crm/v3/owners?limit=100", access_token)
            if res.status_code == 200:
                for o in res.json().get("results", []):
                    o_id = str(o.get("id", ""))
                    email = o.get("email") or ""
                    first = o.get("firstName") or ""
                    last = o.get("lastName") or ""
                    name = f"{first} {last}".strip() or email or "HubSpot Owner"
                    if o_id:
                        owners_map[o_id] = {"email": email, "name": name}
        except Exception as e:
            print(f"[HUBSPOT CONNECTOR] Owner fetch note: {e}")
        return owners_map

    async def _fetch_pipeline_stage_map(self, access_token: str, object_type: str = "deals") -> Dict[str, str]:
        """Fetches stage ID -> Stage Label mapping for clean readable dossiers."""
        stage_map: Dict[str, str] = {}
        try:
            res = await execute_hubspot_api_call("GET", f"/crm/v3/pipelines/{object_type}", access_token)
            if res.status_code == 200:
                for pipe in res.json().get("results", []):
                    for st in pipe.get("stages", []):
                        st_id = str(st.get("id", ""))
                        st_lbl = st.get("label", st_id)
                        if st_id:
                            stage_map[st_id] = st_lbl
        except Exception as e:
            print(f"[HUBSPOT CONNECTOR] Pipeline stage map note: {e}")
        return stage_map

    # ── Item Fetching ─────────────────────────────────────────────

    async def fetch_items_in_container(
        self,
        access_token: str,
        container_id: str,
        is_recursive: bool = True,
        drive_id: Optional[str] = None
    ) -> List[SyncItemInfo]:
        """
        Scans HubSpot CRM objects corresponding to the selected container.
        Produces standardized SyncItemInfo models representing synthesized Markdown intelligence dossiers.
        """
        items: List[SyncItemInfo] = []
        owners_map = await self._fetch_owners(access_token)

        # ── A. DEALS ──────────────────────────────────────────────
        if container_id == "deals" or container_id.startswith("deal_pipeline_"):
            stage_map = await self._fetch_pipeline_stage_map(access_token, "deals")
            target_pipeline_id = (
                container_id.replace("deal_pipeline_", "").strip()
                if container_id.startswith("deal_pipeline_")
                else None
            )

            deal_props = [
                "dealname", "amount", "dealstage", "pipeline", "closedate",
                "createdate", "hs_lastmodifieddate", "hubspot_owner_id",
                "description", "hs_deal_stage_probability"
            ]
            params = {
                "limit": 100,
                "properties": ",".join(deal_props),
                "associations": "contacts,companies"
            }

            after: Optional[str] = None
            max_pages = 5  # Fetch up to 500 deals per sync cycle to keep execution fast

            for _ in range(max_pages):
                if after:
                    params["after"] = after

                res = await execute_hubspot_api_call("GET", "/crm/v3/objects/deals", access_token, params=params)
                if res.status_code != 200:
                    break

                body = res.json()
                deals = body.get("results", [])

                for deal in deals:
                    d_id = str(deal["id"])
                    props = deal.get("properties") or {}
                    deal_pipe = props.get("pipeline")

                    # Filter by pipeline if specific pipeline container was chosen
                    if target_pipeline_id and deal_pipe != target_pipeline_id:
                        continue

                    d_name = props.get("dealname") or f"Deal_{d_id}"
                    clean_name = _sanitize_name(d_name, default=f"Deal_{d_id}")
                    mod_date = props.get("hs_lastmodifieddate") or datetime.now(timezone.utc).isoformat()
                    stage_id = str(props.get("dealstage", ""))
                    stage_label = stage_map.get(stage_id, stage_id)
                    amount_val = props.get("amount") or "0"

                    owner_id = str(props.get("hubspot_owner_id", ""))
                    owner_info = owners_map.get(owner_id, {})
                    owner_email = owner_info.get("email")
                    owner_name = owner_info.get("name")

                    content_fingerprint = f"deal_{d_id}_{mod_date}_{stage_id}_{amount_val}"
                    c_hash = hashlib.sha256(content_fingerprint.encode()).hexdigest()

                    # ReBAC ACL: owner and shared emails
                    acl_emails = [owner_email] if owner_email else []

                    # Parse modified_time
                    mod_dt = None
                    try:
                        mod_dt = datetime.fromisoformat(mod_date.replace("Z", "+00:00"))
                    except Exception:
                        mod_dt = datetime.now(timezone.utc)

                    items.append(SyncItemInfo(
                        item_id=f"hubspot_deal_{d_id}",
                        item_name=f"HubSpot_Deal_{clean_name}.md",
                        item_type="md",
                        size_bytes=len(json.dumps(props)),
                        content_hash=c_hash,
                        parent_container_id=container_id,
                        modified_time=mod_dt,
                        owner_email=owner_email,
                        acl_emails=acl_emails,
                        metadata={
                            "crm_type": "deal",
                            "deal_id": d_id,
                            "deal_name": d_name,
                            "stage_id": stage_id,
                            "stage_label": stage_label,
                            "pipeline_id": deal_pipe,
                            "amount": amount_val,
                            "close_date": props.get("closedate"),
                            "create_date": props.get("createdate"),
                            "description": props.get("description"),
                            "probability": props.get("hs_deal_stage_probability"),
                            "owner_email": owner_email,
                            "owner_name": owner_name,
                            "associations": deal.get("associations") or {}
                        }
                    ))

                paging = body.get("paging", {})
                after = (paging.get("next") or {}).get("after")
                if not after:
                    break

        # ── B. CONTACTS ───────────────────────────────────────────
        elif container_id == "contacts":
            contact_props = [
                "firstname", "lastname", "email", "phone", "company",
                "jobtitle", "hs_lead_status", "lifecyclestage",
                "createdate", "hs_lastmodifieddate", "hubspot_owner_id"
            ]
            params = {
                "limit": 100,
                "properties": ",".join(contact_props),
                "associations": "companies"
            }

            after = None
            max_pages = 5

            for _ in range(max_pages):
                if after:
                    params["after"] = after

                res = await execute_hubspot_api_call("GET", "/crm/v3/objects/contacts", access_token, params=params)
                if res.status_code != 200:
                    break

                body = res.json()
                contacts = body.get("results", [])

                for c in contacts:
                    c_id = str(c["id"])
                    props = c.get("properties") or {}
                    first_name = props.get("firstname") or ""
                    last_name = props.get("lastname") or ""
                    full_name = f"{first_name} {last_name}".strip() or props.get("email") or f"Contact_{c_id}"
                    clean_name = _sanitize_name(full_name, default=f"Contact_{c_id}")
                    mod_date = props.get("hs_lastmodifieddate") or datetime.now(timezone.utc).isoformat()
                    contact_email = props.get("email")

                    owner_id = str(props.get("hubspot_owner_id", ""))
                    owner_info = owners_map.get(owner_id, {})
                    owner_email = owner_info.get("email")
                    owner_name = owner_info.get("name")

                    content_fingerprint = f"contact_{c_id}_{mod_date}_{props.get('lifecyclestage')}"
                    c_hash = hashlib.sha256(content_fingerprint.encode()).hexdigest()

                    acl_emails: List[str] = []
                    if owner_email:
                        acl_emails.append(owner_email)
                    if contact_email and contact_email not in acl_emails:
                        acl_emails.append(contact_email)

                    mod_dt = None
                    try:
                        mod_dt = datetime.fromisoformat(mod_date.replace("Z", "+00:00"))
                    except Exception:
                        mod_dt = datetime.now(timezone.utc)

                    items.append(SyncItemInfo(
                        item_id=f"hubspot_contact_{c_id}",
                        item_name=f"HubSpot_Contact_{clean_name}.md",
                        item_type="md",
                        size_bytes=len(json.dumps(props)),
                        content_hash=c_hash,
                        parent_container_id=container_id,
                        modified_time=mod_dt,
                        owner_email=owner_email,
                        acl_emails=acl_emails,
                        metadata={
                            "crm_type": "contact",
                            "contact_id": c_id,
                            "full_name": full_name,
                            "email": contact_email,
                            "phone": props.get("phone"),
                            "company": props.get("company"),
                            "jobtitle": props.get("jobtitle"),
                            "lead_status": props.get("hs_lead_status"),
                            "lifecycle_stage": props.get("lifecyclestage"),
                            "owner_email": owner_email,
                            "owner_name": owner_name,
                            "associations": c.get("associations") or {}
                        }
                    ))

                paging = body.get("paging", {})
                after = (paging.get("next") or {}).get("after")
                if not after:
                    break

        # ── C. COMPANIES ──────────────────────────────────────────
        elif container_id == "companies":
            company_props = [
                "name", "domain", "industry", "city", "state", "country",
                "about_us", "numberofemployees", "annualrevenue",
                "createdate", "hs_lastmodifieddate", "hubspot_owner_id"
            ]
            params = {
                "limit": 100,
                "properties": ",".join(company_props)
            }

            after = None
            max_pages = 5

            for _ in range(max_pages):
                if after:
                    params["after"] = after

                res = await execute_hubspot_api_call("GET", "/crm/v3/objects/companies", access_token, params=params)
                if res.status_code != 200:
                    break

                body = res.json()
                companies = body.get("results", [])

                for comp in companies:
                    comp_id = str(comp["id"])
                    props = comp.get("properties") or {}
                    comp_name = props.get("name") or props.get("domain") or f"Company_{comp_id}"
                    clean_name = _sanitize_name(comp_name, default=f"Company_{comp_id}")
                    mod_date = props.get("hs_lastmodifieddate") or datetime.now(timezone.utc).isoformat()

                    owner_id = str(props.get("hubspot_owner_id", ""))
                    owner_info = owners_map.get(owner_id, {})
                    owner_email = owner_info.get("email")

                    content_fingerprint = f"company_{comp_id}_{mod_date}"
                    c_hash = hashlib.sha256(content_fingerprint.encode()).hexdigest()

                    mod_dt = None
                    try:
                        mod_dt = datetime.fromisoformat(mod_date.replace("Z", "+00:00"))
                    except Exception:
                        mod_dt = datetime.now(timezone.utc)

                    items.append(SyncItemInfo(
                        item_id=f"hubspot_company_{comp_id}",
                        item_name=f"HubSpot_Company_{clean_name}.md",
                        item_type="md",
                        size_bytes=len(json.dumps(props)),
                        content_hash=c_hash,
                        parent_container_id=container_id,
                        modified_time=mod_dt,
                        owner_email=owner_email,
                        acl_emails=[owner_email] if owner_email else [],
                        metadata={
                            "crm_type": "company",
                            "company_id": comp_id,
                            "company_name": comp_name,
                            "domain": props.get("domain"),
                            "industry": props.get("industry"),
                            "revenue": props.get("annualrevenue"),
                            "employees": props.get("numberofemployees"),
                            "city": props.get("city"),
                            "country": props.get("country"),
                            "about_us": props.get("about_us"),
                            "owner_email": owner_email
                        }
                    ))

                paging = body.get("paging", {})
                after = (paging.get("next") or {}).get("after")
                if not after:
                    break

        # ── D. TICKETS ────────────────────────────────────────────
        elif container_id == "tickets" or container_id.startswith("ticket_pipeline_"):
            stage_map = await self._fetch_pipeline_stage_map(access_token, "tickets")
            target_pipeline_id = (
                container_id.replace("ticket_pipeline_", "").strip()
                if container_id.startswith("ticket_pipeline_")
                else None
            )

            ticket_props = [
                "subject", "content", "hs_pipeline", "hs_pipeline_stage",
                "hs_ticket_priority", "hs_ticket_category", "createdate",
                "hs_lastmodifieddate", "hubspot_owner_id"
            ]
            params = {
                "limit": 100,
                "properties": ",".join(ticket_props)
            }

            after = None
            max_pages = 5

            for _ in range(max_pages):
                if after:
                    params["after"] = after

                res = await execute_hubspot_api_call("GET", "/crm/v3/objects/tickets", access_token, params=params)
                if res.status_code != 200:
                    break

                body = res.json()
                tickets = body.get("results", [])

                for t in tickets:
                    t_id = str(t["id"])
                    props = t.get("properties") or {}
                    t_pipe = props.get("hs_pipeline")

                    if target_pipeline_id and t_pipe != target_pipeline_id:
                        continue

                    subject = props.get("subject") or f"Ticket_{t_id}"
                    clean_name = _sanitize_name(subject, default=f"Ticket_{t_id}")
                    mod_date = props.get("hs_lastmodifieddate") or datetime.now(timezone.utc).isoformat()
                    stage_id = str(props.get("hs_pipeline_stage", ""))
                    stage_label = stage_map.get(stage_id, stage_id)

                    owner_id = str(props.get("hubspot_owner_id", ""))
                    owner_info = owners_map.get(owner_id, {})
                    owner_email = owner_info.get("email")

                    content_fingerprint = f"ticket_{t_id}_{mod_date}_{stage_id}"
                    c_hash = hashlib.sha256(content_fingerprint.encode()).hexdigest()

                    mod_dt = None
                    try:
                        mod_dt = datetime.fromisoformat(mod_date.replace("Z", "+00:00"))
                    except Exception:
                        mod_dt = datetime.now(timezone.utc)

                    items.append(SyncItemInfo(
                        item_id=f"hubspot_ticket_{t_id}",
                        item_name=f"HubSpot_Ticket_{clean_name}.md",
                        item_type="md",
                        size_bytes=len(json.dumps(props)),
                        content_hash=c_hash,
                        parent_container_id=container_id,
                        modified_time=mod_dt,
                        owner_email=owner_email,
                        acl_emails=[owner_email] if owner_email else [],
                        metadata={
                            "crm_type": "ticket",
                            "ticket_id": t_id,
                            "subject": subject,
                            "priority": props.get("hs_ticket_priority"),
                            "category": props.get("hs_ticket_category"),
                            "stage_label": stage_label,
                            "content": props.get("content"),
                            "owner_email": owner_email
                        }
                    ))

                paging = body.get("paging", {})
                after = (paging.get("next") or {}).get("after")
                if not after:
                    break

        return items

    async def fetch_incremental_changes(
        self,
        access_token: str,
        sync_cursor: Optional[str],
        monitored_source_ids: List[str],
        drive_id: Optional[str] = None
    ) -> Tuple[List[SyncItemInfo], Optional[str]]:
        """
        Queries updated or newly created records using HubSpot's Search API
        since the provided sync_cursor timestamp.
        """
        if not monitored_source_ids:
            return [], sync_cursor

        target_container = monitored_source_ids[0]
        now_cursor = str(int(time.time() * 1000))

        # If no cursor exists yet, do a full scan of the monitored container
        if not sync_cursor:
            items = await self.fetch_items_in_container(access_token, target_container)
            return items, now_cursor

        # Map container to HubSpot object type
        obj_type = "deals"
        if "contact" in target_container:
            obj_type = "contacts"
        elif "compan" in target_container:
            obj_type = "companies"
        elif "ticket" in target_container:
            obj_type = "tickets"

        search_payload = {
            "filterGroups": [
                {
                    "filters": [
                        {
                            "propertyName": "hs_lastmodifieddate",
                            "operator": "GTE",
                            "value": sync_cursor
                        }
                    ]
                }
            ],
            "sorts": ["hs_lastmodifieddate"],
            "limit": 100
        }

        try:
            res = await execute_hubspot_api_call(
                "POST",
                f"/crm/v3/objects/{obj_type}/search",
                access_token,
                json_data=search_payload
            )
            if res.status_code == 200:
                results = res.json().get("results", [])
                if not results:
                    return [], now_cursor

                # Retrieve full hydrated items for updated records
                items = await self.fetch_items_in_container(access_token, target_container)
                return items, now_cursor
        except Exception as search_err:
            print(f"[HUBSPOT INCREMENTAL] Search error: {search_err}. Falling back to container fetch.")

        items = await self.fetch_items_in_container(access_token, target_container)
        return items, now_cursor

    async def download_item(
        self,
        access_token: str,
        item: SyncItemInfo
    ) -> Tuple[bytes, str, str]:
        """
        Synthesizes a structured, executive-grade Markdown document from the CRM record.
        This provides high-density, semantic knowledge for AI Coach vector search & RAG retrieval.
        """
        meta = item.metadata or {}
        crm_type = meta.get("crm_type", "record")

        # ── 1. Deal Dossier ───────────────────────────────────────
        if crm_type == "deal":
            amount_num = meta.get("amount") or "0"
            try:
                formatted_amount = f"${float(amount_num):,.2f}"
            except Exception:
                formatted_amount = f"${amount_num}"

            md_lines = [
                f"# 💼 Deal Dossier: {meta.get('deal_name')}",
                "",
                "## Executive Summary",
                f"- **Deal ID**: `{meta.get('deal_id')}`",
                f"- **Pipeline Stage**: **{meta.get('stage_label') or 'Open'}**",
                f"- **Total Amount**: **{formatted_amount}**",
                f"- **Win Probability**: {meta.get('probability') or 'N/A'}%",
                f"- **Target Close Date**: {meta.get('close_date') or 'Unspecified'}",
                f"- **Deal Owner**: {meta.get('owner_name') or meta.get('owner_email') or 'Unassigned'}",
                f"- **Owner Email**: {meta.get('owner_email') or 'N/A'}",
                f"- **Creation Date**: {meta.get('create_date') or 'N/A'}",
                "",
                "## Deal Description & Strategic Context",
                meta.get("description") or "No detailed description was recorded for this deal.",
                "",
                "## Linked CRM Associations",
            ]

            assocs = meta.get("associations") or {}
            companies = (assocs.get("companies") or {}).get("results", [])
            contacts = (assocs.get("contacts") or {}).get("results", [])

            if companies:
                md_lines.append(f"- **Associated Companies (IDs)**: {', '.join(str(c.get('id')) for c in companies)}")
            if contacts:
                md_lines.append(f"- **Associated Contacts (IDs)**: {', '.join(str(ct.get('id')) for ct in contacts)}")
            if not companies and not contacts:
                md_lines.append("- *No direct contact or company associations linked.*")

            content = "\n".join(md_lines)

        # ── 2. Contact Dossier ────────────────────────────────────
        elif crm_type == "contact":
            md_lines = [
                f"# 👤 Contact Profile: {meta.get('full_name')}",
                "",
                "## Contact Details",
                f"- **Contact ID**: `{meta.get('contact_id')}`",
                f"- **Email Address**: {meta.get('email') or 'N/A'}",
                f"- **Phone Number**: {meta.get('phone') or 'N/A'}",
                f"- **Job Title**: {meta.get('jobtitle') or 'N/A'}",
                f"- **Company**: {meta.get('company') or 'N/A'}",
                f"- **Lifecycle Stage**: {meta.get('lifecycle_stage') or 'Lead'}",
                f"- **Lead Status**: {meta.get('lead_status') or 'New'}",
                f"- **Assigned Owner**: {meta.get('owner_name') or meta.get('owner_email') or 'Unassigned'}",
                "",
                "## Engagement Summary",
                f"Contact identity recorded in HubSpot CRM for enterprise relationship tracking."
            ]
            content = "\n".join(md_lines)

        # ── 3. Company Dossier ────────────────────────────────────
        elif crm_type == "company":
            rev = meta.get("revenue")
            rev_str = f"${float(rev):,.2f}" if rev and rev.isdigit() else (rev or "N/A")

            md_lines = [
                f"# 🏢 Account 360: {meta.get('company_name')}",
                "",
                "## Corporate Overview",
                f"- **Company ID**: `{meta.get('company_id')}`",
                f"- **Domain / Website**: {meta.get('domain') or 'N/A'}",
                f"- **Industry**: {meta.get('industry') or 'N/A'}",
                f"- **Annual Revenue**: {rev_str}",
                f"- **Number of Employees**: {meta.get('employees') or 'N/A'}",
                f"- **Headquarters**: {meta.get('city') or ''}, {meta.get('country') or ''}".strip(", "),
                f"- **Account Owner**: {meta.get('owner_email') or 'Unassigned'}",
                "",
                "## About the Organization",
                meta.get("about_us") or "No company overview provided."
            ]
            content = "\n".join(md_lines)

        # ── 4. Ticket Dossier ─────────────────────────────────────
        elif crm_type == "ticket":
            md_lines = [
                f"# 🎫 Support Ticket: {meta.get('subject')}",
                "",
                "## Ticket Metadata",
                f"- **Ticket ID**: `{meta.get('ticket_id')}`",
                f"- **Priority**: {meta.get('priority') or 'Normal'}",
                f"- **Category**: {meta.get('category') or 'General Inquiry'}",
                f"- **Current Stage**: **{meta.get('stage_label') or 'Open'}**",
                f"- **Assigned Representative**: {meta.get('owner_email') or 'Unassigned'}",
                "",
                "## Issue Description",
                meta.get("content") or "No issue description provided in ticket record."
            ]
            content = "\n".join(md_lines)

        else:
            content = f"# CRM Record: {item.item_name}\n\n```json\n{json.dumps(meta, indent=2)}\n```"

        return content.encode("utf-8"), item.item_name, "md"

