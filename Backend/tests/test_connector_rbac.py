# Backend/tests/test_connector_rbac.py
"""
RBAC & Multi-Instance Governance Tests for Ingestion Connectors & Sharing API.
"""

import os
import sys
import uuid
from unittest.mock import patch, MagicMock, AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from utils.auth import RequestAuth, get_request_auth_required
from routes.connectors import router as connectors_router
from routes.rbac import router as rbac_router
from routes.coach_upload import router as coach_upload_router


app = FastAPI()
app.include_router(connectors_router)
app.include_router(rbac_router)
app.include_router(coach_upload_router)


COMPANY_ID = str(uuid.uuid4())
EMPLOYEE_ID = str(uuid.uuid4())
MANAGER_A_ID = str(uuid.uuid4())
MANAGER_B_ID = str(uuid.uuid4())
ADMIN_ID = str(uuid.uuid4())


def _make_auth(user_id: str, email: str) -> RequestAuth:
    return RequestAuth(user_id=user_id, company_id=COMPANY_ID, email=email, source="test")


def test_employee_blocked_from_all_connector_and_preflight_endpoints():
    """Users with role < manager (Level 1 Employee) must get 403 on connector & preflight endpoints."""
    app.dependency_overrides[get_request_auth_required] = lambda: _make_auth(EMPLOYEE_ID, "emp@lucid.work")

    async def _deny_manager(uid: str, perm: str):
        return False

    async def _deny_coach_access(uid: str, cid: str, min_role: str = "manager"):
        return False

    with patch("routes.connectors.check_user_permission", side_effect=_deny_manager), \
         patch("routes.connectors._audit_connector_event"), \
         patch("routes.coach_upload.verify_coach_access", side_effect=_deny_coach_access):
        client = TestClient(app)

        assert client.get("/api/connectors/status").status_code == 403
        assert client.get("/api/connectors/slack/status").status_code == 403
        assert client.get("/api/connectors/slack/auth-url").status_code == 403
        assert client.get("/api/connectors/slack/containers").status_code == 403
        assert client.post("/api/connectors/slack/select-container", json={
            "container_id": "C123", "container_name": "sales"
        }).status_code == 403
        assert client.post("/api/connectors/slack/sync-now").status_code == 403
        assert client.post("/api/connectors/slack/disconnect").status_code == 403
        assert client.post("/api/coach/preflight-check", json={"items": []}).status_code == 403

    app.dependency_overrides.clear()


def test_manager_can_init_team_connector_but_not_org_wide():
    """Managers (Level 2) can connect team/personal connectors, but 'org' scope requires Admin+ (Level >= 3)."""
    app.dependency_overrides[get_request_auth_required] = lambda: _make_auth(MANAGER_A_ID, "mgrA@lucid.work")

    async def _manager_only_perm(uid: str, perm: str):
        return perm == "manager"

    mock_connector = MagicMock()
    mock_connector.generate_auth_url.return_value = "https://slack.com/oauth/v2/authorize?state=%7B%7D"

    with patch("routes.connectors.check_user_permission", side_effect=_manager_only_perm), \
         patch("routes.connectors.ConnectorRegistry.get", return_value=mock_connector), \
         patch("routes.connectors.persist_oauth_state", return_value="nonce-1"):
        client = TestClient(app)

        # Manager trying org-wide -> 403
        res_org = client.get("/api/connectors/slack/auth-url?connection_scope=org")
        assert res_org.status_code == 403
        assert "Administrator" in res_org.json()["detail"]

        # Manager connecting team scope -> 200
        res_team = client.get("/api/connectors/slack/auth-url?connection_scope=team")
        assert res_team.status_code == 200
        assert res_team.json()["connection_scope"] == "team"

    # Admin connecting org scope -> 200
    app.dependency_overrides[get_request_auth_required] = lambda: _make_auth(ADMIN_ID, "admin@lucid.work")

    async def _admin_perm(uid: str, perm: str):
        return perm in ("manager", "admin")

    with patch("routes.connectors.check_user_permission", side_effect=_admin_perm), \
         patch("routes.connectors.ConnectorRegistry.get", return_value=mock_connector), \
         patch("routes.connectors.persist_oauth_state", return_value="nonce-2"):
        client = TestClient(app)
        res_admin_org = client.get("/api/connectors/slack/auth-url?connection_scope=org")
        assert res_admin_org.status_code == 200
        assert res_admin_org.json()["connection_scope"] == "org"

    app.dependency_overrides.clear()


