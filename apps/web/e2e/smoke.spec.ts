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
  await expect(page.getByTestId('scan-queue')).toBeVisible();
  await page.getByTestId('scan-queue-build').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  await expect(page.getByTestId('musicxml-panel')).toBeVisible();
  await expect(page.getByTestId('omr-summary')).toContainText('notes');
  await expect(page.locator('.score-svg svg')).toBeVisible();
});

test('mocked multi-page OMR builds one score from the queue', async ({ page }) => {
  const xml = readFileSync(resolve(fixtures, 'sample-melody.musicxml'), 'utf8');
  let omrCalls = 0;
  await page.route('**/omr', async (route) => {
    omrCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/xml',
      body: xml,
    });
  });

  await page.goto('/');
  await page.getByTestId('import-scan').setInputFiles([
    resolve(fixtures, 'tiny.png'),
    resolve(fixtures, 'tiny.png'),
  ]);
  await expect(page.getByTestId('scan-queue')).toBeVisible();
  await expect(page.getByTestId('scan-queue').locator('.scan-queue-item')).toHaveCount(2);
  await page.getByTestId('scan-queue-build').click();
  await expect(page.getByTestId('editor')).toBeVisible();
  // sample-melody has 2 measures; two pages → 4 measures after merge
  await expect(page.locator('.measure-hit')).toHaveCount(4);
  expect(omrCalls).toBe(2);
});

test('print stylesheet keeps score visible under print media', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('new-blank').click();
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByTestId('score-canvas')).toBeVisible();
  await expect(page.getByTestId('note-palette')).toBeHidden();
  const svg = page.locator('.score-svg svg');
  await expect(svg).toBeVisible();
  const { svgWidth, pageWidth } = await page.evaluate(() => {
    const el = document.querySelector('.score-svg svg');
    const scorePage = document.querySelector('.score-page');
    return {
      svgWidth: el?.getBoundingClientRect().width ?? 0,
      pageWidth: scorePage?.getBoundingClientRect().width ?? 0,
    };
  });
  expect(pageWidth).toBeGreaterThan(0);
  // Four-measure system scales to the printable page content width.
  expect(Math.abs(svgWidth - pageWidth)).toBeLessThan(2);
});

test('print keeps memorize cues for practice-hidden measures', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('new-blank').click();
  await page.getByTestId('practice-toggle').click();
  await page.locator('.measure-hit').first().click();
  await expect(page.locator('.hidden-measure-cue')).toHaveCount(1);

  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.hidden-measure-cue')).toBeVisible();
  await expect(page.locator('.hidden-measure-cue-label')).toHaveText('memorize');
  await expect(page.locator('.measure-hit:visible')).toHaveCount(0);
});
