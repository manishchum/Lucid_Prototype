# Developer Role Multi-Tenant Implementation Roadmap

## 1. Objective
Implement a developer role experience that can:
- Select any company from a global selector.
- Persist selected company across all pages in the app.
- Scope all data views and actions to the selected company.
- Preserve strict role-based access and prevent non-developer cross-tenant access.

## 2. Current State (Validated)
- Backend permission model already supports `developer` at highest level.
- Company access helper already allows developer cross-company access.
- Company list API exists and is super-admin level, which developer can satisfy via level hierarchy.
- Frontend currently uses the logged-in user's `company_id` directly in many pages and API calls.
- No global frontend tenant context currently exists for selected company.
- Navigation shell exists and is the best anchor point for global selector rendering.

## 3. Target State
- New UX: company selector visible on welcome page and global navigation for developer users.
- New app-wide state: selected company (`activeCompanyId`) as a single source of truth.
- Data fetches for developer users use `activeCompanyId` instead of profile company.
- Non-developer users continue using their own company only.

## 4. Architecture Decisions
- Keep backend authorization checks as source of truth (never trust frontend role checks alone).
- Introduce frontend tenant context provider mounted at app root.
- Persist selected company in `localStorage` with authenticated-user scoping key.
- For API requests, pass selected company using a consistent approach:
  - Preferred: path/query already requiring company ID.
  - Additionally include `X-Company-ID` header for uniform middleware support.
- Add defensive backend validation for all routes where company can be user-provided.

## 5. Phased Implementation Plan

## Phase 0: Contract and Safety
1. Define selected company contract:
   - `activeCompanyId: string | null`
   - `setActiveCompanyId(companyId: string)`
   - `availableCompanies: Company[]`
   - `isDeveloperMode: boolean`
2. Confirm role normalization for `developer` in frontend role checks.
3. Confirm backend role checks for company-wide routes accept developer path.

Deliverable:
- Signed-off technical contract for tenant selection and fallback behavior.

## Phase 1: Backend Hardening (Minimal, High Impact)
1. Add/verify reusable resolver helper:
   - Resolve effective company from request context.
   - If requester is developer and `X-Company-ID` exists, use it.
   - Else use requester's own company.
2. Add this helper to high-traffic routes first:
   - Users listing by company.
   - Training modules by company.
   - Assessments and progress endpoints.
3. Add audit logs for developer cross-company operations:
   - user_id, selected_company_id, endpoint, timestamp.

Deliverable:
- Backend supports explicit company override for developer safely.

## Phase 2: Frontend Global Tenant Context
1. Add `TenantContext` in root app provider chain.
2. Initialize context from:
   - Auth user and role metadata.
   - Last selected company from local storage.
   - Fallback to profile company if not developer.
3. Add a small hook API:
   - `useTenant()` returning state + setter + guards.
4. Add cache invalidation on company switch:
   - Clear tenant-scoped cache keys.
   - Trigger lightweight data re-fetch events.

Deliverable:
- Application has one reliable cross-page selected-company state.

## Phase 3: Company Selector UI (Welcome + Global)
1. Add company selector component on welcome page.
2. Add same selector to global navigation/header for persistent access.
3. Visibility rules:
   - Show only for developer role.
   - Optional read-only company badge for non-developer users.
4. UX details:
   - Searchable dropdown.
   - Last selection restored.
   - Skeleton/loading state while company list loads.
   - Error state with retry.

Deliverable:
- Developer can switch company from welcome and any page.

## Phase 4: Data Layer Migration
1. Refactor API call builders to consume `activeCompanyId`.
2. Replace direct `employeeData.company_id` dependencies in targeted pages.
3. Migrate in slices:
   - Console pages.
   - KPI pages.
   - Employee reporting surfaces where applicable.
4. Ensure every call that is tenant-sensitive receives the effective company.

Deliverable:
- Primary business pages reflect selected company consistently.

## Phase 5: Role UX and Guardrails
1. Add explicit `isDeveloper` boolean in auth context.
2. Route guard behavior:
   - Developer can access existing admin/super-admin views only as intended by policy.
   - Non-developer cannot force company switch.
3. Add banner for developer mode:
   - "Viewing as Company: <name>"

Deliverable:
- Clear and safe UX for privileged developer mode.

## Phase 6: QA, Security, and Rollout
1. Test matrix by role:
   - user, admin, super_admin, developer.
2. Validate tenant isolation:
   - Non-developer cannot fetch other company data even with forged headers.
3. E2E flows:
   - Login as developer -> switch company -> navigate multiple pages -> data remains scoped.
4. Feature-flag release:
   - Enable developer company selector in staged rollout.

Deliverable:
- Production-safe release with rollback path.

## 6. Acceptance Criteria
- Developer sees company selector on welcome page and global navigation.
- Company selection persists across page transitions and refresh.
- At least all critical console/KPI/training views use selected company context.
- Non-developer roles remain restricted to their own company.
- Security tests pass for header/query tampering.

## 7. Risks and Mitigations
- Risk: stale cached data after company switch.
  - Mitigation: tenant-aware cache keys + explicit invalidation.
- Risk: inconsistent behavior across legacy pages.
  - Mitigation: phased migration checklist with coverage tracking.
- Risk: accidental privilege expansion.
  - Mitigation: backend role checks remain mandatory on every route.

## 8. Effort Estimate
- Phase 0-2: 2 to 3 days
- Phase 3-4: 3 to 5 days
- Phase 5-6: 2 to 3 days
- Total: approximately 1.5 to 2 weeks including QA and staged rollout.

## 9. Suggested Execution Order (Immediate)
1. Build frontend tenant context and company selector shell.
2. Wire welcome page selector.
3. Wire navigation selector for all pages.
4. Migrate top-priority data pages to active company.
5. Complete backend hardening and E2E validation.

## 10. Implementation Notes For This Codebase
- Role model and developer level already exist in backend permission utilities.
- Company routes and role routes are already present; leverage existing APIs before adding new endpoints.
- Navigation wrapper and auth context are the right insertion points for global tenant state.
