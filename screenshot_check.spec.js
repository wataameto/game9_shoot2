import { test, expect, chromium } from '@playwright/test';

test('capture boss visual check', async () => {
  // Launch in headful mode with GPU/WebGL enabled
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--use-gl=angle',
      '--enable-webgl'
    ]
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 }
  });
  const page = await context.newPage();
  
  await page.goto('http://localhost:5175/');
  
  const startButton = page.locator('#btn-start-3d');
  await expect(startButton).toBeVisible({ timeout: 5000 });
  await startButton.click();
  
  // Wait for intro cinematic to complete
  await page.waitForTimeout(6000);
  
  // Press 'B' key to trigger boss
  console.log("Pressing 'B' key...");
  await page.keyboard.press('b');
  
  // Wait for boss to spawn and camera to focus
  await page.waitForTimeout(3000);
  
  // Take screenshot
  const screenshotPath = '/Users/user/work/ai/game9_shoot_guruguru/boss_visual_check.png';
  await page.screenshot({ path: screenshotPath });
  console.log(`Screenshot saved to: ${screenshotPath}`);
  
  await browser.close();
});
