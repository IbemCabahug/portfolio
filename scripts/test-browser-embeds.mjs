/**
 * Stage E: Real Browser Embed Sandboxing, Lifecycle & Navigation Restrictions
 * 
 * Tests:
 *  1. BitsLiveDemo (/quests/bits): Launch, iframe insertion, loading state, loaded state.
 *  2. BitsLiveDemo: Strict sandbox verification (omits allow-top-navigation).
 *  3. BitsLiveDemo: Top-level navigation restriction (iframe attempting top navigation is blocked).
 *  4. BitsLiveDemo: View switching (Dashboard -> Terminal tab) and popout link synchronization.
 *  5. BitsLiveDemo: Disengage / unload (iframe removed, slots emptied, resting restored).
 *  6. QuestDemoShell (/quests/arcanetyper): Launch, fit-canvas responsive scaling calculation.
 *  7. QuestDemoShell: Slow/timeout status notification and retry button handling.
 *  8. TransceiverModal (/messenger): Dialog opening, project carousel navigation (Prev/Next).
 *  9. TransceiverModal: Launch arena, loader, iframe sandbox boundaries.
 * 10. TransceiverModal: Top-level navigation blocked and disengage cleanup.
 * 11. Network isolation verification (zero unauthorized external requests).
 */

import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import { EDGE } from './browser-path.mjs';
import { createDistServer } from './serve-dist.mjs';
import { buildRoot } from './security-browser-helpers.mjs';

const ISOLATED_ROOT = buildRoot;
let holdDashboard = false;
const heldRequests = [];

async function assertTopNavigationBlocked(page, selector) {
  const frame = await (await page.$(selector)).contentFrame();
  await frame.waitForFunction(() => document.readyState === 'complete');
  const originalUrl = page.url();
  const result = await frame.evaluate(() => {
    try { top.location.href = 'https://blocked.security.example/top-navigation'; return 'allowed'; }
    catch (error) { return error.name; }
  });
  assert.equal(result, 'SecurityError');
  assert.equal(page.url(), originalUrl);
}

let testIndex = 0;
let passedTests = 0;
let failedTests = 0;

