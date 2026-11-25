import path from 'path';
import { expect, test } from '@playwright/test';
import { confirmDialog, localIn, login, section } from './helpers';

const PDF = path.resolve(__dirname, '../fixtures/method-statement.pdf');
let jsaUrl = '';
let ref = '';

test.describe.serial('Primary workflow: contractor → Area Owner → Safety Officer → Approved', () => {
  test('contractor creates, completes and submits a JSA with an attachment', async ({ page }) => {
    await login(page, 'contractor1');
    await page.getByRole('link', { name: 'New JSA' }).first().click();

    // 1. General information
    await page.locator('#jobTitle').fill('E2E: Replace damaged guard rail at filler platform');
    await page.locator('#contactPhone').fill('089-555-0101');
    await page.locator('#supervisorName').fill('Khun Somsak');
    await page.locator('#emergencyContactName').fill('Plant ERT');
    await page.locator('#emergencyContactPhone').fill('1199');
    // Requester identity is fixed from the session
    await expect(page.getByLabel('Requester', { exact: true })).toHaveValue(/Anan Kaewmanee/);

    // 2. Work description & schedule
    await section(page, /Work description/);
    await page.locator('#jobDescription').fill('Cut out damaged guard rail section and weld a new rail on the filler access platform. Line stopped.');
    await page.locator('#areaId').selectOption({ label: 'Bottling Line 1 (Building 1)' });
    await page.locator('#exactLocation').fill('Filler access platform, east side');
    await page.locator('#jobTypeId').selectOption({ label: 'Welding / cutting' });
    await page.locator('#workerCount').fill('2');
    await page.locator('#plannedStart').fill(localIn(24));
    await page.locator('#plannedEnd').fill(localIn(30));

    // Save draft → server generates the reference number
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page).toHaveURL(/\/jsa\/[0-9a-f-]+\/edit/);
    await expect(page.getByText(/JSA-\d{4}-\d{5}/).first()).toBeVisible();
    ref = (await page.getByText(/JSA-\d{4}-\d{5}/).first().textContent())!.match(/JSA-\d{4}-\d{5}/)![0];

    // 3. Permits — Hot Work requires a reference and confirmations
    await section(page, /Permits/);
    await page.locator('label').filter({ hasText: /^Hot Work$/ }).locator('input[type=checkbox]').check();
    await page.locator('input[name$=".referenceNo"]').first().fill('HW-E2E-001');
    for (const cb of await page.locator('input[type=checkbox][name*=".answers."]').all()) await cb.check();

    // 4. Job steps & hazards — two steps, reorder, copy
    await section(page, /Job steps/);
    await page.locator('textarea[name="steps.0.activity"]').fill('Isolate filler platform conveyor and apply LOTO');
    await page.locator('textarea[name="steps.0.hazards.0.hazard"]').fill('Unexpected conveyor start');
    await page.locator('textarea[name="steps.0.hazards.0.consequence"]').fill('Crushing injury');
    await page.locator('textarea[name="steps.0.hazards.0.existingControls"]').fill('LOTO procedure');
    await page.getByRole('button', { name: 'Add step' }).first().click();
    await page.locator('textarea[name="steps.1.activity"]').fill('Cut and weld guard rail');
    await page.locator('textarea[name="steps.1.hazards.0.hazard"]').fill('Sparks near packaging material');
    await page.locator('textarea[name="steps.1.hazards.0.consequence"]').fill('Fire');
    await page.locator('textarea[name="steps.1.hazards.0.existingControls"]').fill('Fire extinguisher at point of work');
    await page.locator('textarea[name="steps.1.hazards.0.additionalControls"]').fill('Fire blankets; fire watch for 30 min after work');
    await page.locator('input[name="steps.1.hazards.0.controlOwner"]').fill('Contractor foreman');
    // reorder: move step 2 up, then back down
    await page.getByRole('button', { name: 'Move up' }).nth(1).click();
    await expect(page.locator('textarea[name="steps.0.activity"]')).toHaveValue('Cut and weld guard rail');
    await page.getByRole('button', { name: 'Move down' }).first().click();
    await expect(page.locator('textarea[name="steps.0.activity"]')).toHaveValue(/Isolate/);

    // 5. Risk assessment
    await section(page, /Risk assessment/);
    for (const i of [0, 1]) {
      await page.locator(`select[name="steps.${i}.hazards.0.initialSeverity"]`).selectOption('4');
      await page.locator(`select[name="steps.${i}.hazards.0.initialLikelihood"]`).selectOption('3');
      await page.locator(`select[name="steps.${i}.hazards.0.residualSeverity"]`).selectOption('4');
      await page.locator(`select[name="steps.${i}.hazards.0.residualLikelihood"]`).selectOption('1');
    }
    await expect(page.getByText('(12)').first()).toBeVisible(); // initial 4×3 previewed
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Draft saved')).toBeVisible();

    // 6. Documents
    await section(page, /Supporting documents/);
    await page.locator('select').filter({ hasText: 'Work area photo' }).selectOption('METHOD_STATEMENT');
    await page.locator('input[type=file]').setInputFiles(PDF);
    await expect(page.getByRole('link', { name: 'method-statement.pdf' })).toBeVisible();

    // 7. Declaration & submit
    await section(page, /Declaration/);
    await expect(page.getByText('All required information is complete.')).not.toBeVisible(); // declaration not yet accepted
    await page.getByText('I have read and accept this declaration').click();
    await expect(page.getByText('All required information is complete.')).toBeVisible();
    await page.getByRole('button', { name: 'Submit for review' }).click();
    await confirmDialog(page, 'Submit for review');
    await expect(page).toHaveURL(/\/jsa\/[0-9a-f-]+$/);
    await expect(page.getByText('Pending Area Owner').first()).toBeVisible();
    jsaUrl = new URL(page.url()).pathname;
  });

  test('requester cannot approve; other contractor cannot see the record', async ({ page }) => {
    await login(page, 'contractor1');
    await page.goto(jsaUrl);
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
    const id = jsaUrl.split('/').pop();
    const inbox = await page.request.get('/api/v1/approvals/inbox');
    expect(inbox.status()).toBe(403);

    await login(page, 'contractor2');
    await page.goto(jsaUrl);
    await expect(page.getByText('Not found or you do not have access.')).toBeVisible();
    const res = await page.request.get(`/api/v1/jsas/${id}`);
    expect(res.status()).toBe(404);
  });

  test('assigned Area Owner reviews and approves from the inbox', async ({ page }) => {
    await login(page, 'areaowner1');
    await page.getByRole('link', { name: 'Approval Inbox' }).click();
    await page.getByText(ref).first().click();
    await expect(page.getByText('You are the assigned reviewer for the Area Owner stage.')).toBeVisible();
    await page.getByRole('tab', { name: /Job steps/ }).click();
    await expect(page.getByText('Sparks near packaging material').first()).toBeVisible();
    await page.getByRole('tab', { name: /Documents/ }).click();
    await expect(page.getByRole('link', { name: 'method-statement.pdf' })).toBeVisible();
    // Return without comment is blocked client-side (and server-side)
    await page.getByRole('button', { name: 'Return for revision' }).click();
    await expect(page.getByText('A comment of at least 5 characters is required.')).toBeVisible();
    await page.getByPlaceholder(/Comments for the requester/).fill('Area will be handed over at 08:00.');
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await confirmDialog(page, 'Approve');
    await expect(page.getByText('Pending Safety Officer').first()).toBeVisible();
  });

  test('Safety Officer verifies permit evidence and gives final approval', async ({ page }) => {
    await login(page, 'safety1');
    await page.goto(jsaUrl);
    // Without permit verification the server refuses final approval
    await page.getByRole('button', { name: 'Final approve' }).click();
    await confirmDialog(page, 'Final approve');
    await expect(page.getByText(/Permit evidence must be verified/).first()).toBeVisible();
    await page.getByText('HW-E2E-001').click(); // tick verification checkbox
    await page.getByRole('button', { name: 'Final approve' }).click();
    await confirmDialog(page, 'Final approve');
    await expect(page.getByText(/Approved — valid for work from/)).toBeVisible();
  });

  test('requester sees approved JSA, prints it and downloads the PDF; history and audit remain', async ({ page }) => {
    await login(page, 'contractor1');
    await page.goto(jsaUrl);
    await expect(page.getByText('Approved').first()).toBeVisible();
    const id = jsaUrl.split('/').pop();
    const pdf = await page.request.get(`/api/v1/jsas/${id}/pdf?lang=th`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
    // print-friendly view
    const print = await page.context().newPage();
    await print.addInitScript(() => { window.print = () => undefined; });
    await print.goto(`${jsaUrl}/print`);
    await expect(print.getByText(ref).first()).toBeVisible();
    await expect(print.getByText('An approved JSA is not a work permit', { exact: false })).toBeVisible();
    await print.close();
    // approval history
    await page.getByRole('tab', { name: 'Approval history' }).click();
    await expect(page.getByText('Pimchanok Wong (Safety Officer)').first()).toBeVisible();
    await expect(page.locator('blockquote').filter({ hasText: 'Area will be handed over at 08:00.' })).toBeVisible();
    // notification arrived
    await page.goto('/notifications');
    await expect(page.getByText(`${ref} approved`).first()).toBeVisible();
    // audit trail (Safety Officer view)
    await login(page, 'safety1');
    const audit = await page.request.get(`/api/v1/audit-logs?entityId=${id}`);
    const body = await audit.json();
    const actions = body.items.map((x: { action: string }) => x.action);
    expect(actions).toEqual(expect.arrayContaining(['JSA_CREATE_DRAFT', 'ATTACHMENT_UPLOAD', 'JSA_SUBMIT', 'REVIEW_APPROVE']));
  });
});

