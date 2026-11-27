# Backend/coach/tools/hubspot_mcp.py
"""
In-Process FastMCP Tool Suite for HubSpot CRM.
Provides structured, typed tools for Live Pipeline Analytics, Deal Tracking,
Contact Lookups, Engagement Notes, and Customer Support Tickets.

Enforces:
1. Pre-Retrieval Zanzibar ReBAC (Role-based sales hierarchy pushdown)
2. In-Process FastMCP tool definitions and direct async callable functions
3. Structured Redis caching with 10-minute TTL and Webhook CDC auto-invalidation
4. Dual-Layer PII Firewall (Layer 1 secret scrubbing + Layer 2 role masking)
"""

import os
import json
import hashlib
import asyncio
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Union, Set

from utils.redis_client import get_cache, set_cache, delete_cache_pattern
from utils.supabase_client import supabase_admin
from security.pii_firewall import scrub_hard_pii, allowed_tiers_for_role_level
from security.rebac import UserSecurityContext
from services.connectors.providers.hubspot.client import execute_hubspot_api_call

# Optional FastMCP server registry for standards-compliant MCP clients
try:
    from fastmcp import FastMCP
    mcp_app = FastMCP("HubSpot CRM Intelligence")
except Exception:
    mcp_app = None

# Default cache TTL: 60s in dev/testing, configurable via HUBSPOT_CACHE_TTL
TOOL_CACHE_TTL = int(os.getenv("HUBSPOT_CACHE_TTL", "60"))


# ============================================================================
# SECURITY CONTEXT & IDENTITY HELPERS
# ============================================================================
def _extract_sec(security_ctx: Any) -> Dict[str, Any]:
    """Normalizes UserSecurityContext or serialized dict into security attributes."""
    if not security_ctx:
        return {
            "has_context": False,
            "role_level": 1,
            "user_id": "",
            "email": None,
            "is_admin": False,
            "managed_employee_ids": [],
            "principals": [],
        }
    if isinstance(security_ctx, dict):
        rl = int(security_ctx.get("role_level", 1))
        return {
            "has_context": True,
            "role_level": rl,
            "user_id": str(security_ctx.get("user_id") or ""),
            "email": security_ctx.get("email"),
            "is_admin": bool(security_ctx.get("is_admin", rl >= 3)),
            "managed_employee_ids": list(security_ctx.get("managed_employee_ids") or []),
            "principals": list(security_ctx.get("principals") or []),
        }
    rl = int(getattr(security_ctx, "role_level", 1))
    return {
        "has_context": True,
        "role_level": rl,
        "user_id": str(getattr(security_ctx, "user_id", "")),
        "email": getattr(security_ctx, "email", None),
        "is_admin": bool(getattr(security_ctx, "is_admin", rl >= 3)),
        "managed_employee_ids": list(getattr(security_ctx, "managed_employee_ids", [])),
        "principals": list(getattr(security_ctx, "principals", [])),
    }


async def _get_hubspot_token(company_id: str) -> Optional[str]:
    """Retrieves dynamic multi-tenant HubSpot OAuth access token from Vault."""
    try:
        from services.connectors.manager import ConnectorManager
        return await ConnectorManager.get_valid_access_token(company_id, provider="hubspot")
    except Exception as e:
        print(f"[HUBSPOT MCP] Error getting access token for company {company_id}: {e}")
        return None


async def _fetch_hubspot_owners(access_token: str, company_id: str) -> Dict[str, Dict[str, Any]]:
    """
    Fetches HubSpot owners map: owner_id -> {id, email, name}.
    Cached in Redis for 1 hour.
    """
    cache_key = f"hubspot:owners:{company_id}"
    cached = get_cache(cache_key)
    if isinstance(cached, dict) and cached:
        return cached

    owners_map: Dict[str, Dict[str, Any]] = {}
    try:
        res = await execute_hubspot_api_call("GET", "/crm/v3/owners", access_token, params={"limit": 100})
        if res.status_code == 200:
            for o in res.json().get("results", []):
                oid = str(o.get("id"))
                em = str(o.get("email") or "").strip().lower()
                fn = str(o.get("firstName") or "").strip()
                ln = str(o.get("lastName") or "").strip()
                name = f"{fn} {ln}".strip() or em or f"Owner_{oid}"
                owners_map[oid] = {"id": oid, "email": em, "name": name}
            if owners_map:
                set_cache(cache_key, owners_map, ttl=3600)
    except Exception as e:
        print(f"[HUBSPOT MCP] Warning fetching owners: {e}")

    return owners_map


