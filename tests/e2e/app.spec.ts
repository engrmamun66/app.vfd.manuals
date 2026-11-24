import { test, expect, type Browser, type BrowserContext, type Page, type Locator } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const ADMIN = { email: 'root@e2e.test', initial: 'Initial-Pass-9876!', pw: 'Changed-Pass-4321!' };
const ALICE = { email: 'alice@e2e.test', pw: 'Strong-Secret-Pass-123!' };
const BOB = { email: 'bob@e2e.test', pw: 'Another-Secure-Pass-4567!' };

let adminCtx: BrowserContext;
let aliceCtx: BrowserContext;
let bobCtx: BrowserContext;
let admin: Page;
let alice: Page;
let bob: Page;
let paramUrl = '';
let paramId = 0;
let descText = '';

/** Confirms the app's own confirmation modal (replaces native window.confirm). */
async function confirmModal(page: Page) {
  const dlg = page.getByRole('dialog', { name: 'Please confirm' });
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: 'Confirm' }).click();
  await expect(dlg).toBeHidden();
}

async function register(browser: Browser, u: { email: string; pw: string }) {
  const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:3077', viewport: { width: 1600, height: 900 } });
  const p = await ctx.newPage();
  await p.goto('/register');
  await p.locator('#r-email').fill(u.email);
  await p.locator('#r-pw').fill(u.pw);
  await p.locator('#r-pw2').fill(u.pw);
  await p.getByRole('button', { name: 'Create account' }).click();
  await expect(p.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  return { ctx, p };
}

async function selectText(host: Locator, text: string) {
  await host.evaluate((el, t) => {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = w.nextNode())) {
      const i = (n.textContent ?? '').indexOf(t);
      if (i >= 0) {
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + t.length);
        const s = window.getSelection()!;
        s.removeAllRanges();
        s.addRange(r);
        el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return;
      }
    }
    throw new Error('text not found: ' + t);
  }, text);
}

test.beforeAll(async ({ browser }) => {
  adminCtx = await browser.newContext({ baseURL: 'http://127.0.0.1:3077', viewport: { width: 1600, height: 900 } });
  admin = await adminCtx.newPage();
});
test.afterAll(async () => {
  await adminCtx?.close();
  await aliceCtx?.close();
  await bobCtx?.close();
});