async function runStep(name, fn) {
  testIndex++;
  console.log(`\n--- [EMBED TEST ${testIndex}] ${name} ---`);
  try {
    await fn();
    passedTests++;
    console.log(`  PASS: ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`  FAIL: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log('=== Stage E: Browser Embed Security & Lifecycle Test Suite ===\n');

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

  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[Embed]') || text.includes('SecurityError') || text.includes('Blocked')) {
      console.log(`  [Browser Embed Console] ${text}`);
    }
  });

  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (new URL(url).origin === server.origin) {
      // Deterministic stub embed content
      if (url.includes('/embed-stub-bits')) {
        return void req.respond({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: `<!doctype html><html><body><h1>BITS Attendance Simulator Stub</h1><button id="nav-btn" onclick="try{window.top.location.href='https://malicious.example.com'}catch(e){console.log('TopNavBlocked:'+e.message)}">Attempt Top Nav</button></body></html>`,
        });
      }
      if (url.includes('/embed-stub-terminal')) {
        return void req.respond({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: `<!doctype html><html><body><h1>ZKTeco Simulator Terminal Stub</h1></body></html>`,
        });
      }
      return void req.continue();
    }

    if (url.startsWith('https://bits-stub.security.example/')) {
      if (holdDashboard) { heldRequests.push(req); return; }
      return void req.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Cross-origin BITS fixture</title><p>Local deterministic response</p>' });
    }
    if (url.startsWith('https://terminal-stub.security.example/')) {
      return void req.respond({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Cross-origin terminal fixture</title>' });
    }

    // Intercepted deterministic substitutes for external font and app embeds
    if (url.startsWith('https://fonts.googleapis.com/') || url.startsWith('https://fonts.gstatic.com/')) {
      return void req.respond({
        status: 200,
        contentType: 'text/css; charset=utf-8',
        body: '/* Deterministic offline font stub */',
      });
    }

    if (url.startsWith('https://arcane-typer.vercel.app/')) {
      return void req.respond({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><html><body><h1>Arcane Typer Deterministic Stub</h1></body></html>`,
      });
    }

    if (url.startsWith('https://bits-beta-five.vercel.app/')) {
      return void req.respond({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: `<!doctype html><html><body><h1>BITS Beta Deterministic Stub</h1></body></html>`,
      });
    }

    unexpectedRequests.push(url);
    void req.abort();
  });

  // ── TEST SUITE PART 1: BitsLiveDemo (/quests/bits) ──────────────────

  await runStep('1. BitsLiveDemo: Resting state, launch activation, and iframe insertion', async () => {
    await page.goto(`${server.origin}/quests/bits`, { waitUntil: 'networkidle0' });

    // Assert resting view visible, active view hidden
    const isRestingVisible = await page.$eval('bits-live-demo [data-resting]', (el) => !el.hidden);
    const isActiveHidden = await page.$eval('bits-live-demo [data-active]', (el) => el.hidden);
    assert.ok(isRestingVisible, 'Resting state must be visible initially');
    assert.ok(isActiveHidden, 'Active state must be hidden initially');

    // Override dataset URLs to deterministic local stubs
    await page.evaluate((origin) => {
      const demo = document.querySelector('bits-live-demo');
      if (demo) {
        demo.dataset.dashboardUrl = 'https://bits-stub.security.example/embed-stub-bits';
        demo.dataset.terminalUrl = 'https://terminal-stub.security.example/embed-stub-terminal';
      }
    }, server.origin);

    // Click launch button
    const launchBtn = await page.waitForSelector('bits-live-demo [data-launch]');
    await launchBtn.click();

    // Active state should become visible
    await page.waitForSelector('bits-live-demo [data-active]:not([hidden])', { timeout: 5000 });
    const isNowActive = await page.$eval('bits-live-demo [data-active]', (el) => !el.hidden);
    assert.ok(isNowActive, 'Active demo container must become visible after launch');

    // Frame slot should contain an iframe
    await page.waitForSelector('bits-live-demo [data-frame="dashboard"] iframe', { timeout: 5000 });
    const iframeSrc = await page.$eval('bits-live-demo [data-frame="dashboard"] iframe', (el) => el.src);
    assert.ok(iframeSrc.includes('/embed-stub-bits'), `Iframe must load dashboard URL. Got: ${iframeSrc}`);

    // Global demo active marker set on body
    const bodyActive = await page.$eval('body', (el) => el.dataset.demoActive);
    assert.equal(bodyActive, 'true', 'body.dataset.demoActive must be "true" during active demo');
    assert.equal(await page.$$eval('bits-live-demo [data-frame="terminal"] iframe', els => els.length), 0, 'Terminal is lazy loaded');
  });

  await runStep('2. BitsLiveDemo: Strict sandbox attribute verification', async () => {
    const sandboxValue = await page.$eval('bits-live-demo [data-frame="dashboard"] iframe', (el) => el.getAttribute('sandbox'));
    const tokens = sandboxValue.split(/\s+/);

    assert.ok(tokens.includes('allow-scripts'), 'Must allow scripts');
    assert.ok(tokens.includes('allow-same-origin'), 'Must allow same-origin for internal communication');
    assert.ok(tokens.includes('allow-forms'), 'Must allow form actions');
    assert.ok(tokens.includes('allow-popups'), 'Must allow popups');

    // Critical security restrictions:
    assert.ok(!tokens.includes('allow-top-navigation'), 'SECURITY: Must NOT include allow-top-navigation');
    assert.ok(!tokens.includes('allow-top-navigation-by-user-activation'), 'SECURITY: Must NOT include allow-top-navigation-by-user-activation');
    assert.ok(!tokens.includes('allow-top-navigation-to-custom-protocols'), 'SECURITY: Must NOT include allow-top-navigation-to-custom-protocols');
  });

  await runStep('3. BitsLiveDemo: Top-level navigation restriction enforcement', async () => {
    // Access iframe frame object
    const frames = page.frames();
    const stubFrame = frames.find((f) => f.url().includes('/embed-stub-bits'));
    assert.ok(stubFrame, 'Stub frame must exist in page frames list');

    // Attempt top-level navigation from inside sandboxed iframe
    const topNavBlocked = await stubFrame.evaluate(() => {
      try {
        window.top.location.href = 'https://malicious.example.com/exploit';
        return false; // Should not reach here if blocked
      } catch (e) {
        return true; // Threw DOMException / SecurityError
      }
    });

    assert.ok(topNavBlocked, 'Browser must block iframe from navigating window.top');
    // Verify top-level URL did not change
    assert.ok(page.url().includes('/quests/bits'), 'Top-level page must remain on /quests/bits');
  });

  await runStep('4. BitsLiveDemo: Tab switching, popout link updates, and iframe lifecycle', async () => {
    // Click Terminal view tab
    const terminalTab = await page.waitForSelector('bits-live-demo [data-view="terminal"]');
    await terminalTab.click();

    // Verify Terminal panel active, dashboard panel hidden
    await page.waitForSelector('bits-live-demo [data-panel="terminal"]:not([hidden])', { timeout: 5000 });
    const isDashboardHidden = await page.$eval('bits-live-demo [data-panel="dashboard"]', (el) => el.hidden);
    assert.ok(isDashboardHidden, 'Dashboard panel must be hidden when Terminal is selected');

    // Popout link must reflect terminal stub URL
    const popoutHref = await page.$eval('bits-live-demo [data-popout]', (el) => el.href);
    assert.ok(popoutHref.includes('/embed-stub-terminal'), `Popout link must update to terminal URL. Got: ${popoutHref}`);
  });

  await runStep('5. BitsLiveDemo: Disengage demo unloads iframes and cleans up DOM', async () => {
    const closeBtn = await page.waitForSelector('bits-live-demo [data-close]');
    await closeBtn.click();

    // Resting view restored, active view hidden
    await page.waitForSelector('bits-live-demo [data-resting]:not([hidden])', { timeout: 5000 });
    const isRestingVisible = await page.$eval('bits-live-demo [data-resting]', (el) => !el.hidden);
    const isActiveHidden = await page.$eval('bits-live-demo [data-active]', (el) => el.hidden);
    assert.ok(isRestingVisible, 'Resting view must be visible after disengage');
    assert.ok(isActiveHidden, 'Active view must be hidden after disengage');

    // All iframes must be removed from the DOM
    const iframesCount = await page.$$eval('bits-live-demo iframe', (els) => els.length);
    assert.equal(iframesCount, 0, 'All embedded iframes must be removed from DOM upon unload');

    // Global demo active marker removed
    const bodyActive = await page.$eval('body', (el) => el.dataset.demoActive);
    assert.equal(bodyActive, undefined, 'body.dataset.demoActive must be cleaned up');
  });

  await runStep('BITS slow response shows notice, retry replaces frame, and missing terminal stays unloaded', async () => {
    holdDashboard = true;
    await page.$eval('bits-live-demo', el => { el.dataset.slowTimeoutMs = '150'; });
    await page.click('bits-live-demo [data-launch]');
    const oldFrame = await page.$('bits-live-demo [data-frame="dashboard"] iframe');
    await page.waitForFunction(() => /longer than expected/i.test(document.querySelector('bits-live-demo [data-status="dashboard"]').textContent));
    holdDashboard = false;
    await page.click('bits-live-demo [data-retry="dashboard"]');
    assert.equal(await oldFrame.evaluate(el => el.isConnected), false);
    await page.waitForFunction(() => /External view requested/i.test(document.querySelector('bits-live-demo [data-status="dashboard"]').textContent));
    for (const req of heldRequests.splice(0)) await req.abort().catch(() => {});
    await oldFrame.dispose();
    await page.click('bits-live-demo [data-close]');
    await page.$eval('bits-live-demo', el => { el.dataset.terminalUrl = ''; });
    await page.click('bits-live-demo [data-launch]');
    await page.click('bits-live-demo [data-view="terminal"]');
    await page.waitForFunction(() => /not configured/i.test(document.querySelector('bits-live-demo [data-status="terminal"]').textContent));
    assert.equal(await page.$$eval('bits-live-demo [data-frame="terminal"] iframe', els => els.length), 0);
    assert.equal(await page.$eval('bits-live-demo [data-retry="terminal"]', el => el.disabled), true);
    await page.click('bits-live-demo [data-close]');
  });

  // ── TEST SUITE PART 2: QuestDemoShell (/quests/arcanetyper) ──────────

  await runStep('6. QuestDemoShell: Launch and fit-canvas scaling calculation', async () => {
    await page.goto(`${server.origin}/quests/arcanetyper`, { waitUntil: 'networkidle0' });

    // Set viewport to standard 1280x800
    await page.setViewport({ width: 1280, height: 800 });

    // Override dataset for local deterministic URL
    await page.evaluate((origin) => {
      const shell = document.querySelector('[data-quest-demo-shell]');
      if (shell) {
        shell.dataset.liveUrl = `${origin}/embed-stub-bits`;
      }
    }, server.origin);

    const launchBtn = await page.waitForSelector('[data-quest-demo-shell] [data-launch]');
    await launchBtn.click();

    await page.waitForSelector('[data-quest-demo-shell] [data-active]:not([hidden])', { timeout: 5000 });
    const slotMode = await page.$eval('[data-quest-demo-shell] .frame-slot', (el) => el.dataset.displayMode);
    assert.equal(slotMode, 'fit-canvas', 'Arcane Typer must use fit-canvas display mode');

    // Iframe must have transform scale applied
    const iframeTransform = await page.$eval('[data-quest-demo-shell] .frame-slot iframe', (el) => el.style.transform);
    assert.ok(iframeTransform.includes('scale('), `Iframe must have scale transform applied. Got: "${iframeTransform}"`);
    await assertTopNavigationBlocked(page, '[data-quest-demo-shell] .frame-slot iframe');
  });

  await runStep('7. QuestDemoShell: Disengage unloads iframe and frees resources', async () => {
    const closeBtn = await page.waitForSelector('[data-quest-demo-shell] [data-close]');
    await closeBtn.click();

    await page.waitForSelector('[data-quest-demo-shell] [data-resting]:not([hidden])', { timeout: 5000 });
    const iframesCount = await page.$$eval('[data-quest-demo-shell] iframe', (els) => els.length);
    assert.equal(iframesCount, 0, 'Arcane Typer iframe must be removed upon unload');
  });

  // ── TEST SUITE PART 3: TransceiverModal (/messenger) ────────────────

  await runStep('8. TransceiverModal: Dialog opening and project carousel navigation', async () => {
    await page.goto(`${server.origin}/messenger`, { waitUntil: 'networkidle0' });

    // Click Arcane Machine trigger
    await page.evaluate(() => document.getElementById('trigger-arcane-machine')?.click());
    await page.waitForSelector('#dialog-machine:not([hidden])', { timeout: 5000 });

    const dialogTitle = await page.$eval('#machine-dialog-title', (el) => el.textContent);
    assert.ok(dialogTitle.includes('Arcane Transceiver'), 'Must open Arcane Transceiver dialog');

    // Verify initial project: Arcane Typer (index 0)
    const initialDesc = await page.$eval('#transceiver-description', (el) => el.textContent);
    assert.ok(initialDesc.includes('Arcane Typer') || initialDesc.includes('typing physics'), 'Initial project must be Arcane Typer');

    // Click Next button -> Project 1 (BITS)
    const nextBtn = await page.waitForSelector('#transceiver-next-btn');
    await nextBtn.click();

    const bitsDesc = await page.$eval('#transceiver-description', (el) => el.textContent);
    assert.ok(bitsDesc.includes('BITS') || bitsDesc.includes('attendance'), 'Carousel Next must switch to BITS');

    // Click Next button -> Project 2 (Mimic)
    await nextBtn.click();
    const mimicDesc = await page.$eval('#transceiver-description', (el) => el.textContent);
    assert.ok(/mimic|vault|simulation/i.test(mimicDesc), `Carousel Next must switch to Mimic. Got: "${mimicDesc}"`);

    const mimicTitle = await page.$eval('#machine-dialog-title', (el) => el.textContent);
    assert.ok(mimicTitle.includes('Mimic Vault'), `Title must show Mimic Vault. Got: "${mimicTitle}"`);

    // Click Next button -> wraps back to Project 0 (Arcane Typer)
    await nextBtn.click();
    const wrappedDesc = await page.$eval('#transceiver-description', (el) => el.textContent);
    assert.ok(wrappedDesc.includes('Arcane Typer') || wrappedDesc.includes('typing physics'), 'Carousel must wrap around to index 0');
  });

  await runStep('9. TransceiverModal: Launch arena, sandbox boundaries, and top-level nav prevention', async () => {
    // Launch Arcane Typer inside Transceiver
    const launchArenaBtn = await page.waitForSelector('#transceiver-launch-btn');
    await launchArenaBtn.click();

    // Verify frame container has active iframe
    await page.waitForSelector('#transceiver-frame-container iframe', { timeout: 5000 });
    const sandboxValue = await page.$eval('#transceiver-frame-container iframe', (el) => el.getAttribute('sandbox'));
    const tokens = sandboxValue.split(/\s+/);

    assert.ok(tokens.includes('allow-scripts'), 'Must allow scripts');
    assert.ok(tokens.includes('allow-same-origin'), 'Must allow same-origin');
    assert.ok(!tokens.includes('allow-top-navigation'), 'SECURITY: Must NOT allow top navigation');
    await assertTopNavigationBlocked(page, '#transceiver-frame-container iframe');

    // Disengage via Transceiver unload button
    const unloadBtn = await page.waitForSelector('#transceiver-unload-btn');
    await unloadBtn.click();

    // Verify iframe removed
    const iframesInContainer = await page.$$eval('#transceiver-frame-container iframe', (els) => els.length);
    assert.equal(iframesInContainer, 0, 'Transceiver iframe must be removed upon disengage');

    // Close Transceiver dialog
    await page.evaluate(() => {
      const closeBtn = document.querySelector('#dialog-machine .close-panel-btn');
      if (closeBtn) closeBtn.click();
    });
    await page.waitForFunction(() => {
      const dialog = document.getElementById('dialog-machine');
      return !dialog || dialog.hidden || dialog.getAttribute('aria-hidden') === 'true';
    }, { timeout: 5000 });
  });

  await runStep('10. Network isolation: zero external outbound requests attempted across all embed actions', async () => {
    assert.equal(
      unexpectedRequests.length,
      0,
      `Network isolation violated! Unexpected requests: ${JSON.stringify(unexpectedRequests)}`
    );
  });

} finally {
  if (browser) await browser.close();
  await server.close();
}

console.log(`\nStage E Verification Finished: ${passedTests}/${testIndex} tests passed.`);
if (failedTests > 0) {
  process.exitCode = 1;
} else {
  console.log('ALL STAGE E EMBED SECURITY & LIFECYCLE TESTS PASSED WITH EXIT CODE 0.');
}