async def _resolve_allowed_owner_ids(
    sec: Dict[str, Any],
    access_token: str,
    company_id: str
) -> Optional[List[str]]:
    """
    Computes pre-retrieval ReBAC pushdown filter for HubSpot owner IDs:
    - Admin (role_level >= 3): None (unrestricted org-wide access)
    - Manager (role_level == 2): caller owner ID + all subordinates' owner IDs
    - Rep (role_level == 1): caller owner ID strictly
    """
    if sec["is_admin"]:
        return None  # Unrestricted

    owners_map = await _fetch_hubspot_owners(access_token, company_id)
    email_to_oid = {v["email"]: k for k, v in owners_map.items() if v.get("email")}

    caller_email = (sec.get("email") or "").strip().lower()
    allowed_emails: Set[str] = set()
    if caller_email:
        allowed_emails.add(caller_email)

    if sec["role_level"] == 2:
        # Resolve manager's reporting subtree emails
        managed_uids = sec.get("managed_employee_ids") or []
        if managed_uids:
            try:
                res = (
                    supabase_admin.table("users")
                    .select("email")
                    .in_("user_id", managed_uids)
                    .execute()
                )
                for u in getattr(res, "data", None) or []:
                    em = (u.get("email") or "").strip().lower()
                    if em:
                        allowed_emails.add(em)
            except Exception as e:
                print(f"[HUBSPOT MCP] ReBAC managed user lookup note: {e}")

    # Map allowed emails to HubSpot owner IDs
    allowed_owner_ids = [email_to_oid[em] for em in allowed_emails if em in email_to_oid]
    if not allowed_owner_ids:
        # Caller has no corresponding HubSpot owner profile - fail closed
        return ["__NO_RECORDS_MATCH__"]

    return allowed_owner_ids


# ============================================================================
# STRUCTURED REDIS CACHING
# ============================================================================
def _get_cache_key(company_id: str, tool_name: str, args: Dict[str, Any], user_role_level: int, user_id: str) -> str:
    # Hash arguments combined with role_level to prevent cross-privilege cache poisoning
    clean_args = {k: v for k, v in args.items() if v is not None}
    raw = f"{tool_name}:{user_role_level}:{user_id}:{json.dumps(clean_args, sort_keys=True)}"
    h = hashlib.sha256(raw.encode()).hexdigest()[:16]
    return f"hubspot:{company_id}:{tool_name}:{h}"


