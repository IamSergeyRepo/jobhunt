#!/usr/bin/env node
// Gmail Unsubscriber — uses persistent Chrome profile to bulk-unsubscribe from senders
// Usage: node scripts/gmail-unsubscribe.mjs

import { chromium } from 'playwright';
import { createInterface } from 'node:readline';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const CHROME_PROFILE = resolve(PROJECT_ROOT, 'auth', 'chrome-profile');

const SENDERS = [
  'PetSmart@mail.petsmart.com',
  'swansonhealthproducts@swanson-vitamins.com',
  'rostelecom@cbm.rt.ru',
  'no-reply+f70afbd3@toast-restaurants.com',
  'tips@avito.ru',
  'learn@plan-details.kp.org',
  'notification@emails.aloyoga.com',
  'breezebid@flybreeze.com',
  'activations@exploriaresorts.com',
  'info@barodycamps.ccsend.com',
  'info@news.free2move.com',
  'team@mail.perplexity.ai',
  'reebok@reebokusnews.reebok.com',
  'service@drawnames.com',
  'IHGOneRewards@mc.ihg.com',
  'avianca@newsletter.avianca.com',
  'feedback@smallflower.com',
  'no-reply+650d122d@toast-restaurants.com',
  'kristina@planswell.com',
  'digest@wink.rt.ru',
  'principalresearch@qe.mail.principal.com',
  'info@marahoffman.com',
  'walmartcustomerexperience@express10.medallia.com',
  'noreply@drive.yandex.ru',
  'social@thefriedricecollective.com',
  'hello@students.udemy.com',
  'PotteryBarn@e.potterybarn.com',
  'info@e.sixt.com',
  'bluestonelane@levelup-mail.com',
  'news@email.mentoday.ru',
  'news@email.pravilamag.ru',
  'news@email.techinsider.ru',
  'news@email.graziamagazine.ru',
  'hello@pyeoptics.com',
  'sail@travelregatta.ru',
  'newsletter@reply.agoda-emails.com',
  'TravelandLeisure@mail.travelandleisure.com',
  'Shutterfly@em.shutterfly.com',
  'news@email.thesymbol.ru',
  'picks@campaign.eventbrite.com',
  'email.campaign@sg.booking.com',
  'WestElm@e.westelm.com',
  'People@specialoffers.meredith.com',
  'gTEAM@eml.glossier.com',
  'BestBuyInfo@emailinfo.bestbuy.com',
  'BestBuy@email.bestbuy.com',
  'bilet@mos.ru',
  'newsletter@email.businessinsider.com',
  'discover@airbnb.com',
  'Lifemiles@newsletter.lifemiles.com',
  'info@mailing.edukitinc.com',
  'Guardianbenefits@employeebenefits.guardianlife.com',
  'smefinanceforum@ifc.org',
  'no-reply@linuxfoundation.org',
  'support@email.spothero.com',
  'support@starry.com',
  'hello@yuka.io',
  'rosslyn@nvdo.info',
  'hello@deals.going.com',
  'newsletter@marketing.descript.com',
  'hello@email.bing.com',
  'cardholder@e.synchronyfinancial.com',
  'crm@sendlux.motherbear.ru',
  'Rejuvenation@e.rejuvenation.com',
  'no-reply@content.ivi.ru',
  'usmail@expediamail.com',
  'subscribe@aviasales.ru',
  'hello@marketing.lyst.com',
  'discover@card-e.em.discover.com',
  'communications@ema.activehealth.com',
  'Casadonna@email.sevenrooms.com',
  'mail@music.deezer.com',
  'chloe.vysa.com@qohgb.e2ma.net',
  'hi@mail.cursor.com',
  'cscpaymobile@hello.cscsw.com',
  'info@sportrock.com',
  'newsletter@mail.sportsconnect.com',
  'DSG@e.dcsg.com',
  'editors-noreply@linkedin.com',
  'no-reply@email.alltrails.com',
];

