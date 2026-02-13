// Lever ATS form auto-filler
import { findByLabel, safeUploadResume, clearAndFill } from './utils.mjs';

/**
 * Auto-fill a Lever application form.
 * Never clicks submit. Returns true if form was found and filled.
 */
export async function fillLever(page, profile) {
  // If on listing page, navigate to /apply
  const currentUrl = page.url();
  if (!currentUrl.includes('/apply')) {
    const applyLink = await page.$('a[href*="/apply"], a.postings-btn-wrapper');
    if (applyLink) {
      await applyLink.click();
      await page.waitForTimeout(2000);
    } else {
      // Try navigating directly
      try {
        await page.goto(currentUrl.replace(/\/?$/, '/apply'), { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
      } catch {
        // Stay on current page
      }
    }
  }

  // Wait for the application form
  try {
    await page.waitForSelector('form, .application-form, [class*="application"]', { timeout: 10000 });
  } catch {
    return false;
  }

  let filled = 0;

  // Full name (Lever uses a single name field)
  const fullName = `${profile.firstName} ${profile.lastName}`;
  const nameFilled =
    await clearAndFill(page, 'input[name="name"]', fullName) ||
    await clearAndFill(page, 'input[name="fullName"]', fullName);
  if (!nameFilled) {
    const el = await findByLabel(page, 'Full name');
    if (el) await clearAndFill(page, el, fullName);
  }
  filled++;

  // Email
  const emailFilled =
    await clearAndFill(page, 'input[name="email"]', profile.email) ||
    await clearAndFill(page, 'input[type="email"]', profile.email);
  if (!emailFilled) {
    const el = await findByLabel(page, 'Email');
    if (el) await clearAndFill(page, el, profile.email);
  }
  filled++;

  // Phone
  const phoneFilled =
    await clearAndFill(page, 'input[name="phone"]', profile.phone) ||
    await clearAndFill(page, 'input[type="tel"]', profile.phone);
  if (!phoneFilled) {
    const el = await findByLabel(page, 'Phone');
    if (el) await clearAndFill(page, el, profile.phone);
  }
  filled++;

  // Resume upload
  if (profile.resumePath) {
    const uploaded = await safeUploadResume(page, profile.resumePath);
    if (uploaded) filled++;
  }

  // LinkedIn URL (optional)
  if (profile.linkedin) {
    const linkedinFilled =
      await clearAndFill(page, 'input[name*="linkedin" i]', profile.linkedin) ||
      await clearAndFill(page, 'input[name="urls[LinkedIn]"]', profile.linkedin) ||
      await clearAndFill(page, 'input[placeholder*="linkedin" i]', profile.linkedin);
    if (!linkedinFilled) {
      const el = await findByLabel(page, 'LinkedIn');
      if (el) await clearAndFill(page, el, profile.linkedin);
    }
  }

  console.log(`  Lever: filled ${filled} fields`);
  return true;
}