# ============================================================================
# 1. HUBSPOT SEARCH DEALS TOOL
# ============================================================================
async def hubspot_search_deals(
    company_id: str,
    security_ctx: Any,
    stage: Optional[str] = None,
    pipeline: Optional[str] = None,
    min_amount: Optional[float] = None,
    max_amount: Optional[float] = None,
    closed_after: Optional[str] = None,
    closed_before: Optional[str] = None,
    search_query: Optional[str] = None,
    limit: int = 50,
) -> Dict[str, Any]:
    """
    Searches HubSpot Deals with Pre-Retrieval Zanzibar ReBAC scoping.
    Computes exact aggregations (total count, dollar sum, average, and stage breakdown).
    """
    sec = _extract_sec(security_ctx)
    cache_key = _get_cache_key(company_id, "search_deals", locals(), sec["role_level"], sec["user_id"])
    cached = get_cache(cache_key)
    if isinstance(cached, dict):
        return cached

    access_token = await _get_hubspot_token(company_id)
    if not access_token:
        return {"error": "HubSpot CRM not connected or credentials expired for this company.", "deals": []}

    allowed_owner_ids = await _resolve_allowed_owner_ids(sec, access_token, company_id)
    if allowed_owner_ids == ["__NO_RECORDS_MATCH__"]:
        return {
            "total_deals_matched": 0,
            "total_amount_sum": 0.0,
            "average_amount": 0.0,
            "stage_breakdown": {},
            "deals": [],
            "message": "No deals found within your assigned HubSpot ownership scope."
        }

    owners_map = await _fetch_hubspot_owners(access_token, company_id)

    # Build search filter groups
    filters = []
    if allowed_owner_ids is not None:
        filters.append({"propertyName": "hubspot_owner_id", "operator": "IN", "values": allowed_owner_ids})
    if stage:
        filters.append({"propertyName": "dealstage", "operator": "EQ", "value": stage})
    if pipeline:
        filters.append({"propertyName": "pipeline", "operator": "EQ", "value": pipeline})
    if min_amount is not None:
        filters.append({"propertyName": "amount", "operator": "GTE", "value": str(min_amount)})
    if max_amount is not None:
        filters.append({"propertyName": "amount", "operator": "LTE", "value": str(max_amount)})
    if closed_after:
        filters.append({"propertyName": "closedate", "operator": "GTE", "value": closed_after})
    if closed_before:
        filters.append({"propertyName": "closedate", "operator": "LTE", "value": closed_before})

    search_payload: Dict[str, Any] = {
        "limit": min(limit, 100),
        "properties": [
            "dealname", "amount", "dealstage", "pipeline", "closedate",
            "createdate", "description", "hs_deal_stage_probability", "hubspot_owner_id"
        ],
        "sorts": [{"propertyName": "amount", "direction": "DESCENDING"}]
    }
    if filters:
        search_payload["filterGroups"] = [{"filters": filters}]
    if search_query:
        search_payload["query"] = search_query

    res = await execute_hubspot_api_call("POST", "/crm/v3/objects/deals/search", access_token, json_data=search_payload)
    if res.status_code != 200:
        return {"error": f"HubSpot search failed (status {res.status_code}): {res.text}", "deals": []}

    results = res.json().get("results", [])

    total_sum = 0.0
    stage_breakdown: Dict[str, Dict[str, Any]] = {}
    cleaned_deals: List[Dict[str, Any]] = []

    for d in results:
        props = d.get("properties") or {}
        raw_amt = props.get("amount")
        try:
            amt = float(raw_amt) if raw_amt is not None else 0.0
        except ValueError:
            amt = 0.0
        total_sum += amt

        d_stage = str(props.get("dealstage", "unknown"))
        if d_stage not in stage_breakdown:
            stage_breakdown[d_stage] = {"count": 0, "total_value": 0.0}
        stage_breakdown[d_stage]["count"] += 1
        stage_breakdown[d_stage]["total_value"] += amt

        owner_id = str(props.get("hubspot_owner_id", ""))
        owner_info = owners_map.get(owner_id, {})

        cleaned_deals.append({
            "id": d.get("id"),
            "dealname": props.get("dealname"),
            "amount": amt,
            "dealstage": d_stage,
            "pipeline": props.get("pipeline"),
            "closedate": props.get("closedate"),
            "createdate": props.get("createdate"),
            "probability": props.get("hs_deal_stage_probability"),
            "owner_name": owner_info.get("name", "Unassigned"),
            "owner_email": owner_info.get("email"),
        })

    avg_amt = round(total_sum / len(results), 2) if results else 0.0

    output = {
        "total_deals_matched": len(results),
        "total_amount_sum": round(total_sum, 2),
        "average_amount": avg_amt,
        "stage_breakdown": stage_breakdown,
        "deals": cleaned_deals,
    }
    set_cache(cache_key, output, ttl=TOOL_CACHE_TTL)
    return output


