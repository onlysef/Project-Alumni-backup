const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto('http://localhost:5173');
  await page.evaluate(({ token, user }) => {
    localStorage.setItem('auth_token', token);
    localStorage.setItem('auth_user', JSON.stringify(user));
  }, { token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjZhMzAxY2NiYmM5MTE3OGVhMGFmNWQ5OSIsInJvbGUiOiJhbHVtbmkiLCJpYXQiOjE3ODE1ODc4ODUsImV4cCI6MTc4MjE5MjY4NX0.ZVv-ydkCqBvFvFpfOsbbjQCycV4uhVK3P-UEGsAHsw4', user: {"id":"6a301ccbbc91178ea0af5d99","firstName":"Viali","lastName":"Diola","email":"infamousenigma2002@gmail.com","role":"alumni","course":"BSIS","graduationYear":2022,"tracerStudyCompleted":true} });

  await page.goto('http://localhost:5173/alumni/tracer-study');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'verify_01_loaded.png' });

  // Page 1: agree and next
  await page.locator('input[type=radio][value="Agree"]').click();
  await page.locator('button:has-text("Next")').click();
  await page.waitForTimeout(400);

  // Page 2: pick a gender radio
  await page.locator('input[type=radio]').first().click();
  await page.locator('button:has-text("Next")').click();
  await page.waitForTimeout(400);

  // Page 3: tick first program checkbox, pick "No exam" option
  await page.locator('input[type=checkbox]').first().click();
  const selects = page.locator('select');
  await selects.first().selectOption({ index: 3 });
  await page.locator('button:has-text("Next")').click();
  await page.waitForTimeout(400);

  // Page 4 — blank (no selection yet)
  await page.screenshot({ path: 'verify_02_employment_blank.png' });

  // Select "No"
  await page.locator('select').first().selectOption('No');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'verify_03_no.png' });

  // Select "Yes"
  await page.locator('select').first().selectOption('Yes');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'verify_04_yes.png' });

  // Select "Never Employed"
  await page.locator('select').first().selectOption('Never Employed');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'verify_05_never_employed.png' });

  await browser.close();
  console.log('DONE');
})();