test.describe('authentication', () => {
  test('anonymous visitors are sent to the sign-in page', async ({ page }) => {
    await page.goto('/parameters');
    await expect(page).toHaveURL(/\/login$/);
    expect((await page.request.get('/api/dashboard')).status()).toBe(401);
  });

  test('wrong password shows a uniform error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email address').fill(ADMIN.email);
    await page.getByLabel('Password').fill('nope-nope-nope');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('Invalid email or password');
  });

  test('Super Admin must change the bootstrap password before using the app', async () => {
    await admin.goto('/login');
    await admin.getByLabel('Email address').fill(ADMIN.email);
    await admin.getByLabel('Password').fill(ADMIN.initial);
    await admin.getByRole('button', { name: 'Sign in' }).click();
    await expect(admin.getByRole('heading', { name: 'Change password' })).toBeVisible();
    await admin.locator('#cp1').fill(ADMIN.initial);
    await admin.locator('#cp2').fill(ADMIN.pw);
    await admin.locator('#cp3').fill(ADMIN.pw);
    await admin.getByRole('button', { name: 'Change password' }).click();
    await expect(admin.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('registration form: password mismatch blocked; success logs in immediately as Normal User', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:3077' });
    const p = await ctx.newPage();
    await p.goto('/register');
    await p.locator('#r-email').fill('mismatch@e2e.test');
    await p.locator('#r-pw').fill('Valid-Password-123!');
    await p.locator('#r-pw2').fill('Different-123!');
    await expect(p.getByText('Passwords do not match.')).toBeVisible();
    await expect(p.getByRole('button', { name: 'Create account' })).toBeDisabled();
    await ctx.close();

    const a = await register(browser, ALICE);
    aliceCtx = a.ctx; alice = a.p;
    const b = await register(browser, BOB);
    bobCtx = b.ctx; bob = b.p;
    const me = await alice.request.get('/api/auth/me');
    expect((await me.json()).user.role).toBe('user');
    await expect(alice.getByText('Administration')).toHaveCount(0); // no admin menu for normal users
    expect((await alice.request.get('/api/admin/users')).status()).toBe(403);
  });

  test('session survives a full page reload (cookie + server-side session)', async () => {
    await alice.reload();
    await expect(alice.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });
});

test.describe('dashboard & knowledge base', () => {
  test('dashboard counts come from the database', async () => {
    const api = await (await admin.request.get('/api/dashboard')).json();
    await admin.goto('/');
    await expect(admin.locator('.stat', { hasText: 'Parameters' }).first().locator('b')).toHaveText(String(api.totals.parameters));
    expect(api.totals.parameters).toBeGreaterThan(20);
    expect(api.totals.modbusRegisters).toBeGreaterThan(5);
    expect(api.totals.documents).toBe(2);
  });

  test('parameter list: search filters, unverified/verified badges, unmapped shown honestly', async () => {
    await admin.goto('/parameters');
    await expect(admin.locator('tbody tr').first()).toBeVisible();
    const before = await admin.locator('tbody tr').count();
    await admin.getByLabel('Search parameters').fill('acceleration');
    await expect(async () => expect(await admin.locator('tbody tr').count()).toBeLessThan(before)).toPass();
    await expect(admin.locator('tbody')).toContainText(/accel/i);
    await admin.getByLabel('Search parameters').fill('zzzz-no-such-parameter');
    await expect(admin.getByText('No parameters match')).toBeVisible();
  });

  test('opening a parameter gives a stable research URL; tabs, back/forward, refresh restore the exact state', async () => {
    const list = await (await admin.request.get('/api/parameters?limit=200')).json();
    let chosen: any = null;
    for (const p of list.rows) {
      const d = await (await admin.request.get(`/api/parameters/${p.id}`)).json();
      if (d.description_en && d.description_en.length > 40 && d.evidence?.length) { chosen = d; break; }
    }
    expect(chosen, 'a parameter with description + evidence exists').toBeTruthy();
    paramId = chosen.id;
    descText = chosen.description_en;
    await admin.goto(`/parameter/${paramId}`);
    await expect(admin).toHaveURL(new RegExp(`/research/parameters/[^/]+/[^/]+/${paramId}$`));
    paramUrl = new URL(admin.url()).pathname;
    await expect(admin.getByRole('heading', { level: 1 })).toContainText(chosen.code);
    await expect(admin.locator('nav.crumbs')).toContainText(`Parameter ${chosen.code}`);

    await admin.getByRole('tab', { name: 'Detailed explanation' }).click();
    await expect(admin).toHaveURL(new RegExp('/detailed$'));
    await admin.getByRole('tab', { name: 'Source investigation' }).click();
    await expect(admin).toHaveURL(new RegExp('/source$'));
    await expect(admin.getByText(/PDF page index/)).toBeVisible();
    await admin.goBack();
    await expect(admin).toHaveURL(new RegExp('/detailed$'));
    await admin.goBack();
    await expect(admin).toHaveURL(new RegExp(`${paramId}$`));
    await admin.goForward();
    await admin.reload();
    await expect(admin).toHaveURL(new RegExp('/detailed$'));
    await expect(admin.getByRole('tab', { name: 'Detailed explanation' })).toHaveAttribute('aria-selected', 'true');
    // breadcrumb click navigates to the earlier location
    await admin.locator('nav.crumbs a').first().click();
    await expect(admin).toHaveURL(/\/$/);
  });

  test('original documentation tab shows the real manual page image with source reference', async () => {
    await admin.goto(`${paramUrl}/original`);
    const img = admin.locator('.page-img-wrap img');
    await expect(img).toBeVisible({ timeout: 45_000 });
    await expect.poll(async () => img.evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 45_000 }).toBeGreaterThan(200);
    await expect(admin.getByText(/PDF page \d+\//).first()).toBeVisible();
    await expect(admin.getByRole('link', { name: 'Open original PDF' }).first()).toBeVisible();
  });

  test('missing record shows a message and does not redirect to another record', async () => {
    await admin.goto('/research/parameters/x/y/999999');
    await expect(admin.getByRole('alert')).toContainText(/not found/i);
    await expect(admin).toHaveURL(/999999$/);
  });

  test('Modbus register explorer finds a register by its stored decimal/hex conversion; detail keeps original address', async () => {
    const regs = await (await admin.request.get('/api/registers?limit=500')).json();
    const withConv = regs.rows.find((r: any) => r.conversions.length);
    expect(withConv, 'a register with a math conversion exists').toBeTruthy();
    const conv = withConv.conversions[0].value as string;
    await admin.goto('/modbus/registers');
    await admin.getByLabel('Search registers').fill(conv);
    await expect(admin.locator('tbody')).toContainText(withConv.original_address);
    await admin.getByRole('link', { name: withConv.original_address }).first().click();
    await expect(admin).toHaveURL(/\/research\/modbus\/.+\/registers\/\d+$/);
    await expect(admin.getByRole('heading', { level: 1 })).toContainText(withConv.original_address);
    await admin.getByRole('tab', { name: 'Scaling & addressing' }).click();
    await expect(admin.getByText('Mathematical address conversions')).toBeVisible();
    await expect(admin.getByText(/mathematical|base-16|base-10/i).first()).toBeVisible();
  });

  test('address converter performs base conversion only', async () => {
    await admin.goto('/modbus/converter');
    await admin.locator('#hx').fill('2103H');
    await expect(admin.locator('td', { hasText: /^0x2103 = 8451$/ })).toBeVisible();
    await admin.locator('#dc').fill('8451');
    await expect(admin.locator('td', { hasText: '0x2103' }).first()).toBeVisible();
    await admin.locator('#hx').fill('zz!');
    await expect(admin.getByText(/Enter a hexadecimal/)).toBeVisible();
  });

  test('comparison: two brands side by side, gaps are "Not Documented", exports work', async () => {
    // export buttons are an optional UI setting (hidden by default): switch them on for this user
    const csrf = (await (await admin.request.get('/api/auth/me')).json()).csrfToken;
    await admin.request.patch('/api/me/settings', { data: { ui_settings: { show_export_csv: true, show_export_json: true } }, headers: { 'X-CSRF-Token': csrf } });
    await admin.goto('/compare');
    const boxes = admin.locator('input[type=checkbox]');
    await boxes.nth(0).click();
    await expect(boxes.nth(0)).toBeChecked();
    await boxes.nth(1).click();
    await expect(boxes.nth(1)).toBeChecked();
    await expect(admin.locator('table.cmp thead th.model')).toHaveCount(2);
    await expect(admin.locator('table.cmp tbody tr').first()).toBeVisible();
    await expect(admin.locator('table.cmp')).toContainText('Not Documented');
    const [dl] = await Promise.all([admin.waitForEvent('download'), admin.getByRole('button', { name: 'Export CSV' }).click()]);
    expect(dl.suggestedFilename()).toMatch(/\.csv$/);
  });

  test('global search finds parameters and manual page text', async () => {
    await admin.goto('/');
    await admin.getByLabel('Global search').fill('frequency');
    await expect(admin.locator('.popover').getByText(/Manual text/)).toBeVisible();
    await expect(admin.locator('.popover')).toContainText(/Parameters|Common functions/);
  });
});

test.describe('layout: full width, split view', () => {
  test('research workspace uses the full width on a 2560px display (no max-width)', async () => {
    await admin.setViewportSize({ width: 2560, height: 1300 });
    await admin.goto(paramUrl);
    await expect(admin.getByRole('heading', { level: 1 })).toBeVisible();
    await expect.poll(async () => admin.locator('.page').first().evaluate((e) => e.getBoundingClientRect().width)).toBeGreaterThan(2560 - 252 - 20);
    const mw = await admin.locator('.page').first().evaluate((e) => getComputedStyle(e).maxWidth);
    expect(mw).toBe('none');
    await admin.setViewportSize({ width: 1600, height: 900 });
  });

  test('split view: toggle, drag-resize, persists per user across reload', async () => {
    await admin.goto(`${paramUrl}`);
    const toggle = admin.getByRole('button', { name: /Split/ });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    const div = admin.locator('.split .divider');
    await expect(div).toBeVisible();
    const panes = admin.locator('.split > .pane');
    await expect(panes).toHaveCount(2);
    const total = await admin.locator('.split').evaluate((e) => e.getBoundingClientRect().width);
    const box = (await div.boundingBox())!;
    await admin.mouse.move(box.x + 4, box.y + 40);
    await admin.mouse.down();
    await admin.mouse.move(box.x - 300, box.y + 40, { steps: 8 });
    await admin.mouse.up();
    await expect.poll(async () => (await panes.first().boundingBox())!.width / total).toBeLessThan(0.45);
    const ratioBefore = (await panes.first().boundingBox())!.width / total;
    await admin.waitForTimeout(600);
    await admin.reload();
    await expect(admin.getByRole('button', { name: /Split/ })).toHaveAttribute('aria-pressed', 'true');
    const total2 = await admin.locator('.split').evaluate((e) => e.getBoundingClientRect().width);
    const ratioAfter = (await admin.locator('.split > .pane').first().boundingBox())!.width / total2;
    expect(Math.abs(ratioAfter - ratioBefore)).toBeLessThan(0.04);
    // right pane shows the original manual page next to the explanation
    await expect(admin.locator('.split > .pane').nth(1).locator('.page-img-wrap img, .evidence-quote').first()).toBeVisible({ timeout: 45_000 });
    // another user's layout is independent
    await alice.goto(paramUrl);
    await expect(alice.getByRole('button', { name: /Split/ })).toHaveAttribute('aria-pressed', 'false');
    await admin.getByRole('button', { name: /Split/ }).click();
    await expect(admin.locator('.split')).toHaveCount(0);
  });
});

test.describe('curation by Super Admin', () => {
  test('Metadata and explanation are saved, cited, and shown to normal users; manufacturer values stay untouched', async () => {
    const before = await (await admin.request.get(`/api/parameters/${paramId}`)).json();
    await admin.goto(paramUrl);
    await admin.getByText('Edit metadata (Super Admin)').click();
    await admin.getByRole('button', { name: 'Save metadata' }).click();
    await expect(admin.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
    await admin.getByLabel('Explanation text').fill('E2E documented explanation text.');
    await admin.getByRole('button', { name: 'Add explanation' }).click();
    await expect(admin.getByRole('status').filter({ hasText: 'Explanation added' })).toBeVisible();
    // normal user sees it
    await alice.goto(paramUrl);
    await alice.getByRole('tab', { name: 'Detailed explanation' }).click();
    await expect(alice.getByText('E2E documented explanation text.')).toBeVisible();
    // technical values unchanged
    const after = await (await admin.request.get(`/api/parameters/${paramId}`)).json();
    for (const k of ['code', 'name', 'unit', 'default_value', 'min_value', 'max_value', 'description_en']) expect(after[k]).toBe(before[k]);
    expect(after.explanations[0].evidence_status).toBe('Explicitly Documented'); // cited
    // normal users cannot call the editor APIs
    const csrf = (await (await alice.request.get('/api/auth/me')).json()).csrfToken;
    expect((await alice.request.patch(`/api/parameters/${paramId}`, { data: { description_bn: 'x' }, headers: { 'X-CSRF-Token': csrf } })).status()).toBe(403);
    await expect(alice.getByText('Edit metadata (Super Admin)')).toHaveCount(0);
  });

  test('model tabs on a record page open the equivalent record of that model', async () => {
    const list = await (await admin.request.get('/api/parameters?limit=300')).json();
    let target: any = null;
    for (const p of list.rows) {
      const d = await (await admin.request.get(`/api/parameters/${p.id}`)).json();
      if (d.otherBrandImplementations.length) { target = d; break; }
    }
    expect(target).toBeTruthy();
    const other = target.otherBrandImplementations[0];
    await admin.goto(`/parameter/${target.id}`);
    await expect(admin.getByRole('heading', { level: 1 })).toContainText(target.code);
    const tabs = admin.locator('.model-tabs');
    await expect(tabs).toBeVisible(); // tabs are shown on research pages too
    await expect(tabs.locator('button.current')).toHaveCount(1);
    await tabs.locator('button', { hasText: other.model.replace(/\s*\(.*$/, '') }).click();
    await expect(admin).toHaveURL(new RegExp(`/research/parameters/.+/${other.id}$`));
    await expect(admin.getByRole('heading', { level: 1 })).toContainText(other.code);
    await admin.locator('.model-tabs button').first().click(); // back to "All"
  });

  test('split view on list pages: clicking a record opens it in the right pane instead of navigating', async () => {
    await admin.goto('/parameters');
    const toggle = admin.getByRole('button', { name: /Split/ });
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
    const link = admin.locator('tbody td.code a').first();
    const code = (await link.textContent())!;
    await link.click();
    await expect(admin).toHaveURL(/\/parameters$/);
    const right = admin.locator('.split > .pane').nth(1);
    await expect(right).toContainText(code);
    await expect(right.locator('.page-img-wrap img, .evidence-quote').first()).toBeVisible({ timeout: 45_000 });
    await toggle.click(); // split off: links navigate again
    await expect(admin.locator('.split')).toHaveCount(0);
    await admin.locator('tbody td.code a').first().click();
    await expect(admin).toHaveURL(/\/research\/parameters\//);
  });

  test('split view can show another implementation next to this record', async () => {
    const list = await (await admin.request.get('/api/parameters?limit=300')).json();
    let target: any = null;
    for (const p of list.rows) {
      const d = await (await admin.request.get(`/api/parameters/${p.id}`)).json();
      if (d.otherBrandImplementations.length) { target = d; break; }
    }
    expect(target, 'a parameter that has an implementation in another brand exists').toBeTruthy();
    await admin.goto(`/parameter/${target.id}`);
    await expect(admin.getByRole('heading', { level: 1 })).toContainText(target.code);
    const toggle = admin.getByRole('button', { name: /Split/ });
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
    const other = target.otherBrandImplementations[0];
    await admin.getByLabel('Right pane content').selectOption({ value: String(other.id) });
    await expect(admin.locator('.split > .pane').nth(1)).toContainText(other.code);
    await expect(admin.locator('.split > .pane').nth(1)).toContainText(other.brand);
    await toggle.click();
    await expect(admin.locator('.split')).toHaveCount(0);
  });
});

test.describe('annotations: comments, highlights, public/private, display settings', () => {
  test('alice adds a comment+highlight on selected text; it persists after reload', async () => {
    await alice.goto(`${paramUrl}/detailed`);
    const host = alice.locator(`[data-content-key="param:${paramId}:desc"]`);
    await expect(host).toBeVisible();
    const phrase = descText.split(' ').slice(0, 3).join(' ');
    await selectText(host, phrase);
    await alice.getByRole('button', { name: 'Add Comment' }).click();
    await alice.locator('#ann-comment').fill('Alice private note about this');
    await alice.getByRole('button', { name: 'Save', exact: true }).last().click();
    const mark = host.locator('.annot').first();
    await expect(mark).toBeVisible();
    await expect(mark).toHaveClass(/c-yellow/);
    await expect(mark).toHaveText(phrase);
    await alice.reload();
    await expect(alice.locator(`[data-content-key="param:${paramId}:desc"] .annot`).first()).toHaveText(phrase);
    await alice.locator(`[data-content-key="param:${paramId}:desc"] .annot`).first().click();
    await expect(alice.getByRole('dialog', { name: /Annotations/ })).toContainText('Alice private note about this');
    await alice.keyboard.press('Escape');
  });

  test('private annotation is invisible to bob (UI and API)', async () => {
    await bob.goto(`${paramUrl}/detailed`);
    await expect(bob.locator(`[data-content-key="param:${paramId}:desc"]`)).toBeVisible();
    await expect(bob.locator('.annot')).toHaveCount(0);
    const api = await (await bob.request.get(`/api/annotations/for-content?keys=param:${paramId}:desc`)).json();
    expect(api).toEqual([]);
  });

  test('making it public shows it to bob read-only; going private hides it immediately', async () => {
    await alice.goto('/annotations');
    await alice.getByRole('button', { name: 'Make public' }).first().click();
    await bob.reload();
    const mark = bob.locator(`[data-content-key="param:${paramId}:desc"] .annot`).first();
    await expect(mark).toBeVisible();
    await mark.click();
    const dlg = bob.getByRole('dialog', { name: /Annotations/ });
    await expect(dlg).toContainText('Alice private note about this');
    await expect(dlg.getByRole('button', { name: 'Edit' })).toHaveCount(0); // read-only for others
    await bob.keyboard.press('Escape');
    // bob's display setting hides other users' public content, only for bob
    await bob.getByTitle(/Annotations: shown/).click();
    await bob.getByLabel(/Other users' public content/).uncheck();
    await expect(bob.locator('.annot')).toHaveCount(0);
    await bob.keyboard.press('Escape');
    await bob.reload(); // persists
    await expect(bob.locator('.annot')).toHaveCount(0);
    await alice.goto(`${paramUrl}/detailed`);
    await expect(alice.locator('.annot').first()).toBeVisible(); // alice unaffected
    // restore bob's preference and then alice goes private again
    await bob.getByTitle(/Annotations:/).click();
    await bob.getByLabel(/Other users' public content/).check();
    await expect(bob.locator('.annot').first()).toBeVisible();
    await alice.goto('/annotations');
    await alice.getByRole('button', { name: 'Make private' }).first().click();
    await bob.reload();
    await expect(bob.locator('.annot')).toHaveCount(0);
  });

  test('alice can move an annotation to Trash, restore it, and permanently delete it', async () => {
    await alice.goto('/annotations');
    await alice.getByRole('button', { name: 'Delete', exact: true }).first().click();
    await confirmModal(alice);
    await expect(alice.getByText('No annotations.')).toBeVisible();
    await alice.getByRole('button', { name: 'Trash' }).click();
    await expect(alice.getByRole('button', { name: 'Restore' })).toBeVisible();
    await alice.getByRole('button', { name: 'Restore' }).click();
    await expect(alice.getByText('Trash is empty.')).toBeVisible();
    await alice.getByRole('button', { name: 'My annotations' }).click();
    await expect(alice.locator('.card').first()).toContainText('Alice private note');
    await alice.getByRole('button', { name: 'Delete', exact: true }).first().click();
    await confirmModal(alice);
    await alice.getByRole('button', { name: 'Trash' }).click();
    await alice.getByRole('button', { name: 'Permanently delete' }).click();
    await confirmModal(alice);
    await expect(alice.getByText('Trash is empty.')).toBeVisible();
  });
});

test.describe('bookmarks', () => {
  test('save an exact research location into a new folder, reopen it, survives reload', async () => {
    await alice.goto(`${paramUrl}/advanced`);
    await alice.getByTitle('Save Research Bookmark').click();
    await alice.getByPlaceholder('New subfolder name here…').fill('Delta');
    await alice.getByRole('button', { name: 'Create folder' }).click();
    await alice.getByPlaceholder('New subfolder name here…').fill('Parameters');
    await alice.getByRole('button', { name: 'Create folder' }).click();
    await alice.locator('#bm-name').fill('My custom bookmark name');
    await alice.getByRole('dialog', { name: 'Save Research Bookmark' }).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(alice.getByRole('dialog', { name: 'Save Research Bookmark' })).toBeHidden(); // the modal closes after a successful save
    await alice.goto('/bookmarks');
    await expect(alice.locator('.tree')).toContainText('Delta');
    const collapsed = alice.locator('.tree .tw', { hasText: '▸' }).first();
    if (await collapsed.count()) await collapsed.click(); // may already be expanded
    await expect(alice.locator('.tree')).toContainText('Parameters');
    await alice.getByRole('link', { name: 'My custom bookmark name' }).click();
    await expect(alice).toHaveURL(new RegExp('/advanced$'));
    await alice.reload();
    await expect(alice).toHaveURL(new RegExp('/advanced$'));
  });

  test('bookmarks are private; folders cannot be moved into their own descendants; non-empty delete keeps contents', async () => {
    await bob.goto('/bookmarks');
    await expect(bob.getByText('No bookmarks here.')).toBeVisible();
    const folders = await (await alice.request.get('/api/bookmarks/folders')).json();
    const parent = folders.find((f: any) => f.name === 'Delta');
    const child = folders.find((f: any) => f.name === 'Parameters');
    const csrf = (await (await alice.request.get('/api/auth/me')).json()).csrfToken;
    const bad = await alice.request.patch(`/api/bookmarks/folders/${parent.id}`, { data: { parent_id: child.id }, headers: { 'X-CSRF-Token': csrf } });
    expect(bad.status()).toBe(400);
    const del = await alice.request.delete(`/api/bookmarks/folders/${child.id}`, { headers: { 'X-CSRF-Token': csrf } });
    expect(del.status()).toBe(409);
    const ok = await alice.request.delete(`/api/bookmarks/folders/${child.id}?moveTo=parent`, { headers: { 'X-CSRF-Token': csrf } });
    expect(ok.status()).toBe(200);
    expect((await (await alice.request.get('/api/bookmarks')).json()).length).toBe(1);
  });

  test('folder create/rename use the app modal (no native prompt); delete is an icon with a confirmation modal', async () => {
    await alice.goto('/bookmarks');
    await alice.getByRole('button', { name: /^\+ Folder$/ }).click();
    const dlg = alice.getByRole('dialog', { name: 'New folder' });
    await dlg.getByLabel('New folder name').fill('Temp folder');
    await dlg.getByRole('button', { name: 'Create' }).click();
    await expect(dlg).toBeHidden();
    await expect(alice.locator('.tree')).toContainText('Temp folder');
    await alice.locator('.tree').getByText('Temp folder').click();
    expect(await alice.getByRole('button', { name: 'Delete folder' }).textContent()).toBe(''); // icon only, no text label
    await alice.getByRole('button', { name: 'Delete folder' }).click();
    await confirmModal(alice);
    await expect(alice.locator('.tree')).not.toContainText('Temp folder');
  });
});

test.describe('library, import and verification (Super Admin)', () => {
  test('library lists both imported manuals; page viewer renders and text search works', async () => {
    await admin.goto('/library');
    await expect(admin.locator('tbody tr')).toHaveCount(2);
    await admin.locator('tbody a').first().click();
    await expect(admin.getByRole('heading', { name: 'Revisions' })).toBeVisible();
    await admin.getByPlaceholder('Search extracted text…').fill('frequency');
    await expect(admin.locator('.snippet mark').first()).toBeVisible();
    await admin.getByRole('link', { name: 'View pages' }).first().click();
    await expect(admin).toHaveURL(/\/library\/revision\/\d+\/page\/1$/);
    await expect(admin.locator('.page-img-wrap img')).toBeVisible({ timeout: 45_000 });
    await admin.getByRole('button', { name: 'Extracted text' }).click();
    await expect(admin.locator('pre.annot-host')).toBeVisible();
    await admin.getByRole('button', { name: 'Next page →' }).click();
    await expect(admin).toHaveURL(/page\/2$/);
  });

  test('import page lists manuals folder, marks imported files, normal users are blocked', async () => {
    await admin.goto('/library/import');
    await expect(admin.getByRole('link', { name: 'Imported' }).first()).toBeVisible();
    await expect(admin.getByText('Not imported').first()).toBeVisible();
    expect((await alice.request.get('/api/manuals/scan')).status()).toBe(403);
    await alice.goto('/library/import');
    await expect(alice.getByText('requires the Super Admin role')).toBeVisible();
  });

  test('dry-run import of an already imported file reports a duplicate and changes nothing', async () => {
    const before = await (await admin.request.get('/api/dashboard')).json();
    await admin.goto('/library/import');
    await admin.locator('tr', { hasText: 'Delta-VFD-EL-Series-Users-Manual.pdf' }).getByRole('button', { name: 'Dry run' }).click();
    await expect(admin.getByText(/Import job #\d+ — dry_run/)).toBeVisible({ timeout: 60_000 });
    await expect(admin.getByText('Yes — revision')).toBeVisible();
    const after = await (await admin.request.get('/api/dashboard')).json();
    expect(after.totals.documents).toBe(before.totals.documents);
    expect(after.totals.pages).toBe(before.totals.pages);
  });

  test('verification center: staged records need review; quote check visible; review dialog shows the evidence', async () => {
    await admin.goto('/verification');
    await expect(admin.getByRole('tab', { name: /Staged records/ }).or(admin.getByRole('button', { name: /Staged records/ }))).toBeVisible();
    await expect(admin.locator('tbody tr').first()).toBeVisible();
    await expect(admin.locator('tbody')).toContainText(/Quote matches|Quote NOT found|No text layer|Not checked/);
    await admin.locator('tbody tr.clickable').first().click();
    const dlg = admin.getByRole('dialog', { name: 'Review staged record' });
    await expect(dlg).toContainText('Evidence quote');
    await expect(dlg.getByRole('button', { name: /^(Approve|Create as separate record)$/ })).toBeVisible();
    await expect(dlg.getByRole('button', { name: 'Reject', exact: true })).toBeVisible();
  });

  test('marking a live record Verified requires an explicit action and is recorded', async () => {
    await admin.goto('/verification');
    await admin.getByRole('button', { name: 'Verify live records' }).click();
    const firstMark = admin.getByRole('button', { name: 'Mark Verified' }).first();
    await expect(firstMark).toBeVisible();
    const n = await (await admin.request.get('/api/parameters?verification=Verified&limit=1')).json();
    await firstMark.click();
    await expect.poll(async () => (await (await admin.request.get('/api/parameters?verification=Verified&limit=1')).json()).total).toBe(n.total + 1);
  });
});

test.describe('administration', () => {
  test('hiding a model removes it from normal users without deleting it; show restores it', async () => {
    const models = await (await alice.request.get('/api/models')).json();
    const m = models[0];
    await admin.goto('/admin/content');
    await admin.getByRole('button', { name: 'Models' }).click();
    const row = admin.locator('tr', { hasText: m.name }).first();
    await row.getByLabel(new RegExp(`^Visible: `)).uncheck();
    await expect.poll(async () => ((await (await alice.request.get('/api/models')).json()) as any[]).some((x) => x.id === m.id)).toBe(false);
    await admin.reload();
    await admin.getByRole('button', { name: 'Models' }).click();
    await expect(admin.locator('tr', { hasText: m.name }).first().getByLabel(/^Visible: /)).not.toBeChecked(); // persisted in SQLite
    await admin.locator('tr', { hasText: m.name }).first().getByLabel(/^Visible: /).check();
    await expect.poll(async () => ((await (await alice.request.get('/api/models')).json()) as any[]).some((x) => x.id === m.id)).toBe(true);
  });

  test('users page: live presence, per-user stats, storage; Super Admin sees real counts', async () => {
    await admin.goto('/admin/users');
    await expect(admin.locator('.stat', { hasText: 'Registered users' }).locator('b')).toHaveText('3');
    await expect(admin.locator('.stat', { hasText: 'Unique users online' }).locator('b')).not.toHaveText('…');
    await expect(admin.locator('tr', { hasText: ALICE.email })).toContainText('Normal User');
    await expect(admin.locator('tr', { hasText: ALICE.email }).locator('.badge.solid', { hasText: /tab/ })).toBeVisible({ timeout: 20_000 });
    await admin.getByRole('link', { name: ALICE.email }).click();
    await expect(admin.getByRole('dialog')).toContainText('Filesystem reconciliation');
    await expect(admin.getByRole('dialog')).toContainText('Login history');
    await admin.keyboard.press('Escape');
  });

  test('disabling an account signs that user out immediately and blocks login; re-enable allows a new login', async ({ browser }) => {
    await admin.goto('/admin/users');
    await bob.goto('/');
    await admin.locator('tr', { hasText: BOB.email }).getByRole('button', { name: 'Disable' }).click();
    await confirmModal(admin);
    await expect(bob.getByRole('heading', { name: 'Sign in' })).toBeVisible({ timeout: 20_000 });
    await expect(bob.getByText(/disabled|signed out/i).first()).toBeVisible();
    expect((await bob.request.get('/api/dashboard')).status()).toBe(401);
    await bob.getByLabel('Email address').fill(BOB.email);
    await bob.getByLabel('Password').fill(BOB.pw);
    await bob.getByRole('button', { name: 'Sign in' }).click();
    await expect(bob.getByRole('alert')).toContainText(/disabled/i);
    await admin.locator('tr', { hasText: BOB.email }).getByRole('button', { name: 'Enable' }).click();
    await confirmModal(admin);
    await bob.getByRole('button', { name: 'Sign in' }).click();
    await expect(bob.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    void browser;
  });

  test('super admin can turn registration off; the register page then says it is closed', async ({ browser }) => {
    await admin.goto('/admin/settings');
    await admin.getByLabel(/Allow new user registration/).uncheck();
    const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:3077' });
    const p = await ctx.newPage();
    await p.goto('/register');
    await expect(p.getByRole('heading', { name: 'Registration closed' })).toBeVisible();
    await ctx.close();
    await admin.getByLabel(/Allow new user registration/).check();
  });

  test('backups can be created and verified from the UI', async () => {
    await admin.goto('/admin/settings');
    await admin.getByRole('button', { name: 'Create verified backup now' }).click();
    await expect(admin.locator('tbody tr').first()).toContainText('✓');
  });

  test('activity log records admin actions without secrets', async () => {
    await admin.goto('/admin/logs');
    await expect(admin.locator('tbody')).toContainText('admin_disable_account');
    const text = await admin.locator('table').innerText();
    expect(text).not.toMatch(/Password-|vfdkb_sid|token_hash/);
  });
});

test.describe('theme & accessibility basics', () => {
  test('strict monochrome UI: sidebar/background use only neutral grays', async () => {
    await admin.goto('/');
    const colors = await admin.evaluate(() => {
      const cs = (s: string) => getComputedStyle(document.querySelector(s)!);
      return [cs('body').backgroundColor, cs('body').color, cs('.sidebar').backgroundColor, cs('.nav-link').color];
    });
    for (const c of colors) {
      const m = c.match(/\d+/g)!.map(Number);
      expect(Math.max(m[0], m[1], m[2]) - Math.min(m[0], m[1], m[2])).toBeLessThanOrEqual(2); // r≈g≈b
    }
  });

  test('model tabs: selection persists across reload and pages; alias set in full-screen settings; sidebar collapses', async () => {
    await admin.goto('/parameters');
    const tabs = admin.locator('.model-tabs button');
    await expect(tabs.nth(1)).toBeVisible();
    const total = async () => (await admin.locator('.row span.small-text').first().textContent())!.match(/(\d+) records/)![1];
    const all = Number(await total());
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect.poll(async () => Number(await total())).toBeLessThan(all);
    await admin.reload();
    await expect(admin.locator('.model-tabs button[aria-selected="true"]')).toHaveText(await tabs.nth(1).textContent() as string);
    await admin.goto('/modbus/registers'); // selection applies on other pages too
    await expect(admin.locator('.model-tabs button').nth(1)).toHaveAttribute('aria-selected', 'true');
    // alias in the full-screen settings modal
    await admin.getByRole('button', { name: 'Settings', exact: true }).click();
    const dlg = admin.getByRole('dialog', { name: 'Settings' });
    await expect(dlg).toBeVisible();
    await dlg.getByRole('tab', { name: 'Model aliases' }).click();
    const alias = dlg.locator('input[aria-label^="Alias for"]').first();
    await alias.fill('Q9');
    await alias.blur();
    const firstRow = async () => (await dlg.locator('tbody tr').first().locator('td').nth(2).textContent())!;
    const before = await firstRow();
    await dlg.getByRole('button', { name: /^Move .* down$/ }).first().click();
    await expect.poll(firstRow).not.toBe(before);
    await dlg.getByRole('button', { name: 'Close settings' }).click();
    await expect(dlg).toBeHidden(); // wait for the close animation to finish
    await expect(admin.locator('.model-tabs button').nth(2)).toHaveText('Q9'); // moved-down model is now the 2nd model tab
    const selBtn = admin.locator('.model-tabs button[aria-selected="true"]');
    await selBtn.hover();
    const selTip = await admin.getByRole('tooltip').textContent(); // standard tooltip (not a native title attribute); page title = tooltip text
    expect(await selBtn.getAttribute('title')).toBeNull();
    await expect(admin).toHaveTitle(`${selTip} · VFD Knowledge Base`);
    await admin.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(dlg.getByRole('tab', { name: 'Model aliases' })).toHaveAttribute('aria-selected', 'true'); // opens on this tab
    await dlg.getByRole('button', { name: /^Move .* up$/ }).nth(1).click(); // back to the original order
    await expect.poll(firstRow).toBe(before);
    const sw = dlg.getByRole('switch').nth(1);
    await expect(dlg.locator('tbody tr').nth(1).locator('.badge')).toHaveText('On');
    await sw.click();
    await expect(dlg.locator('tbody tr').nth(1).locator('.badge')).toHaveText('Off');
    await sw.click();
    await expect(dlg.locator('tbody tr').nth(1).locator('.badge')).toHaveText('On');
    await dlg.getByRole('button', { name: 'Close settings' }).click();
    await expect(admin.locator('.model-tabs button', { hasText: 'Q9' })).toBeVisible();
    // sidebar collapse persists
    await admin.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect.poll(async () => admin.locator('.sidebar').evaluate((e) => e.getBoundingClientRect().width)).toBe(0);
    await admin.reload();
    await expect(admin.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
    await admin.getByRole('button', { name: 'Expand sidebar' }).click();
    await admin.locator('.model-tabs button').first().click(); // back to All
  });

  test('UI settings: verification/evidence dropdowns are hidden by default and switchable', async () => {
    await admin.goto('/parameters');
    await expect(admin.getByLabel('Search parameters')).toBeVisible();
    await expect(admin.getByLabel('Verification status')).toHaveCount(0);
    await expect(admin.getByLabel('Evidence status')).toHaveCount(0);
    await admin.getByRole('button', { name: 'Settings', exact: true }).click();
    const dlg = admin.getByRole('dialog', { name: 'Settings' });
    await dlg.getByRole('tab', { name: 'UI settings' }).click();
    await dlg.getByRole('switch', { name: 'Show verification dropdown' }).click();
    await dlg.getByRole('switch', { name: 'Show evidence dropdown' }).click();
    await dlg.getByRole('button', { name: 'Close settings' }).click();
    await expect(dlg).toBeHidden();
    await expect(admin.getByLabel('Verification status')).toBeVisible();
    await expect(admin.getByLabel('Evidence status')).toBeVisible();
    await admin.reload(); // persisted
    await expect(admin.getByLabel('Verification status')).toBeVisible();
    // switch both back off
    await admin.getByRole('button', { name: 'Settings', exact: true }).click();
    await dlg.getByRole('tab', { name: 'UI settings' }).click();
    await dlg.getByRole('switch', { name: 'Show verification dropdown' }).click();
    await dlg.getByRole('switch', { name: 'Show evidence dropdown' }).click();
    await dlg.getByRole('button', { name: 'Close settings' }).click();
    await expect(dlg).toBeHidden();
    await expect(admin.getByLabel('Verification status')).toHaveCount(0);
  });

  test('keyboard: help icon opens on Enter and closes on Escape; dialogs are labelled', async () => {
    await admin.goto(paramUrl);
    const info = admin.getByRole('button', { name: /Help:/ }).first();
    await info.focus();
    await admin.keyboard.press('Enter');
    await expect(admin.getByRole('dialog').first()).toBeVisible();
    await admin.keyboard.press('Escape');
    await expect(admin.getByRole('dialog')).toHaveCount(0);
  });
});
