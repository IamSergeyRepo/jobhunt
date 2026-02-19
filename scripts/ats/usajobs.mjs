// USAJobs ATS handler
// Flow: job listing → click Apply → select saved resume → stop for manual questionnaire
import { safeUploadResume } from './utils.mjs';

/**
 * Handle a USAJobs application.
 * Clicks Apply, selects a saved resume (or uploads one), then stops
 * at the questionnaire step for manual completion.
 *
 * @param {import('playwright').Page} page - Current page on usajobs.gov listing
 * @param {import('playwright').BrowserContext} context - Browser context (for new tab handling)
 * @param {object} profile - Applicant profile from env vars
 * @returns {Promise<boolean>} true if resume step was handled successfully
 */
export async function fillUsajobs(page, context, profile) {
  // ── Check for closed/already-applied positions ──────────────────────
  const bodyText = await page.innerText('body').catch(() => '');
  if (/no longer accepting/i.test(bodyText) || /position.*closed/i.test(bodyText)) {
    console.log('    Position is no longer accepting applications');
    return false;
  }
  if (/already applied/i.test(bodyText) || /you have applied/i.test(bodyText)) {
    console.log('    Already applied to this position');
    return false;
  }

  // ── Click Apply button ──────────────────────────────────────────────
  // Wait for the page to fully render (Apply button is loaded via JS)
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);

  // Find the Apply button using JS evaluation to get the right visible one.
  // USAJobs renders the Apply button in the top-right header area.
  const applyHref = await page.evaluate(() => {
    // Strategy 1: find links with href containing "apply" that are visible
    const links = document.querySelectorAll('a[href*="apply"]');
    for (const link of links) {
      const rect = link.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0 && rect.top < 500) {
        // Visible and in the top portion of the page (header area)
        return link.href;
      }
    }
    // Strategy 2: find any visible element with "Apply" text in the header
    const allLinks = document.querySelectorAll('a, button');
    for (const el of allLinks) {
      const text = el.textContent?.trim();
      if (text === 'Apply' || text === 'Apply Now') {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return el.href || '__click__';
        }
      }
    }
    return null;
  });

  if (!applyHref) {
    console.log('    Could not find Apply button');
    return false;
  }

  // Apply may open a new tab — listen before clicking
  const newPagePromise = context.waitForEvent('page', { timeout: 10000 }).catch(() => null);

  if (applyHref === '__click__') {
    // Element doesn't have href — click it directly
    await page.evaluate(() => {
      const allEls = document.querySelectorAll('a, button');
      for (const el of allEls) {
        if ((el.textContent?.trim() === 'Apply' || el.textContent?.trim() === 'Apply Now') &&
            el.getBoundingClientRect().width > 0) {
          el.click();
          return;
        }
      }
    });
  } else {
    // Navigate directly to the apply URL (most reliable)
    await page.goto(applyHref, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  }

  let appPage = await newPagePromise;
  if (appPage) {
    // New tab opened — switch to it
    await appPage.waitForLoadState('domcontentloaded');
  } else {
    // Same tab — wait for navigation
    await page.waitForTimeout(3000);
    appPage = page;
  }

  const appUrl = appPage.url();

  // ── Check for login.gov redirect (session expired) ────────────────
  if (/login\.gov/i.test(appUrl) || /secure\.login/i.test(appUrl)) {
    console.log('    Login.gov session expired — log in manually via the browser');
    return false;
  }

  // ── Check for external agency portal ──────────────────────────────
  if (!/usastaffing\.gov/i.test(appUrl) && !/usajobs\.gov/i.test(appUrl)) {
    console.log(`    External agency portal: ${appUrl}`);
    console.log('    Cannot auto-fill — complete manually');
    return false;
  }

  // ── Resume selection step (apply.usastaffing.gov) ─────────────────
  await appPage.waitForTimeout(2000);

  // Try to select an existing saved resume (radio button or checkbox)
  const resumeSelected = await selectSavedResume(appPage);
  if (resumeSelected) {
    console.log('    Selected saved resume');
  } else if (profile.resumePath) {
    // Fallback: upload resume
    const uploaded = await safeUploadResume(appPage, profile.resumePath);
    if (uploaded) {
      console.log('    Uploaded resume');
    } else {
      console.log('    Could not select or upload resume — do it manually');
      return false;
    }
  } else {
    console.log('    No saved resume found and no file to upload — select manually');
    return false;
  }

  // ── Advance past resume step ──────────────────────────────────────
  const nextBtn = await appPage.$(
    'button:has-text("Next"), ' +
    'button:has-text("Continue"), ' +
    'input[type="submit"][value*="Next"], ' +
    'input[type="submit"][value*="Continue"]'
  );
  if (nextBtn) {
    await nextBtn.click();
    await appPage.waitForTimeout(2000);
    console.log('    Advanced past resume step — complete questionnaire manually');
  } else {
    console.log('    Resume step ready — click Next/Continue manually');
  }

  return true;
}

/**
 * Try to select the first saved resume on the application page.
 * USAStaffing typically shows radio buttons for previously uploaded resumes.
 */
async function selectSavedResume(page) {
  // Look for resume radio buttons / checkboxes
  const selectors = [
    'input[type="radio"][name*="resume" i]',
    'input[type="radio"][name*="Resume" i]',
    'input[type="radio"][id*="resume" i]',
    'input[type="checkbox"][name*="resume" i]',
    // USAStaffing specific patterns
    'input[type="radio"][name*="document" i]',
    '.resume-item input[type="radio"]',
    '.usa-radio input[type="radio"]',
  ];

  for (const selector of selectors) {
    const radios = await page.$$(selector);
    if (radios.length > 0) {
      // Select the first (most recent) resume
      await radios[0].check();
      return true;
    }
  }

  // Try clicking on a resume card/row (some portals use clickable divs)
  const resumeCard = await page.$(
    '[class*="resume" i]:not(button):not(a), ' +
    '[data-testid*="resume" i]'
  );
  if (resumeCard) {
    await resumeCard.click();
    return true;
  }

  return false;
}
