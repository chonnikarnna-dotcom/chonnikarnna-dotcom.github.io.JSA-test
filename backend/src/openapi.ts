/**
 * OpenAPI 3.0 description of the JSA REST API (served at /api/openapi.json and /api/docs).
 * Authentication: session cookie (`jsa_sid`, `__Host-jsa_sid` in production) + `X-CSRF-Token` header on
 * state-changing requests (token returned by POST /auth/login and GET /auth/me).
 */
type Op = { summary: string; tags: string[]; params?: string[]; query?: string[]; body?: Record<string, unknown> | string; roles?: string; responses?: Record<string, string>; binary?: string };

const ref = (n: string) => ({ $ref: `#/components/schemas/${n}` });
function op(o: Op) {
  const parameters = [
    ...(o.params ?? []).map((p) => ({ name: p, in: 'path', required: true, schema: { type: 'string', format: p.endsWith('d') ? 'uuid' : undefined } })),
    ...(o.query ?? []).map((q) => ({ name: q, in: 'query', required: false, schema: { type: 'string' } })),
  ];
  const responses: Record<string, unknown> = {};
  for (const [code, desc] of Object.entries(o.responses ?? { 200: 'OK' })) responses[code] = { description: desc, ...(o.binary && code.startsWith('2') ? { content: { [o.binary]: { schema: { type: 'string', format: 'binary' } } } } : {}) };
  responses['400'] = { description: 'Validation error', content: { 'application/json': { schema: ref('Error') } } };
  responses['401'] = { description: 'Not authenticated', content: { 'application/json': { schema: ref('Error') } } };
  responses['403'] = { description: 'Forbidden (role, record-level or CSRF)', content: { 'application/json': { schema: ref('Error') } } };
  return {
    summary: o.summary, tags: o.tags, description: o.roles ? `Roles: ${o.roles}` : undefined,
    parameters: parameters.length ? parameters : undefined,
    requestBody: o.body ? (typeof o.body === 'string'
      ? { required: true, content: { [o.body]: { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' }, category: { type: 'string' } } } } } }
      : { required: true, content: { 'application/json': { schema: o.body } } }) : undefined,
    responses,
  };
}

const jsaFilters = ['page', 'pageSize', 'sort', 'order', 'q', 'scope', 'status', 'riskLevel', 'areaId', 'siteId', 'departmentId', 'contractorCompanyId', 'jobTypeId', 'requesterId', 'reviewerId', 'from', 'to', 'highRiskOnly'];
const review = { type: 'object', required: ['versionId'], properties: { versionId: { type: 'string', format: 'uuid' }, comment: { type: 'string' }, verifiedPermitRefIds: { type: 'array', items: { type: 'string', format: 'uuid' } } } };
const crudPaths = (base: string, tag: string) => ({
  [base]: { get: op({ summary: `List ${tag}`, tags: ['Administration'], roles: 'ADMIN' }), post: op({ summary: `Create ${tag}`, tags: ['Administration'], roles: 'ADMIN', body: { type: 'object' }, responses: { 201: 'Created' } }) },
  [`${base}/{id}`]: { put: op({ summary: `Update ${tag}`, tags: ['Administration'], roles: 'ADMIN', params: ['id'], body: { type: 'object' } }) },
});

export const openapi = {
  openapi: '3.0.3',
  info: { title: 'JSA Submission & Approval API', version: '1.0.0', description: 'Versioned REST API. All timestamps are ISO-8601 UTC. Errors use a consistent `{ error: { code, message, details, requestId } }` envelope; `code` is a stable identifier translated by the UI.' },
  servers: [{ url: '/api/v1' }],
  components: {
    securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'jsa_sid' }, csrf: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' } },
    schemas: {
      Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {}, requestId: { type: 'string' } } } } },
      Hazard: { type: 'object', properties: { hazard: { type: 'string' }, consequence: { type: 'string' }, hazardMasterId: { type: 'string', nullable: true }, initialSeverity: { type: 'integer' }, initialLikelihood: { type: 'integer' }, existingControls: { type: 'string' }, additionalControls: { type: 'string' }, controlOwner: { type: 'string' }, residualSeverity: { type: 'integer' }, residualLikelihood: { type: 'integer' } } },
      Step: { type: 'object', properties: { activity: { type: 'string' }, hazards: { type: 'array', items: ref('Hazard') } } },
      Permit: { type: 'object', properties: { permitTypeId: { type: 'string', format: 'uuid' }, referenceNo: { type: 'string' }, answers: { type: 'object' }, attachmentId: { type: 'string', format: 'uuid' }, notes: { type: 'string' } } },
      DraftInput: {
        type: 'object', description: 'Draft content. Requester identity, contractor company and risk scores are always set by the server.',
        properties: {
          jobTitle: { type: 'string' }, jobDescription: { type: 'string' }, departmentId: { type: 'string' }, contactPhone: { type: 'string' }, contactEmail: { type: 'string' },
          areaId: { type: 'string' }, exactLocation: { type: 'string' }, plannedStart: { type: 'string', format: 'date-time' }, plannedEnd: { type: 'string', format: 'date-time' },
          workerCount: { type: 'integer' }, supervisorName: { type: 'string' }, supervisorPhone: { type: 'string' }, jobTypeId: { type: 'string' },
          emergencyContactName: { type: 'string' }, emergencyContactPhone: { type: 'string' }, ppeRequired: { type: 'array', items: { type: 'string' } },
          additionalRequirements: { type: 'string' }, steps: { type: 'array', items: ref('Step') }, permits: { type: 'array', items: ref('Permit') },
          expectedRowVersion: { type: 'integer', description: 'Optimistic concurrency token (PUT only)' },
        },
      },
    },
  },
  security: [{ session: [], csrf: [] }],
  paths: {
    '/auth/login': { post: op({ summary: 'Log in (email or username)', tags: ['Authentication'], body: { type: 'object', required: ['identifier', 'password'], properties: { identifier: { type: 'string' }, password: { type: 'string' } } }, responses: { 200: 'Session created; returns user and csrfToken', 401: 'Invalid credentials', 423: 'Locked', 429: 'Rate limited' } }) },
    '/auth/logout': { post: op({ summary: 'Log out', tags: ['Authentication'], responses: { 204: 'Logged out' } }) },
    '/auth/me': { get: op({ summary: 'Current user and CSRF token', tags: ['Authentication'] }) },
    '/auth/me/preferences': { patch: op({ summary: 'Update language preference', tags: ['Authentication'], body: { type: 'object', properties: { preferredLanguage: { type: 'string', enum: ['th', 'en'] } } } }) },
    '/auth/change-password': { post: op({ summary: 'Change password', tags: ['Authentication'], body: { type: 'object' } }) },
    '/auth/forgot-password': { post: op({ summary: 'Request password reset (always 202)', tags: ['Authentication'], body: { type: 'object', properties: { identifier: { type: 'string' } } }, responses: { 202: 'Accepted' } }) },
    '/auth/reset-password': { post: op({ summary: 'Reset password with token', tags: ['Authentication'], body: { type: 'object', properties: { token: { type: 'string' }, newPassword: { type: 'string' } } } }) },
    '/auth/invitations/{token}': { get: op({ summary: 'Inspect invitation', tags: ['Authentication'], params: ['token'] }) },
    '/auth/activate': { post: op({ summary: 'Activate invited account (set password)', tags: ['Authentication'], body: { type: 'object', properties: { token: { type: 'string' }, newPassword: { type: 'string' } } } }) },
    '/lookups/public': { get: op({ summary: 'Public settings (default language)', tags: ['Reference data'] }) },
    '/lookups': { get: op({ summary: 'Reference data for forms (areas, job types, permit types, active risk matrix, settings)', tags: ['Reference data'] }) },
    '/jsas': {
      get: op({ summary: 'Search authorized JSAs (register / my submissions)', tags: ['JSA'], query: jsaFilters }),
      post: op({ summary: 'Create draft (reference number generated server-side)', tags: ['JSA'], roles: 'REQUESTER', body: ref('DraftInput'), responses: { 201: 'Created' } }),
    },
    '/jsas/export': { get: op({ summary: 'Export authorized register rows', tags: ['JSA'], query: [...jsaFilters, 'format', 'lang'], binary: 'application/octet-stream' }) },
    '/jsas/{id}': {
      get: op({ summary: 'JSA detail (content, versions, attachments, history, permitted actions)', tags: ['JSA'], params: ['id'], query: ['version'] }),
      put: op({ summary: 'Update current draft/revision', tags: ['JSA'], params: ['id'], body: ref('DraftInput'), responses: { 200: 'Saved', 409: 'Not editable / stale' } }),
      delete: op({ summary: 'Delete never-submitted draft (soft delete)', tags: ['JSA'], params: ['id'], responses: { 204: 'Deleted' } }),
    },
    '/jsas/{id}/submit': { post: op({ summary: 'Submit for review (validates, locks version, routes to Area Owner)', tags: ['JSA'], params: ['id'], body: { type: 'object', required: ['declarationAccepted'], properties: { declarationAccepted: { type: 'boolean', enum: [true] }, language: { type: 'string', enum: ['th', 'en'] }, expectedRowVersion: { type: 'integer' } } }, responses: { 200: 'Submitted', 422: 'Validation failed (field errors in details)' } }) },
    '/jsas/{id}/revisions': { post: op({ summary: 'Create revision (returned or approved JSA)', tags: ['JSA'], params: ['id'], body: { type: 'object', properties: { reason: { type: 'string' } } }, responses: { 201: 'Created' } }) },
    '/jsas/{id}/revisions/current': { delete: op({ summary: 'Discard unsubmitted revision', tags: ['JSA'], params: ['id'], responses: { 204: 'Discarded' } }) },
    '/jsas/{id}/cancel': { post: op({ summary: 'Cancel (requester, reason required)', tags: ['JSA'], params: ['id'], body: { type: 'object', properties: { reason: { type: 'string' } } } }) },
    '/jsas/{id}/complete': { post: op({ summary: 'Confirm work completion', tags: ['JSA'], params: ['id'], body: { type: 'object', properties: { note: { type: 'string' } } } }) },
    '/jsas/{id}/copy': { post: op({ summary: 'Copy as new draft (template)', tags: ['JSA'], params: ['id'], responses: { 201: 'Created' } }) },
    '/jsas/{id}/attachments': { post: op({ summary: 'Upload attachment (pdf, jpg, png, docx, xlsx; content-sniffed)', tags: ['Documents'], params: ['id'], body: 'multipart/form-data', responses: { 201: 'Uploaded', 413: 'Too large', 422: 'Type not allowed' } }) },
    '/jsas/{id}/pdf': { get: op({ summary: 'PDF of the approved version (Thai/English)', tags: ['JSA'], params: ['id'], query: ['lang', 'download'], binary: 'application/pdf' }) },
    '/attachments/{id}/download': { get: op({ summary: 'Download authorized attachment', tags: ['Documents'], params: ['id'], query: ['inline'], binary: 'application/octet-stream', responses: { 200: 'File', 404: 'Not found or not authorized' } }) },
    '/attachments/{id}': { delete: op({ summary: 'Remove attachment from current draft', tags: ['Documents'], params: ['id'], responses: { 204: 'Removed' } }) },
    '/approvals/inbox': { get: op({ summary: 'Pending approval tasks for current reviewer', tags: ['Approvals'], roles: 'AREA_OWNER, SAFETY_OFFICER' }) },
    '/approvals/tasks/{taskId}/approve': { post: op({ summary: 'Approve current stage', tags: ['Approvals'], params: ['taskId'], body: review, responses: { 200: 'Approved', 409: 'Stale / already completed', 422: 'Prerequisites failed' } }) },
    '/approvals/tasks/{taskId}/return': { post: op({ summary: 'Return for revision (comment required)', tags: ['Approvals'], params: ['taskId'], body: review }) },
    '/approvals/tasks/{taskId}/reject': { post: op({ summary: 'Reject (comment required)', tags: ['Approvals'], params: ['taskId'], body: review }) },
    '/approvals/history/{jsaId}': { get: op({ summary: 'Approval and status history', tags: ['Approvals'], params: ['jsaId'] }) },
    '/notifications': { get: op({ summary: 'In-app notifications', tags: ['Notifications'], query: ['unreadOnly', 'limit', 'offset', 'lang'] }) },
    '/notifications/read': { post: op({ summary: 'Mark notifications read', tags: ['Notifications'], body: { type: 'object', properties: { ids: { oneOf: [{ type: 'string', enum: ['ALL'] }, { type: 'array', items: { type: 'string' } }] } } } }) },
    '/reports/dashboard': { get: op({ summary: 'Role-scoped dashboard figures', tags: ['Reports'] }) },
    '/reports/summary': { get: op({ summary: 'Reports for a date range', tags: ['Reports'], query: ['from', 'to'] }) },
    '/reports/export': { get: op({ summary: 'Export a report', tags: ['Reports'], query: ['type', 'format', 'from', 'to', 'lang'], binary: 'application/octet-stream' }) },
    '/audit-logs': { get: op({ summary: 'Audit log (Admin: all; Safety Officer: JSA events)', tags: ['Audit'], query: ['entityType', 'entityId', 'action', 'actorId', 'result', 'from', 'to', 'page', 'pageSize'] }) },
    '/audit-logs/verify': { get: op({ summary: 'Verify audit hash chain', tags: ['Audit'], roles: 'ADMIN' }) },
    '/admin/users': { get: op({ summary: 'List users', tags: ['Administration'], roles: 'ADMIN', query: ['q', 'role', 'active'] }), post: op({ summary: 'Create user (password or invitation link)', tags: ['Administration'], roles: 'ADMIN', body: { type: 'object' }, responses: { 201: 'Created; activationLink when invited' } }) },
    '/admin/users/{id}': { put: op({ summary: 'Update user, roles, activation', tags: ['Administration'], roles: 'ADMIN', params: ['id'], body: { type: 'object' } }) },
    '/admin/users/{id}/invitation': { post: op({ summary: 'Issue invitation / password-reset link', tags: ['Administration'], roles: 'ADMIN', params: ['id'] }) },
    '/admin/roles': { get: op({ summary: 'Roles and permission catalogue', tags: ['Administration'], roles: 'ADMIN' }) },
    ...crudPaths('/admin/departments', 'departments'),
    ...crudPaths('/admin/contractor-companies', 'contractor companies'),
    ...crudPaths('/admin/sites', 'factory sites'),
    ...crudPaths('/admin/areas', 'factory areas'),
    ...crudPaths('/admin/job-types', 'job types'),
    ...crudPaths('/admin/hazards', 'hazard library'),
    ...crudPaths('/admin/controls', 'control measure library'),
    ...crudPaths('/admin/permit-types', 'high-risk activity / permit types'),
    '/admin/area-owners': { get: op({ summary: 'Area Owner assignments', tags: ['Administration'] }), post: op({ summary: 'Assign Area Owner (primary/backup)', tags: ['Administration'], body: { type: 'object' } }) },
    '/admin/area-owners/{id}': { put: op({ summary: 'Update assignment', tags: ['Administration'], params: ['id'], body: { type: 'object' } }) },
    '/admin/safety-officers': { get: op({ summary: 'Safety Officer assignments', tags: ['Administration'] }), post: op({ summary: 'Assign Safety Officer (site or all sites)', tags: ['Administration'], body: { type: 'object' } }) },
    '/admin/safety-officers/{id}': { put: op({ summary: 'Update assignment', tags: ['Administration'], params: ['id'], body: { type: 'object' } }) },
    '/admin/risk-matrices': { get: op({ summary: 'Risk matrix versions', tags: ['Administration'] }) },
    '/admin/risk-matrices/{id}': { put: op({ summary: 'Edit draft matrix (labels, levels, acceptance rule)', tags: ['Administration'], params: ['id'], body: { type: 'object' } }) },
    '/admin/risk-matrices/{id}/clone': { post: op({ summary: 'Clone into new draft version', tags: ['Administration'], params: ['id'] }) },
    '/admin/risk-matrices/{id}/validate': { post: op({ summary: 'Record Safety Administrator validation', tags: ['Administration'], params: ['id'] }) },
    '/admin/risk-matrices/{id}/activate': { post: op({ summary: 'Activate draft (retires current)', tags: ['Administration'], params: ['id'] }) },
    '/admin/validity': { get: op({ summary: 'JSA validity settings', tags: ['Administration'] }), put: op({ summary: 'Update validity settings', tags: ['Administration'], body: { type: 'object' } }) },
    '/admin/settings': { get: op({ summary: 'System settings', tags: ['Administration'] }), put: op({ summary: 'Update system settings', tags: ['Administration'], body: { type: 'object' } }) },
    '/admin/notification-templates': { get: op({ summary: 'Notification templates (TH/EN)', tags: ['Administration'] }) },
    '/admin/notification-templates/{id}': { put: op({ summary: 'Update template', tags: ['Administration'], params: ['id'], body: { type: 'object' } }) },
    '/admin/workflow': { get: op({ summary: 'Approval workflow definition (read-only)', tags: ['Administration'] }) },
    '/admin/jobs/expiry': { post: op({ summary: 'Run expiry job now', tags: ['Administration'] }) },
  },
};
