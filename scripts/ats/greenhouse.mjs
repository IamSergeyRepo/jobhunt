// Greenhouse ATS form auto-filler
import { findByLabel, safeUploadResume, clearAndFill } from './utils.mjs';

/**
 * Auto-fill a Greenhouse application form.
 * Never clicks submit. Returns true if form was found and filled.
 */
export async function fillGreenhouse(page, profile) {
  // Click "Apply" button if on job listing page
  const applyBtn = await page.$('a[href*="/apply"], button:has-text("Apply"), a:has-text("Apply for this job")');
  if (applyBtn) {
    await applyBtn.click();
    await page.waitForTimeout(2000);
  }

  // Wait for the application form
  const formSelector = '#application_form, #application-form, .application--form, form[action*="applications"], #application';
  const form = await page.$(formSelector).catch(() => null);
  if (!form) {
    try {
      await page.waitForSelector(formSelector, { timeout: 10000 });
    } catch {
      return false;
    }
  }

  let filled = 0;

  // First name
  const firstNameFilled =
    await clearAndFill(page, '#first_name', profile.firstName) ||
    await clearAndFill(page, 'input[name="first_name"]', profile.firstName) ||
    await clearAndFill(page, 'input[autocomplete="given-name"]', profile.firstName);
  if (!firstNameFilled) {
    const el = await findByLabel(page, 'First name');
    if (el) await clearAndFill(page, el, profile.firstName);
  }
  filled++;

  // Last name
  const lastNameFilled =
    await clearAndFill(page, '#last_name', profile.lastName) ||
    await clearAndFill(page, 'input[name="last_name"]', profile.lastName) ||
    await clearAndFill(page, 'input[autocomplete="family-name"]', profile.lastName);
  if (!lastNameFilled) {
    const el = await findByLabel(page, 'Last name');
    if (el) await clearAndFill(page, el, profile.lastName);
  }
  filled++;

  // Email
  const emailFilled =
    await clearAndFill(page, '#email', profile.email) ||
    await clearAndFill(page, 'input[name="email"]', profile.email) ||
    await clearAndFill(page, 'input[type="email"]', profile.email) ||
    await clearAndFill(page, 'input[autocomplete="email"]', profile.email);
  if (!emailFilled) {
    const el = await findByLabel(page, 'Email');
    if (el) await clearAndFill(page, el, profile.email);
  }
  filled++;

  // Phone — handle separate country code selector if present
  let phone = profile.phone;
  const countryInput = await page.$('input#country').catch(() => null);
  if (countryInput && phone.startsWith('+1')) {
    // Strip +1 prefix for US numbers
    phone = phone.slice(2).replace(/^\s*/, '');
    try {
      // Find the dropdown button near the country input
      const btn = await page.evaluateHandle(() => {
        const input = document.querySelector('input#country');
        const fieldset = input?.closest('fieldset') || input?.closest('div');
        return fieldset?.querySelector('button.icon-button');
      });
      if (btn) {
        await btn.click();
        await page.waitForTimeout(500);
        // Select "United States +1" — first option
        const option = await page.$('[id^="react-select-country-option-0"]');
        if (option) {
          await option.click();
        }
        await page.waitForTimeout(300);
      }
    } catch { /* continue with phone fill */ }
  }
  const phoneFilled =
    await clearAndFill(page, '#phone', phone) ||
    await clearAndFill(page, 'input[name="phone"]', phone) ||
    await clearAndFill(page, 'input[type="tel"]', phone) ||
    await clearAndFill(page, 'input[autocomplete="tel"]', phone);
  if (!phoneFilled) {
    const el = await findByLabel(page, 'Phone');
    if (el) await clearAndFill(page, el, phone);
  }
  filled++;

  // Resume upload
  if (profile.resumePath) {
    const uploaded = await safeUploadResume(page, profile.resumePath);
    if (uploaded) filled++;
  }

  // LinkedIn (optional)
  if (profile.linkedin) {
    const linkedinFilled =
      await clearAndFill(page, 'input[name*="linkedin" i]', profile.linkedin) ||
      await clearAndFill(page, 'input[id*="linkedin" i]', profile.linkedin) ||
      await clearAndFill(page, 'input[placeholder*="linkedin" i]', profile.linkedin) ||
      await clearAndFill(page, 'input[aria-label*="linkedin" i]', profile.linkedin);
    if (!linkedinFilled) {
      const el = await findByLabel(page, 'LinkedIn');
      if (el) await clearAndFill(page, el, profile.linkedin);
    }
  }

  console.log(`  Greenhouse: filled ${filled} fields`);
  return true;
}