# ============================================================================
# 2. HUBSPOT GET DEAL DETAILS
# ============================================================================
async def hubspot_get_deal(
    company_id: str,
    deal_id: str,
    security_ctx: Any,
) -> Dict[str, Any]:
    """
    Fetches comprehensive details for a specific deal including associated contacts and companies.
    Enforces ReBAC ownership validation and Layer 1 PII scrubbing on deal descriptions.
    """
    sec = _extract_sec(security_ctx)
    deal_id_clean = str(deal_id).strip()

    cache_key = _get_cache_key(company_id, "get_deal", {"deal_id": deal_id_clean}, sec["role_level"], sec["user_id"])
    cached = get_cache(cache_key)
    if isinstance(cached, dict):
        return cached

    access_token = await _get_hubspot_token(company_id)
    if not access_token:
        return {"error": "HubSpot CRM not connected."}

    endpoint = f"/crm/v3/objects/deals/{deal_id_clean}"
    params = {
        "properties": "dealname,amount,dealstage,pipeline,closedate,createdate,description,hs_deal_stage_probability,hubspot_owner_id",
        "associations": "contacts,companies"
    }

    res = await execute_hubspot_api_call("GET", endpoint, access_token, params=params)
    if res.status_code == 404:
        return {"error": f"Deal with ID '{deal_id_clean}' not found."}
    if res.status_code != 200:
        return {"error": f"Failed to retrieve deal: {res.text}"}

    data = res.json()
    props = data.get("properties") or {}

    # ReBAC Authorization Check
    if not sec["is_admin"]:
        allowed_owner_ids = await _resolve_allowed_owner_ids(sec, access_token, company_id)
        deal_owner = str(props.get("hubspot_owner_id") or "")
        if allowed_owner_ids is not None and deal_owner not in allowed_owner_ids:
            return {"error": "Access Denied: You do not have permission to view this deal under your sales scope."}

    owners_map = await _fetch_hubspot_owners(access_token, company_id)
    owner_info = owners_map.get(str(props.get("hubspot_owner_id") or ""), {})

    # Layer 1 PII scrubbing on text fields
    desc = props.get("description") or ""
    clean_desc, _ = scrub_hard_pii(desc)

    raw_amt = props.get("amount")
    try:
        amt = float(raw_amt) if raw_amt is not None else 0.0
    except ValueError:
        amt = 0.0

    output = {
        "id": data.get("id"),
        "dealname": props.get("dealname"),
        "amount": amt,
        "dealstage": props.get("dealstage"),
        "pipeline": props.get("pipeline"),
        "closedate": props.get("closedate"),
        "createdate": props.get("createdate"),
        "description": clean_desc,
        "probability": props.get("hs_deal_stage_probability"),
        "owner_name": owner_info.get("name", "Unassigned"),
        "owner_email": owner_info.get("email"),
        "associations": data.get("associations") or {},
    }
    set_cache(cache_key, output, ttl=TOOL_CACHE_TTL)
    return output