test.describe.serial('Revision path: returned → revised → resubmitted → approved', () => {
  let id = '';
  test('Area Owner returns a JSA for revision', async ({ page }) => {
    await login(page, 'somchai');
    // Create via the authenticated API (same server rules as the UI)
    const csrf = (await (await page.request.get('/api/v1/auth/me')).json()).csrfToken;
    const lk = await (await page.request.get('/api/v1/lookups')).json();
    const area = lk.areas.find((a: { code: string }) => a.code === 'A-BTL2').id;
    const jt = lk.jobTypes.find((a: { code: string }) => a.code === 'MAINT_MECH').id;
    const start = new Date(Date.now() + 26 * 3600_000).toISOString();
    const end = new Date(Date.now() + 30 * 3600_000).toISOString();
    const body = {
      jobTitle: 'E2E revision: replace capper chuck', jobDescription: 'Replace worn capper chuck heads', areaId: area, exactLocation: 'Capper',
      jobTypeId: jt, workerCount: 2, supervisorName: 'Khun Dee', contactPhone: '081', plannedStart: start, plannedEnd: end,
      steps: [{ activity: 'Stop capper and LOTO', hazards: [{ hazard: 'Moving turret', consequence: 'Hand injury', existingControls: 'LOTO', initialSeverity: 4, initialLikelihood: 3, residualSeverity: 4, residualLikelihood: 1 }] }],
    };
    const created = await (await page.request.post('/api/v1/jsas', { data: body, headers: { 'X-CSRF-Token': csrf } })).json();
    id = created.id;
    const sub = await page.request.post(`/api/v1/jsas/${id}/submit`, { data: { declarationAccepted: true, language: 'en' }, headers: { 'X-CSRF-Token': csrf } });
    expect(sub.status()).toBe(200);

    await login(page, 'areaowner1');
    await page.goto(`/jsa/${id}`);
    await page.getByPlaceholder(/Comments for the requester/).fill('Add a step for testing the capper after re-assembly.');
    await page.getByRole('button', { name: 'Return for revision' }).click();
    await confirmDialog(page, 'Return for revision');
    await expect(page.getByText('Returned for Revision').first()).toBeVisible();
  });

  test('requester revises (new version), sees comments and resubmits', async ({ page }) => {
    await login(page, 'somchai');
    await page.goto(`/jsa/${id}`);
    await expect(page.getByText('Add a step for testing the capper after re-assembly.').first()).toBeVisible();
    await page.getByRole('button', { name: 'Create revision' }).click();
    await page.getByRole('dialog').locator('textarea').fill('Added test-run step');
    await page.getByRole('dialog').getByRole('button', { name: 'Create revision' }).click();
    await expect(page).toHaveURL(/\/edit/);
    await expect(page.getByText(/Revision v2/)).toBeVisible();
    await section(page, /Job steps/);
    await page.getByRole('button', { name: 'Add step' }).first().click();
    await page.locator('textarea[name="steps.1.activity"]').fill('Remove LOTO and test-run capper');
    await page.locator('textarea[name="steps.1.hazards.0.hazard"]').fill('Guard left open');
    await page.locator('textarea[name="steps.1.hazards.0.consequence"]').fill('Entanglement');
    await page.locator('textarea[name="steps.1.hazards.0.existingControls"]').fill('Interlocked guards checked before start');
    await section(page, /Risk assessment/);
    await page.locator('select[name="steps.1.hazards.0.initialSeverity"]').selectOption('3');
    await page.locator('select[name="steps.1.hazards.0.initialLikelihood"]').selectOption('2');
    await page.locator('select[name="steps.1.hazards.0.residualSeverity"]').selectOption('3');
    await page.locator('select[name="steps.1.hazards.0.residualLikelihood"]').selectOption('1');
    await section(page, /Declaration/);
    await page.getByText('I have read and accept this declaration').click();
    await page.getByRole('button', { name: 'Submit for review' }).click();
    await confirmDialog(page, 'Submit for review');
    await expect(page.getByText('Pending Area Owner').first()).toBeVisible();
    await expect(page.getByText('Changes vs v1')).toBeVisible();
    await expect(page.getByText(/Steps added: 2/)).toBeVisible();
  });

  test('full re-review sequence completes; v1 and its comments remain available', async ({ page }) => {
    await login(page, 'areaowner1');
    await page.goto(`/jsa/${id}`);
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await confirmDialog(page, 'Approve');
    await expect(page.getByText('Pending Safety Officer').first()).toBeVisible();
    await login(page, 'safety1');
    await page.goto(`/jsa/${id}`);
    await page.getByRole('button', { name: 'Final approve' }).click();
    await confirmDialog(page, 'Final approve');
    await expect(page.getByText(/Approved — valid for work from/)).toBeVisible();
    await page.getByRole('tab', { name: /Versions/ }).click();
    await expect(page.getByRole('link', { name: 'v1' })).toBeVisible();
    await page.getByRole('link', { name: 'v1' }).click();
    await expect(page.getByText('Viewing version 1')).toBeVisible();
    await page.getByRole('tab', { name: 'Approval history' }).click();
    await expect(page.getByRole('blockquote').or(page.locator('blockquote')).filter({ hasText: 'Add a step for testing the capper after re-assembly.' })).toBeVisible();
  });
});
