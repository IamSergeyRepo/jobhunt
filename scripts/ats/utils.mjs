// Shared helpers for ATS form filling

/**
 * Find an input element associated with a label containing the given text.
 * Tries: label[for] → input, label wrapping input, aria-label.
 */
export async function findByLabel(page, labelText) {
  const labelRegex = new RegExp(labelText, 'i');

  // Try label with 'for' attribute
  const labels = await page.$$('label');
  for (const label of labels) {
    const text = await label.innerText().catch(() => '');
    if (labelRegex.test(text)) {
      const forAttr = await label.getAttribute('for');
      if (forAttr) {
        const input = await page.$(`#${CSS.escape(forAttr)}`);
        if (input) return input;
      }
      // Label wrapping an input
      const nested = await label.$('input, textarea, select');
      if (nested) return nested;
    }
  }

  // Try aria-label
  const ariaInput = await page.$(`input[aria-label*="${labelText}" i], textarea[aria-label*="${labelText}" i]`);
  if (ariaInput) return ariaInput;

  // Try placeholder
  const placeholderInput = await page.$(`input[placeholder*="${labelText}" i], textarea[placeholder*="${labelText}" i]`);
  if (placeholderInput) return placeholderInput;

  return null;
}

/**
 * Upload a resume file, targeting the file input near a "Resume" or "CV" label.
 * Returns true if upload succeeded, false otherwise.
 */
export async function safeUploadResume(page, resumePath) {
  if (!resumePath) return false;

  const { existsSync } = await import('node:fs');
  if (!existsSync(resumePath)) {
    console.log(`  Resume file not found: ${resumePath}`);
    return false;
  }

  // Find file inputs
  const fileInputs = await page.$$('input[type="file"]');
  if (fileInputs.length === 0) return false;

  // If only one file input, use it
  if (fileInputs.length === 1) {
    await fileInputs[0].setInputFiles(resumePath);
    return true;
  }

  // Multiple file inputs — find the one near "Resume" or "CV"
  for (const input of fileInputs) {
    const parent = await input.evaluateHandle(el => {
      let node = el;
      for (let i = 0; i < 5; i++) {
        node = node.parentElement;
        if (!node) break;
      }
      return node || el.parentElement;
    });

    const text = await parent.evaluate(el => el?.innerText || '').catch(() => '');
    if (/resume|cv|curriculum/i.test(text) && !/cover\s*letter/i.test(text)) {
      await input.setInputFiles(resumePath);
      return true;
    }
  }

  // Fallback: use the first file input
  await fileInputs[0].setInputFiles(resumePath);
  return true;
}

/**
 * Clear a field and fill it with the given value.
 * Accepts a selector string or an ElementHandle.
 */
export async function clearAndFill(page, selectorOrHandle, value) {
  try {
    const el = typeof selectorOrHandle === 'string'
      ? await page.$(selectorOrHandle)
      : selectorOrHandle;
    if (!el) return false;

    await el.click();
    await el.fill('');
    await el.fill(value);
    return true;
  } catch {
    return false;
  }
}