# ============================================================================
# 3. HUBSPOT SEARCH CONTACTS TOOL
# ============================================================================
async def hubspot_search_contacts(
    company_id: str,
    security_ctx: Any,
    search_query: Optional[str] = None,
    lifecycle_stage: Optional[str] = None,
    lead_status: Optional[str] = None,
    limit: int = 25,
) -> Dict[str, Any]:
    """
    Looks up CRM contacts and leads.
    Enforces Layer 2 PII Masking: Employee-level callers receive masked phone numbers & personal emails.
    """
    sec = _extract_sec(security_ctx)
    cache_key = _get_cache_key(company_id, "search_contacts", locals(), sec["role_level"], sec["user_id"])
    cached = get_cache(cache_key)
    if isinstance(cached, dict):
        return cached

    access_token = await _get_hubspot_token(company_id)
    if not access_token:
        return {"error": "HubSpot CRM not connected."}

    owners_map = await _fetch_hubspot_owners(access_token, company_id)

    filters = []
    if lifecycle_stage:
        filters.append({"propertyName": "lifecyclestage", "operator": "EQ", "value": lifecycle_stage})
    if lead_status:
        filters.append({"propertyName": "hs_lead_status", "operator": "EQ", "value": lead_status})

    payload: Dict[str, Any] = {
        "limit": min(limit, 50),
        "properties": ["firstname", "lastname", "email", "phone", "company", "jobtitle", "hs_lead_status", "lifecyclestage", "hubspot_owner_id", "createdate"],
        "sorts": [{"propertyName": "createdate", "direction": "DESCENDING"}]
    }
    if filters:
        payload["filterGroups"] = [{"filters": filters}]
    if search_query:
        payload["query"] = search_query

    res = await execute_hubspot_api_call("POST", "/crm/v3/objects/contacts/search", access_token, json_data=payload)
    if res.status_code != 200:
        return {"error": f"Failed to search contacts: {res.text}", "contacts": []}

    contacts = res.json().get("results", [])
    cleaned_contacts = []
    caller_email = (sec.get("email") or "").strip().lower()

    for c in contacts:
        props = c.get("properties") or {}
        fn = props.get("firstname") or ""
        ln = props.get("lastname") or ""
        full_name = f"{fn} {ln}".strip() or "Unnamed Contact"

        phone = props.get("phone") or ""
        email = props.get("email") or ""

        owner_id = str(props.get("hubspot_owner_id") or "")
        owner_info = owners_map.get(owner_id, {})
        is_owner = (owner_info.get("email", "").lower() == caller_email)

        # Layer 2 PII Masking: Mask personal details for reps querying non-owned contacts
        if sec["role_level"] < 2 and not is_owner and not sec["is_admin"]:
            if phone:
                phone = "[MASKED_PHONE]"
            if email and email.lower() != caller_email:
                email = "[MASKED_EMAIL]"

        cleaned_contacts.append({
            "id": c.get("id"),
            "name": full_name,
            "email": email,
            "phone": phone,
            "company": props.get("company"),
            "jobtitle": props.get("jobtitle"),
            "lifecyclestage": props.get("lifecyclestage"),
            "lead_status": props.get("hs_lead_status"),
            "owner_name": owner_info.get("name", "Unassigned"),
        })

    output = {
        "total_contacts": len(cleaned_contacts),
        "contacts": cleaned_contacts
    }
    set_cache(cache_key, output, ttl=TOOL_CACHE_TTL)
    return output


# ============================================================================
# 4. HUBSPOT GET CONTACT DETAILS
# ============================================================================
async def hubspot_get_contact(
    company_id: str,
    contact_id: str,
    security_ctx: Any,
) -> Dict[str, Any]:
    """Fetches full profile for a single contact with Layer 2 PII masking applied."""
    sec = _extract_sec(security_ctx)
    contact_id_clean = str(contact_id).strip()

    cache_key = _get_cache_key(company_id, "get_contact", {"contact_id": contact_id_clean}, sec["role_level"], sec["user_id"])
    cached = get_cache(cache_key)
    if isinstance(cached, dict):
        return cached

    access_token = await _get_hubspot_token(company_id)
    if not access_token:
        return {"error": "HubSpot CRM not connected."}

    endpoint = f"/crm/v3/objects/contacts/{contact_id_clean}"
    params = {
        "properties": "firstname,lastname,email,phone,company,jobtitle,hs_lead_status,lifecyclestage,hubspot_owner_id,createdate,hs_lastmodifieddate",
        "associations": "deals,companies"
    }

    res = await execute_hubspot_api_call("GET", endpoint, access_token, params=params)
    if res.status_code == 404:
        return {"error": f"Contact with ID '{contact_id_clean}' not found."}
    if res.status_code != 200:
        return {"error": f"Failed to retrieve contact: {res.text}"}

    data = res.json()
    props = data.get("properties") or {}

    fn = props.get("firstname") or ""
    ln = props.get("lastname") or ""
    full_name = f"{fn} {ln}".strip() or "Unnamed Contact"

    phone = props.get("phone") or ""
    email = props.get("email") or ""

    owners_map = await _fetch_hubspot_owners(access_token, company_id)
    owner_info = owners_map.get(str(props.get("hubspot_owner_id") or ""), {})
    caller_email = (sec.get("email") or "").strip().lower()
    is_owner = (owner_info.get("email", "").lower() == caller_email)

    if sec["role_level"] < 2 and not is_owner and not sec["is_admin"]:
        if phone:
            phone = "[MASKED_PHONE]"
        if email and email.lower() != caller_email:
            email = "[MASKED_EMAIL]"

    output = {
        "id": data.get("id"),
        "name": full_name,
        "email": email,
        "phone": phone,
        "company": props.get("company"),
        "jobtitle": props.get("jobtitle"),
        "lifecyclestage": props.get("lifecyclestage"),
        "lead_status": props.get("hs_lead_status"),
        "createdate": props.get("createdate"),
        "owner_name": owner_info.get("name", "Unassigned"),
        "associations": data.get("associations") or {},
    }
    set_cache(cache_key, output, ttl=TOOL_CACHE_TTL)
    return output