function log(msg) { console.log(`[unsub] ${msg}`); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function tryUnsubscribe(page, sender) {
  log(`\nProcessing: ${sender}`);

  // Search for emails from this sender
  await page.goto(
    `https://mail.google.com/mail/u/0/#search/from%3A${encodeURIComponent(sender)}`,
    { waitUntil: 'domcontentloaded', timeout: 20000 }
  );
  await sleep(2500);

  // Check for results — Gmail email rows have class 'zA'
  const rows = page.locator('tr.zA');
  const rowCount = await rows.count();
  if (rowCount === 0) {
    log(`  → No emails found`);
    return 'no-emails';
  }

  // Open first (most recent) email
  await rows.first().click();
  await sleep(2500);

  // Look for Gmail's built-in unsubscribe link (appears next to sender name in header)
  // Gmail renders it as a link with text "Unsubscribe" inside the message header
  const unsubLocator = page.locator([
    'span[data-action-type="UNSUBSCRIBE"]',
    'a[aria-label*="nsubscribe"]',
    'span.bAp a',           // sender detail area link
    'span:has-text("Unsubscribe")',
  ].join(', ')).first();

  const found = await unsubLocator.count();
  if (found === 0) {
    log(`  → No Gmail unsubscribe button`);
    return 'no-button';
  }

  await unsubLocator.click();
  await sleep(1500);

  // Handle Gmail confirmation dialog
  const dialog = page.locator('[role="dialog"], [role="alertdialog"]').first();
  const dialogVisible = await dialog.count();

  if (dialogVisible > 0) {
    const confirmBtn = dialog.locator('button').filter({ hasText: /unsubscribe/i }).first();
    const confirmCount = await confirmBtn.count();
    if (confirmCount > 0) {
      await confirmBtn.click();
      await sleep(1000);
      log(`  → ✓ Unsubscribed`);
      return 'success';
    }
    // Some dialogs just have an OK/Close — count it as partial
    log(`  → Dialog opened but no confirm button — marking partial`);
    return 'partial';
  }

  // No dialog = link went straight through (some mailto: or redirect unsubscribes)
  log(`  → ✓ Unsubscribe clicked (no confirmation dialog)`);
  return 'success';
}

async function main() {
  if (!existsSync(CHROME_PROFILE)) {
    mkdirSync(CHROME_PROFILE, { recursive: true });
  }

  const context = await chromium.launchPersistentContext(CHROME_PROFILE, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1280, height: 900 },
    args: [
      '--disable-blink-features=AutomationControlled',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const page = context.pages()[0] || await context.newPage();

  // Verify Gmail is loaded and logged in
  await page.goto('https://mail.google.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(2000);

  if (page.url().includes('accounts.google.com')) {
    log('Not logged into Gmail. Please log in, then press Enter.');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    await new Promise(r => rl.question('Press Enter after logging in... ', r));
    rl.close();
  }

  const results = { success: [], noButton: [], noEmails: [], partial: [], failed: [] };

  for (const sender of SENDERS) {
    try {
      const result = await tryUnsubscribe(page, sender);
      if (result === 'success')    results.success.push(sender);
      else if (result === 'no-button') results.noButton.push(sender);
      else if (result === 'no-emails') results.noEmails.push(sender);
      else if (result === 'partial')  results.partial.push(sender);
      await sleep(1000);
    } catch (err) {
      log(`  → ERROR: ${err.message}`);
      results.failed.push(sender);
    }
  }

  await context.close();

  const total = SENDERS.length;
  console.log('\n' + '═'.repeat(60));
  console.log(`Results for ${total} senders:`);
  console.log(`✓ Unsubscribed    : ${results.success.length}`);
  console.log(`⊘ No emails found : ${results.noEmails.length}`);
  console.log(`⚠ No unsub button : ${results.noButton.length}`);
  console.log(`? Partial         : ${results.partial.length}`);
  console.log(`✗ Failed          : ${results.failed.length}`);

  if (results.noButton.length > 0) {
    console.log('\nSenders needing manual unsubscribe (no Gmail button):');
    results.noButton.forEach(s => console.log(`  ${s}`));
  }
  if (results.partial.length > 0) {
    console.log('\nPartial (check manually):');
    results.partial.forEach(s => console.log(`  ${s}`));
  }
  if (results.failed.length > 0) {
    console.log('\nFailed (errors):');
    results.failed.forEach(s => console.log(`  ${s}`));
  }
}

main().catch(err => {
  console.error(`[unsub] Fatal: ${err.message}`);
  process.exit(1);
});
