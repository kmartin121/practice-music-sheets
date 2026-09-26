import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures');

test('blank sheet opens and score canvas is visible', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('library')).toBeVisible();
  await page.getByTestId('new-blank').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('score-canvas')).toBeVisible();
  await expect(page.getByTestId('note-palette')).toBeVisible();
});

test('opening a MusicXML file shows measures', async ({ page }) => {
  await page.goto('/');
  const xmlPath = resolve(fixtures, 'sample-melody.musicxml');
  await page.getByTestId('open-musicxml-file').setInputFiles(xmlPath);
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.locator('.score-title')).toHaveText('Sample Melody');
  await expect(page.getByTestId('musicxml-panel')).toBeVisible();
  await expect(page.locator('.score-svg svg')).toBeVisible();
});

test('mocked OMR import loads MusicXML into the editor', async ({ page }) => {
  const xml = readFileSync(resolve(fixtures, 'sample-melody.musicxml'), 'utf8');
  await page.route('**/omr', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/xml',
      body: xml,
    });
  });

  await page.goto('/');
  await page.getByTestId('import-scan').setInputFiles(resolve(fixtures, 'tiny.png'));
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('musicxml-panel')).toBeVisible();
  await expect(page.getByTestId('omr-summary')).toContainText('notes');
  await expect(page.locator('.score-svg svg')).toBeVisible();
});

test('print stylesheet keeps score visible under print media', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('new-blank').click();
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByTestId('score-canvas')).toBeVisible();
  await expect(page.getByTestId('note-palette')).toBeHidden();
});