# ============================================================================
# 5. HUBSPOT SEARCH COMPANIES (ACCOUNT 360)
# ============================================================================
async def hubspot_search_companies(
    company_id: str,
    security_ctx: Any,
    search_query: Optional[str] = None,
    industry: Optional[str] = None,
    limit: int = 25,
) -> Dict[str, Any]:
    """Searches Account 360 profiles (domain, annual revenue, employee count, industry)."""
    sec = _extract_sec(security_ctx)
    cache_key = _get_cache_key(company_id, "search_companies", locals(), sec["role_level"], sec["user_id"])
    cached = get_cache(cache_key)
    if isinstance(cached, dict):
        return cached

    access_token = await _get_hubspot_token(company_id)
    if not access_token:
        return {"error": "HubSpot CRM not connected."}

    filters = []
    if industry:
        filters.append({"propertyName": "industry", "operator": "EQ", "value": industry})

    payload: Dict[str, Any] = {
        "limit": min(limit, 50),
        "properties": ["name", "domain", "industry", "city", "state", "annualrevenue", "numberofemployees", "createdate"],
        "sorts": [{"propertyName": "annualrevenue", "direction": "DESCENDING"}]
    }
    if filters:
        payload["filterGroups"] = [{"filters": filters}]
    if search_query:
        payload["query"] = search_query

    res = await execute_hubspot_api_call("POST", "/crm/v3/objects/companies/search", access_token, json_data=payload)
    if res.status_code != 200:
        return {"error": f"Failed to search companies: {res.text}", "companies": []}

    results = res.json().get("results", [])
    cleaned = []
    for comp in results:
        props = comp.get("properties") or {}
        cleaned.append({
            "id": comp.get("id"),
            "name": props.get("name") or "Unnamed Account",
            "domain": props.get("domain"),
            "industry": props.get("industry"),
            "city": props.get("city"),
            "state": props.get("state"),
            "annual_revenue": props.get("annualrevenue"),
            "employees": props.get("numberofemployees"),
        })

    output = {"total_companies": len(cleaned), "companies": cleaned}
    set_cache(cache_key, output, ttl=TOOL_CACHE_TTL)
    return output