def test_manager_cannot_manage_other_managers_connector_instance():
    """Manager A must get 403 when attempting to sync/disconnect/configure Manager B's instance."""
    app.dependency_overrides[get_request_auth_required] = lambda: _make_auth(MANAGER_A_ID, "mgrA@lucid.work")
    integ_b_id = str(uuid.uuid4())

    async def _manager_only_perm(uid: str, perm: str):
        return perm == "manager"

    class _FakeExec:
        def __init__(self, data):
            self.data = data

    class _FakeTable:
        def __init__(self, rows):
            self.rows = list(rows)

        def select(self, *args, **kwargs):
            return self

        def insert(self, *args, **kwargs):
            return self

        def eq(self, col, val):
            self.rows = [r for r in self.rows if str(r.get(col)) == str(val)]
            return self

        def order(self, *args, **kwargs):
            return self

        def limit(self, *args, **kwargs):
            return self

        def execute(self):
            return _FakeExec(self.rows)

    integ_row = {
        "id": integ_b_id,
        "company_id": COMPANY_ID,
        "provider": "google_drive",
        "status": "active",
        "owner_user_id": MANAGER_B_ID,
        "connected_by": MANAGER_B_ID,
        "connection_scope": "team",
    }

    mock_supa = MagicMock()
    mock_supa.table.side_effect = lambda name: _FakeTable([integ_row] if name == "company_integrations" else [])

    with patch("routes.connectors.check_user_permission", side_effect=_manager_only_perm), \
         patch("routes.connectors.supabase_admin", mock_supa):
        client = TestClient(app)
        res_sync = client.post(f"/api/connectors/google_drive/sync-now?integration_id={integ_b_id}")
        assert res_sync.status_code == 403
        assert "their own connected integrations" in res_sync.json()["detail"]

        res_disc = client.post(f"/api/connectors/google_drive/disconnect?integration_id={integ_b_id}")
        assert res_disc.status_code == 403

    app.dependency_overrides.clear()


def test_oauth_callback_rechecks_manager_role_on_completion():
    """Even with a valid OAuth state token, a downgraded user must be rejected at callback time."""
    async def _deny_mgr(uid: str, perm: str):
        return False

    state_record = {
        "company_id": COMPANY_ID,
        "user_id": EMPLOYEE_ID,
        "provider": "slack",
        "extra": {"connection_scope": "team", "visibility_mode": "acl_sync"},
    }

    with patch("routes.connectors.verify_and_consume_oauth_state", return_value=state_record), \
         patch("routes.connectors.check_user_permission", side_effect=_deny_mgr), \
         patch("routes.connectors._audit_connector_event"):
        client = TestClient(app)
        res = client.get("/api/connectors/slack/callback?code=auth-code-1&state=valid-state")
        assert res.status_code == 403
        assert "Manager" in res.text


def test_rbac_container_share_governance_and_company_wide_guard():
    """Managers can share their own containers across teams, but cannot grant company-wide share."""
    app.dependency_overrides[get_request_auth_required] = lambda: _make_auth(MANAGER_A_ID, "mgrA@lucid.work")

    async def _manager_only(uid: str, perm: str):
        return perm == "manager"

    class _FakeExec:
        def __init__(self, data):
            self.data = data

    class _FakeTable:
        def __init__(self, rows):
            self.rows = rows

        def select(self, *args, **kwargs):
            return self

        def eq(self, *args, **kwargs):
            return self

        def in_(self, *args, **kwargs):
            return self

        def maybe_single(self):
            return self

        def execute(self):
            return _FakeExec(self.rows)

    def _table_router(name: str):
        if name == "integration_monitored_sources":
            return _FakeTable([{"integration_id": "integ-a", "company_id": COMPANY_ID}])
        if name == "company_integrations":
            return _FakeTable([{"id": "integ-a", "owner_user_id": MANAGER_A_ID, "connected_by": MANAGER_A_ID}])
        return _FakeTable([])

    mock_supa = MagicMock()
    mock_supa.table.side_effect = _table_router

    with patch("routes.rbac.check_user_permission", side_effect=_manager_only), \
         patch("routes.rbac.supabase_admin", mock_supa), \
         patch("routes.rbac.grant_share", return_value={"status": "granted"}) as mock_grant, \
         patch("routes.rbac._audit_rbac_event"):
        client = TestClient(app)

        # Sharing to company as Manager -> 403
        res_co = client.post("/api/rbac/containers/folder-team-a/share", json={
            "subject_type": "company",
            "subject_id": COMPANY_ID,
            "relation": "viewer",
        })
        assert res_co.status_code == 403

        # Sharing Team A container with Team B -> 200
        res_team_b = client.post("/api/rbac/containers/folder-team-a/share", json={
            "subject_type": "team",
            "subject_id": "team-b-uuid",
            "relation": "viewer",
        })
        assert res_team_b.status_code == 200
        mock_grant.assert_called_once()

    app.dependency_overrides.clear()

