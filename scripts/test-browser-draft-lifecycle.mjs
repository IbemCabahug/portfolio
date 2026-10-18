// scripts/test-browser-draft-lifecycle.mjs
// Stage C: Comprehensive Browser Draft Lifecycle & Storage Leakage Verification
// Exercises real UI against disposable isolated build dist/client.
// Network isolated: Edge launched with host-rules blocking external traffic and page interception.

import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { EDGE } from './browser-path.mjs';
import { createDistServer } from './serve-dist.mjs';
import { buildRoot, inspectPersistentStorage } from './security-browser-helpers.mjs';

const ISOLATED_ROOT = buildRoot;
const syntheticToken = 'SYNTHETIC_TURNSTILE_TOKEN_20261018_REV3';
const submittedPayloads = [];

let missiveResponseStatus = 200;
let missiveResponseBody = { success: true, delivered: true, message: 'Simulated delivery success' };

let passed = 0;
let total = 0;

async function runStep(name, fn) {
  total++;
  console.log(`\n--- [TEST ${total}] ${name} ---`);
  try {
    await fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (err) {
    console.error(`  FAIL: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function openRavenComposer(page) {
  const isHidden = await page.$eval('#dialog-raven', (el) => el.hidden || el.getAttribute('aria-hidden') === 'true').catch(() => true);
  if (isHidden) {
    await page.evaluate(() => document.getElementById('trigger-perch-raven')?.click());
    await page.waitForSelector('#dialog-raven:not([hidden])', { timeout: 5000 });
  }
  // If receipt view was showing from a previous submission, ensure composer view is active without clearing draft
  await page.evaluate(() => {
    const composerView = document.getElementById('raven-composer-view');
    const receiptView = document.getElementById('raven-receipt-view');
    if (composerView && receiptView && !receiptView.classList.contains('hidden')) {
      receiptView.classList.add('hidden');
      composerView.classList.remove('hidden');
    }
  });
  await page.waitForSelector('#raven-composer-view:not(.hidden)', { timeout: 5000 });
}

async function closeRavenComposer(page) {
  await page.evaluate(() => {
    const btn = document.querySelector('#dialog-raven .panel-close-icon-btn');
    if (btn) btn.click();
  });
  await page.waitForFunction(() => {
    const dialog = document.getElementById('dialog-raven');
    return !dialog || dialog.hidden || dialog.getAttribute('aria-hidden') === 'true';
  }, { timeout: 5000 });
  await page.waitForFunction(() => window.location.pathname.replace(/\/$/, '') === '/messenger', { timeout: 5000 }).catch(() => {});
}

async function setFormFields(page, { name = '', email = '', subject = '', body = '' }) {
  await page.evaluate(({ name, email, subject, body }) => {
    const nameEl = document.getElementById('desktop-sender-name');
    const emailEl = document.getElementById('desktop-sender-email');
    const subjectEl = document.getElementById('desktop-missive-subject');
    const bodyEl = document.getElementById('desktop-missive-body');
    if (nameEl) { nameEl.value = name; nameEl.dispatchEvent(new Event('input', { bubbles: true })); }
    if (emailEl) { emailEl.value = email; emailEl.dispatchEvent(new Event('input', { bubbles: true })); }
    if (subjectEl) { subjectEl.value = subject; subjectEl.dispatchEvent(new Event('input', { bubbles: true })); }
    if (bodyEl) { bodyEl.value = body; bodyEl.dispatchEvent(new Event('input', { bubbles: true })); }
  }, { name, email, subject, body });
}

console.log('=== Stage C: Browser Draft Lifecycle & Storage Isolation Test Suite ===\n');

const server = await createDistServer({ root: ISOLATED_ROOT, port: 0, quiet: true });
console.log(`Disposable test server listening at: ${server.origin}`);

const unexpectedRequests = [];
let browser;

try {
  browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: true,
    args: [
      '--host-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
      '--disable-background-networking',
      '--disable-default-apps',
      '--disable-sync',
      '--no-default-browser-check',
    ],
  });

  const page = await browser.newPage();
  page.setDefaultNavigationTimeout(120_000);
  const pageErrors = [];
  page.on('pageerror', (err) => {
    console.log(`  [Page Error] ${err.message}`);
    pageErrors.push(err.message);
  });
  page.on('console', (msg) => {
    const text = msg.text();
    if (!text.includes('[PWA]') && !text.includes('Download the React DevTools')) {
      console.log(`  [Browser Console] ${msg.type()}: ${text}`);
    }
  });

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (url.startsWith(server.origin)) {
      if (url.includes('/api/missive')) {
        submittedPayloads.push(JSON.parse(req.postData() || '{}'));
        console.log(`  [Intercepted /api/missive] Responding ${missiveResponseStatus}`);
        return void req.respond({
          status: missiveResponseStatus,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(missiveResponseBody),
        });
      }
      return void req.continue();
    }
    // Record and abort any cross-origin/external requests
    unexpectedRequests.push(url);
    void req.abort();
  });

  // Test 1: Enter synthetic draft -> close -> navigate -> return -> correct restoration
  await runStep('1. Synthetic draft entered on /messenger/raven is restored after route transition', async () => {
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${server.origin}/messenger/raven`, { waitUntil: 'networkidle0' });
    await openRavenComposer(page);

    // Set synthetic draft
    await setFormFields(page, {
      name: 'Ser Davos',
      email: 'davos@gmail.com',
      subject: 'Delivery of Onion Missive',
      body: 'The fleet has arrived at the cove.',
    });

    // Close modal via close button (triggers navigate('/messenger', { history: 'replace' }))
    await closeRavenComposer(page);
    await page.waitForFunction(() => window.location.pathname.replace(/\/$/, '') === '/messenger', { timeout: 5000 });
    assert.ok(page.url().replace(/\/$/, '').endsWith('/messenger'), 'URL replaced to /messenger');

    // Reopen composer via hotspot trigger on /messenger
    await openRavenComposer(page);

    // Assert restored values
    const restoredName = await page.$eval('#desktop-sender-name', (el) => el.value);
    const restoredEmail = await page.$eval('#desktop-sender-email', (el) => el.value);
    const restoredSubject = await page.$eval('#desktop-missive-subject', (el) => el.value);
    const restoredBody = await page.$eval('#desktop-missive-body', (el) => el.value);

    assert.equal(restoredName, 'Ser Davos');
    assert.equal(restoredEmail, 'davos@gmail.com');
    assert.equal(restoredSubject, 'Delivery of Onion Missive');
    assert.equal(restoredBody, 'The fleet has arrived at the cove.');
    // Exercise a real client-side page swap, not only modal close/reopen.
    await closeRavenComposer(page);
    await page.evaluate(() => {
      const link = document.createElement('a');
      link.href = '/tavern'; document.body.append(link); link.click();
    });
    await page.waitForFunction(() => location.pathname.replace(/\/$/, '') === '/tavern');
    await page.evaluate(() => {
      const link = document.createElement('a');
      link.href = '/messenger/raven'; document.body.append(link); link.click();
    });
    await page.waitForFunction(() => location.pathname.replace(/\/$/, '') === '/messenger/raven');
    await openRavenComposer(page);
    assert.equal(await page.$eval('#desktop-missive-body', el => el.value), 'The fleet has arrived at the cove.');
  });

  // Test 2: Empty all fields -> close -> reopen -> old content does not return
  await runStep('2. Clearing all fields and navigating away does NOT restore old draft content', async () => {
    await openRavenComposer(page);

    // Clear all inputs
    await setFormFields(page, { name: '', email: '', subject: '', body: '' });

    // Close modal (snapshotting empty draft)
    await closeRavenComposer(page);

    // Reopen composer via hotspot trigger
    await openRavenComposer(page);

    // Assert fields are completely empty (or reset to clean template state)
    const nameVal = await page.$eval('#desktop-sender-name', (el) => el.value);
    const emailVal = await page.$eval('#desktop-sender-email', (el) => el.value);
    const bodyVal = await page.$eval('#desktop-missive-body', (el) => el.value);

    assert.equal(nameVal, '', 'Name must remain empty');
    assert.equal(emailVal, '', 'Email must remain empty');
    assert.equal(bodyVal, '', 'Body must remain empty');
  });

  // Test 3: Failed submission -> intended draft remains
  await runStep('3. Failed server submission retains draft in form and in-memory snapshot', async () => {
    await openRavenComposer(page);

    // Configure mock server to fail /api/missive with provider failure
    missiveResponseStatus = 500;
    missiveResponseBody = { success: false, message: 'Server-side dispatch failure: mail provider unavailable' };

    // Enter draft
    await setFormFields(page, {
      name: 'Brienne of Tarth',
      email: 'brienne@gmail.com',
      subject: 'Oathkeeper Missive',
      body: 'I made a promise to Lady Catelyn, and I mean to keep it.',
    });

    // Submit the form
    await page.evaluate(() => {
      const form = document.getElementById('desktop-raven-form');
      form?.requestSubmit();
    });

    // On server failure, application displays receipt view with direct fallback and preserves full message
    await page.waitForSelector('#raven-receipt-view:not(.hidden)', { timeout: 5000 });
    const receiptHeading = await page.$eval('#receipt-heading', (el) => el.textContent);
    assert.match(receiptHeading, /Direct Email Fallback Ready/i);

    const receiptBody = await page.$eval('#receipt-body', (el) => el.textContent);
    assert.equal(receiptBody, 'I made a promise to Lady Catelyn, and I mean to keep it.');

    // Return to composer via reset button
    const resetBtn = await page.waitForSelector('#receipt-reset-btn');
    await page.waitForFunction(() => typeof document.getElementById('receipt-reset-btn')?.onclick === 'function');
    await resetBtn.evaluate(button => button.click());
    await page.waitForSelector('#raven-composer-view:not(.hidden)', { timeout: 5000 });

    // Now test backend validation error branch
    missiveResponseStatus = 400;
    missiveResponseBody = { success: false, isValidationError: true, message: 'Please check your form entries and try again.' };

    await setFormFields(page, {
      name: 'Brienne of Tarth',
      email: 'brienne@gmail.com',
      subject: 'Oathkeeper Missive',
      body: 'I made a promise to Lady Catelyn, and I mean to keep it.',
    });

    await page.evaluate(() => {
      const form = document.getElementById('desktop-raven-form');
      form?.requestSubmit();
    });

    // Validation failure displays error container and stays on composer view
    await page.waitForSelector('#desktop-raven-error:not(.hidden)', { timeout: 5000 });
    const errorText = await page.$eval('#desktop-raven-error', (el) => el.textContent);
    assert.match(errorText, /check your form entries/i);

    // Form inputs must STILL retain the entered draft
    assert.equal(await page.$eval('#desktop-sender-name', (el) => el.value), 'Brienne of Tarth');
    assert.equal(await page.$eval('#desktop-sender-email', (el) => el.value), 'brienne@gmail.com');
    assert.equal(await page.$eval('#desktop-missive-subject', (el) => el.value), 'Oathkeeper Missive');
    assert.equal(await page.$eval('#desktop-missive-body', (el) => el.value), 'I made a promise to Lady Catelyn, and I mean to keep it.');

    // Close and reopen modal to verify in-memory draft also retained
    await closeRavenComposer(page);
    await openRavenComposer(page);

    assert.equal(await page.$eval('#desktop-sender-name', (el) => el.value), 'Brienne of Tarth');
    assert.equal(await page.$eval('#desktop-missive-body', (el) => el.value), 'I made a promise to Lady Catelyn, and I mean to keep it.');
  });

  // Test 4: Confirmed successful submission -> draft clears
  await runStep('4. Confirmed successful submission displays receipt view and clears draft', async () => {
    await openRavenComposer(page);

    // Configure mock server to succeed with server-delivered flag
    missiveResponseStatus = 200;
    missiveResponseBody = { success: true, delivered: true, message: 'Missive dispatched successfully' };

    // Submit the form
    await page.evaluate(() => {
      const form = document.getElementById('desktop-raven-form');
      form?.requestSubmit();
    });

    // Wait for receipt view to appear with success confirmation
    await page.waitForSelector('#raven-receipt-view:not(.hidden)', { timeout: 5000 });
    const receiptHeading = await page.$eval('#receipt-heading', (el) => el.textContent);
    assert.match(receiptHeading, /Delivered to Nhovem/i);

    // Do not press reset first: success itself must prevent the old draft returning.
    await closeRavenComposer(page);
    await openRavenComposer(page);
    assert.equal(await page.$eval('#desktop-missive-body', el => el.value), '', 'Confirmed send must clear draft before any reset click');
    // Restore the existing receipt for the separate reset-button assertion below.
    await page.evaluate(() => {
      document.getElementById('raven-composer-view').classList.add('hidden');
      document.getElementById('raven-receipt-view').classList.remove('hidden');
    });

    // Reset from receipt view
    const resetBtn = await page.waitForSelector('#receipt-reset-btn');
    await page.waitForFunction(() => typeof document.getElementById('receipt-reset-btn')?.onclick === 'function');
    await resetBtn.evaluate(button => button.click());
    await page.waitForSelector('#raven-composer-view:not(.hidden)', { timeout: 5000 });

    // Verify inputs are cleared
    assert.equal(await page.$eval('#desktop-sender-name', (el) => el.value), '');
    assert.equal(await page.$eval('#desktop-sender-email', (el) => el.value), '');
    assert.equal(await page.$eval('#desktop-missive-body', (el) => el.value), '');

    // Close modal and reopen: draft must remain cleared
    await closeRavenComposer(page);
    await openRavenComposer(page);

    assert.equal(await page.$eval('#desktop-sender-name', (el) => el.value), '');
    assert.equal(await page.$eval('#desktop-missive-body', (el) => el.value), '');
  });

  // Test 5: Explicit form reset -> draft clears
  await runStep('5. Explicit form reset clears current inputs and draft state', async () => {
    await openRavenComposer(page);

    await setFormFields(page, {
      name: 'Samwell Tarly',
      email: 'sam@citadel.com',
      subject: 'Dragonglass Scrolls',
      body: 'Found ancient maps in the restricted vaults.',
    });

    // Close to snapshot draft
    await closeRavenComposer(page);

    // Reopen and verify it was saved
    await openRavenComposer(page);
    assert.equal(await page.$eval('#desktop-sender-name', (el) => el.value), 'Samwell Tarly');

    // Explicitly reset form
    await page.evaluate(() => {
      const form = document.getElementById('desktop-raven-form');
      form.reset();
      form.querySelectorAll('input, textarea').forEach((el) => el.dispatchEvent(new Event('input', { bubbles: true })));
    });

    // Close modal (snapshotting empty form)
    await closeRavenComposer(page);

    // Reopen: draft must be empty
    await openRavenComposer(page);

    assert.equal(await page.$eval('#desktop-sender-name', (el) => el.value), '');
    assert.equal(await page.$eval('#desktop-missive-body', (el) => el.value), '');

    await closeRavenComposer(page);
  });

  // Test 6: Mobile viewport transition and input synchronization
  await runStep('6. Mobile viewport (375x812) presents responsive sheet and coordinates draft', async () => {
    console.log('  [Debug T6] Step 1: before openRavenComposer');
    await openRavenComposer(page);
    console.log('  [Debug T6] Step 2: after openRavenComposer');

    // Enter draft in desktop
    await setFormFields(page, {
      name: 'Arya Stark',
      email: 'arya@gmail.com',
      subject: 'Needle Retained',
      body: 'A girl is Arya Stark of Winterfell, and I am going home.',
    });
    console.log('  [Debug T6] Step 3: after setFormFields, desktop-name:', await page.$eval('#desktop-sender-name', el => el.value), 'mobile-name:', await page.$eval('#mobile-sender-name', el => el.value));

    // Close modal to snapshot draft and sync to mobile
    await closeRavenComposer(page);
    console.log('  [Debug T6] Step 4: after closeRavenComposer, mobile-name:', await page.$eval('#mobile-sender-name', el => el.value));

    // Switch to mobile viewport
    await page.setViewport({ width: 375, height: 812 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));

    // On mobile, the dispatch stack is visible directly in the viewport
    const mobileStackBox = await page.$eval('.narrow-dispatch-stack', (el) => {
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return { width: r.width, display: style.display };
    });
    assert.equal(mobileStackBox.display, 'block', 'Mobile dispatch stack must be displayed on mobile viewport');
    assert.ok(mobileStackBox.width <= 375, `Mobile dispatch stack width ${mobileStackBox.width} must fit within 375px`);

    // Verify draft was synchronized to mobile form inputs
    const mobileNameVal = await page.$eval('#mobile-sender-name', (el) => el.value);
    const mobileBodyVal = await page.$eval('#mobile-missive-body', (el) => el.value);
    assert.equal(mobileNameVal, 'Arya Stark', 'Draft name must synchronize to mobile form');
    assert.equal(mobileBodyVal, 'A girl is Arya Stark of Winterfell, and I am going home.', 'Draft body must synchronize to mobile form');

    // Make an edit in mobile form
    await page.evaluate(() => {
      const bodyInput = document.getElementById('mobile-missive-body');
      if (bodyInput) {
        bodyInput.value = 'A girl is Arya Stark of Winterfell, and I am going home. Valar Morghulis.';
        bodyInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    // Switch back to desktop viewport
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));

    // Open desktop composer
    await openRavenComposer(page);

    // Verify the mobile edit was synchronized to desktop form
    assert.equal(await page.$eval('#desktop-sender-name', (el) => el.value), 'Arya Stark');
    assert.equal(await page.$eval('#desktop-missive-body', (el) => el.value), 'A girl is Arya Stark of Winterfell, and I am going home. Valar Morghulis.');
  });

  // Test 7: Full reload semantics (clears ephemeral module memory)
  await runStep('7. Hard page reload resets ephemeral module memory (draft not retained across reload)', async () => {
    // Reload page
    await page.reload({ waitUntil: 'networkidle0' });

    // Reopen composer dialog
    await openRavenComposer(page);

    // Fields must be empty after full page reload (privacy guarantee: no persistence across full reloads)
    assert.equal(await page.$eval('#desktop-sender-name', (el) => el.value), '');
    assert.equal(await page.$eval('#desktop-sender-email', (el) => el.value), '');
    assert.equal(await page.$eval('#desktop-missive-body', (el) => el.value), '');
  });

  // Test 8: Deep Storage & Cookie Inspection (No Storage Leakage)
  await runStep('8. Deep inspection confirms ZERO storage leakage in localStorage, sessionStorage, cookies, or cache', async () => {
    await openRavenComposer(page);

    // Fill draft again to test during active form editing
    await setFormFields(page, {
      name: 'Confidential Spy',
      email: 'spy@gmail.com',
      subject: 'Secret Token',
      body: 'TOP_SECRET_PAYLOAD_TOKEN_MARKER_998811',
    });
    // Put a real synthetic challenge value through the application's submission path.
    missiveResponseStatus = 400;
    missiveResponseBody = { success: false, isValidationError: true, message: 'Storage verification failure stub' };
    await page.evaluate(token => {
      localStorage.removeItem('raven_sends');
      const form = document.getElementById('desktop-raven-form');
      const input = document.createElement('input');
      input.type = 'hidden'; input.name = 'cf-turnstile-response'; input.value = token;
      form.append(input);
      form.requestSubmit();
    }, syntheticToken);
    await page.waitForSelector('#desktop-raven-error:not(.hidden)');
    assert(submittedPayloads.some(payload => payload.turnstileToken === syntheticToken), 'Synthetic challenge token must reach mocked API');

    // Inspect localStorage
    const localEntries = await page.evaluate(() => {
      const entries = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        entries[k] = localStorage.getItem(k);
      }
      return entries;
    });

    // Inspect sessionStorage
    const sessionEntries = await page.evaluate(() => {
      const entries = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        entries[k] = sessionStorage.getItem(k);
      }
      return entries;
    });

    // Inspect document.cookie
    const cookieString = await page.evaluate(() => document.cookie);

    // Inspect history.state
    const historyState = await page.evaluate(() => JSON.stringify(history.state || {}));

    const sensitiveMarkers = [
      'Confidential Spy',
      'spy@gmail.com',
      'TOP_SECRET_PAYLOAD_TOKEN_MARKER_998811',
      'Arya Stark',
      'Brienne of Tarth',
      'Ser Davos',
      syntheticToken,
    ];

    for (const marker of sensitiveMarkers) {
      for (const [k, v] of Object.entries(localEntries)) {
        assert.ok(!k.includes(marker), `localStorage key leakage: ${k}`);
        assert.ok(!String(v).includes(marker), `localStorage value leakage in ${k}: ${v}`);
      }
      for (const [k, v] of Object.entries(sessionEntries)) {
        assert.ok(!k.includes(marker), `sessionStorage key leakage: ${k}`);
        assert.ok(!String(v).includes(marker), `sessionStorage value leakage in ${k}: ${v}`);
      }
      assert.ok(!cookieString.includes(marker), `document.cookie leakage for marker: ${marker}`);
      assert.ok(!historyState.includes(marker), `history.state leakage for marker: ${marker}`);
    }
    const inspection = await page.evaluate(inspectPersistentStorage, sensitiveMarkers);
    console.log('Persistent storage scan:', JSON.stringify(inspection.checked));
    assert.deepEqual(inspection.findings, [], 'Draft or challenge token leaked to persistent storage');
    // Negative control proves the scanner can find a real IDB and cache-body leak.
    await page.evaluate(async () => {
      const cache = await caches.open('security-scanner-negative');
      await cache.put('/scanner-control', new Response('SCANNER_NEGATIVE_MARKER'));
      const db = await new Promise((ok, fail) => {
        const req = indexedDB.open('security-scanner-negative', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('records');
        req.onsuccess = () => ok(req.result); req.onerror = () => fail(req.error);
      });
      await new Promise((ok, fail) => {
        const tx = db.transaction('records', 'readwrite');
        tx.objectStore('records').put({ secret: 'SCANNER_NEGATIVE_MARKER' }, 'entry');
        tx.oncomplete = ok; tx.onerror = () => fail(tx.error);
      });
      db.close();
    });
    try {
      const control = await page.evaluate(inspectPersistentStorage, ['SCANNER_NEGATIVE_MARKER']);
      assert(control.findings.some(item => item.location.startsWith('CacheStorage:')));
      assert(control.findings.some(item => item.location.startsWith('IndexedDB:')));
    } finally {
      await page.evaluate(async () => {
        await caches.delete('security-scanner-negative');
        await new Promise((ok, fail) => {
          const req = indexedDB.deleteDatabase('security-scanner-negative');
          req.onsuccess = ok; req.onerror = () => fail(req.error);
        });
      });
    }
  });

  // Test 9: Network Isolation Assertion
  await runStep('9. Network isolation verified: zero outbound external requests were attempted', async () => {
    assert.deepEqual(unexpectedRequests, [], `Unexpected external requests: ${unexpectedRequests.join(', ')}`);
  });

  await page.close();
} finally {
  await browser?.close();
  await server.close();
}

console.log(`\nStage C Verification Finished: ${passed}/${total} tests passed.`);
if (passed !== total || unexpectedRequests.length > 0) {
  process.exitCode = 1;
}