# ============================================================================
# 6. HUBSPOT ENGAGEMENT NOTES & CALL LOGS TOOL
# ============================================================================
async def hubspot_list_engagements(
    company_id: str,
    object_type: str,  # 'deals' | 'contacts' | 'companies'
    object_id: str,
    security_ctx: Any,
    limit: int = 15,
) -> Dict[str, Any]:
    """
    Fetches logged meeting notes, call notes, and email history associated with a record.
    Layer 1 PII Firewall deterministically scrubs hard credentials/secrets from all notes.
    """
    sec = _extract_sec(security_ctx)
    obj_type = object_type.lower().strip()
    obj_id = str(object_id).strip()

    cache_key = _get_cache_key(company_id, "list_engagements", {"object_type": obj_type, "object_id": obj_id}, sec["role_level"], sec["user_id"])
    cached = get_cache(cache_key)
    if isinstance(cached, dict):
        return cached

    access_token = await _get_hubspot_token(company_id)
    if not access_token:
        return {"error": "HubSpot CRM not connected."}

    # Fetch notes associated with the target record
    endpoint = f"/crm/v3/objects/{obj_type}/{obj_id}/associations/notes"
    res = await execute_hubspot_api_call("GET", endpoint, access_token)
    if res.status_code != 200:
        return {"engagements": [], "message": f"No direct notes associations found or object '{obj_type}/{obj_id}' not found."}

    associated_note_ids = [str(r.get("id")) for r in res.json().get("results", []) if r.get("id")]
    if not associated_note_ids:
        return {"engagements": [], "count": 0}

    # Batch read notes content (up to limit)
    notes_payload = {
        "inputs": [{"id": nid} for nid in associated_note_ids[:min(limit, 25)]],
        "properties": ["hs_note_body", "hs_timestamp", "hubspot_owner_id"]
    }
    batch_res = await execute_hubspot_api_call("POST", "/crm/v3/objects/notes/batch/read", access_token, json_data=notes_payload)
    if batch_res.status_code != 200:
        return {"engagements": [], "error": f"Failed to batch read notes: {batch_res.text}"}

    owners_map = await _fetch_hubspot_owners(access_token, company_id)
    engagements = []

    for item in batch_res.json().get("results", []):
        props = item.get("properties") or {}
        raw_body = props.get("hs_note_body") or ""
        clean_body, _ = scrub_hard_pii(raw_body)

        owner_info = owners_map.get(str(props.get("hubspot_owner_id") or ""), {})
        engagements.append({
            "id": item.get("id"),
            "timestamp": props.get("hs_timestamp"),
            "author": owner_info.get("name", "Unknown"),
            "content": clean_body,
        })

    output = {"count": len(engagements), "engagements": engagements}
    set_cache(cache_key, output, ttl=TOOL_CACHE_TTL)
    return output


# ============================================================================
# 7. HUBSPOT SUPPORT TICKETS TOOL
# ============================================================================
async def hubspot_search_tickets(
    company_id: str,
    security_ctx: Any,
    priority: Optional[str] = None,  # 'HIGH' | 'MEDIUM' | 'LOW'
    stage: Optional[str] = None,
    search_query: Optional[str] = None,
    limit: int = 25,
) -> Dict[str, Any]:
    """Searches customer support tickets with Layer 1 PII scrubbing on ticket contents."""
    sec = _extract_sec(security_ctx)
    cache_key = _get_cache_key(company_id, "search_tickets", locals(), sec["role_level"], sec["user_id"])
    cached = get_cache(cache_key)
    if isinstance(cached, dict):
        return cached

    access_token = await _get_hubspot_token(company_id)
    if not access_token:
        return {"error": "HubSpot CRM not connected."}

    filters = []
    if priority:
        filters.append({"propertyName": "hs_ticket_priority", "operator": "EQ", "value": priority.upper()})
    if stage:
        filters.append({"propertyName": "hs_pipeline_stage", "operator": "EQ", "value": stage})

    payload: Dict[str, Any] = {
        "limit": min(limit, 50),
        "properties": ["subject", "content", "hs_ticket_priority", "hs_pipeline_stage", "createdate", "hubspot_owner_id"],
        "sorts": [{"propertyName": "createdate", "direction": "DESCENDING"}]
    }
    if filters:
        payload["filterGroups"] = [{"filters": filters}]
    if search_query:
        payload["query"] = search_query

    res = await execute_hubspot_api_call("POST", "/crm/v3/objects/tickets/search", access_token, json_data=payload)
    if res.status_code != 200:
        return {"tickets": [], "error": f"Failed to search tickets: {res.text}"}

    owners_map = await _fetch_hubspot_owners(access_token, company_id)
    tickets = []

    for t in res.json().get("results", []):
        props = t.get("properties") or {}
        raw_content = props.get("content") or ""
        clean_content, _ = scrub_hard_pii(raw_content)

        owner_info = owners_map.get(str(props.get("hubspot_owner_id") or ""), {})
        tickets.append({
            "id": t.get("id"),
            "subject": props.get("subject") or "Untitled Ticket",
            "content": clean_content,
            "priority": props.get("hs_ticket_priority"),
            "stage": props.get("hs_pipeline_stage"),
            "createdate": props.get("createdate"),
            "owner": owner_info.get("name", "Unassigned"),
        })

    output = {"total_tickets": len(tickets), "tickets": tickets}
    set_cache(cache_key, output, ttl=TOOL_CACHE_TTL)
    return output


# ============================================================================
# 8. HUBSPOT PIPELINE SUMMARY TOOL (AGGREGATED DASHBOARD)
# ============================================================================
async def hubspot_get_pipeline_summary(
    company_id: str,
    security_ctx: Any,
    pipeline_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Computes aggregated sales pipeline health metrics:
    - Total pipeline value ($)
    - Total deal count
    - Weighted pipeline value (amount * probability)
    - Breakdown by stage (count, sum, avg)
    - Top 5 largest active opportunities
    """
    sec = _extract_sec(security_ctx)
    cache_key = _get_cache_key(company_id, "pipeline_summary", {"pipeline_id": pipeline_id}, sec["role_level"], sec["user_id"])
    cached = get_cache(cache_key)
    if isinstance(cached, dict):
        return cached

    access_token = await _get_hubspot_token(company_id)
    if not access_token:
        return {"error": "HubSpot CRM not connected."}

    # Use search_deals tool under the hood to ensure exact ReBAC scoping
    deals_data = await hubspot_search_deals(
        company_id=company_id,
        security_ctx=security_ctx,
        pipeline=pipeline_id,
        limit=100
    )

    deals = deals_data.get("deals", [])
    total_val = 0.0
    weighted_val = 0.0
    stage_breakdown: Dict[str, Dict[str, Any]] = {}

    for d in deals:
        amt = float(d.get("amount") or 0.0)
        prob = float(d.get("probability") or 0.5) if d.get("probability") is not None else 0.5
        stg = str(d.get("dealstage") or "unspecified")

        total_val += amt
        weighted_val += (amt * prob)

        if stg not in stage_breakdown:
            stage_breakdown[stg] = {"count": 0, "total_value": 0.0, "average_value": 0.0}
        stage_breakdown[stg]["count"] += 1
        stage_breakdown[stg]["total_value"] += amt

    for stg, s_data in stage_breakdown.items():
        if s_data["count"] > 0:
            s_data["average_value"] = round(s_data["total_value"] / s_data["count"], 2)
            s_data["total_value"] = round(s_data["total_value"], 2)

    # Sort top 5 largest deals
    top_deals = sorted(deals, key=lambda x: x.get("amount", 0.0), reverse=True)[:5]

    output = {
        "pipeline_id": pipeline_id or "default",
        "total_active_pipeline_value": round(total_val, 2),
        "weighted_pipeline_value": round(weighted_val, 2),
        "total_deals_count": len(deals),
        "stage_breakdown": stage_breakdown,
        "top_5_deals": [
            {
                "id": td.get("id"),
                "dealname": td.get("dealname"),
                "amount": td.get("amount"),
                "dealstage": td.get("dealstage"),
                "owner_name": td.get("owner_name")
            }
            for td in top_deals
        ],
    }
    set_cache(cache_key, output, ttl=TOOL_CACHE_TTL)
    return output


# Register with FastMCP if installed
if mcp_app is not None:
    mcp_app.tool()(hubspot_search_deals)
    mcp_app.tool()(hubspot_get_deal)
    mcp_app.tool()(hubspot_search_contacts)
    mcp_app.tool()(hubspot_get_contact)
    mcp_app.tool()(hubspot_search_companies)
    mcp_app.tool()(hubspot_list_engagements)
    mcp_app.tool()(hubspot_search_tickets)
    mcp_app.tool()(hubspot_get_pipeline_summary)
