import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const page=await browser.newPage();
  await page.goto('http://127.0.0.1:4173');
  await page.locator('#project-input').setInputFiles('test-results/full.replay');
  await expect(page.locator('.note-card')).toHaveCount(2);
  await page.locator('.note-card [data-edit-marker]').first().click();
  const original=await page.locator('#marker-track').inputValue();
  const other=await page.locator('#marker-track option').evaluateAll((options,id)=>options.find(o=>o.value!==id).value,original);
  const otherRow=page.locator(`.track-row[data-track="${other}"]`);
  await page.locator('#marker-text').fill('点击轨道不能移动此标记');
  await otherRow.locator('.timeline-label').click();
  await expect(page.locator('#marker-track')).toHaveValue(original);
  await page.locator('#marker-text').fill('空白轨道点击后仍保持所属轨道');
  await otherRow.locator('.timeline-content').click({position:{x:30,y:20}});
  await expect(page.locator('#marker-track')).toHaveValue(original);
  await expect(page.locator(`.track-row[data-track="${original}"] .marker-chip`).filter({hasText:'空白轨道点击后'})).toHaveCount(1);
  await page.locator('#add-track').click();await page.locator('#track-name-input').fill('重绘测试');await page.locator('#track-submit').click();
  await expect(page.locator('#marker-track')).toHaveValue(original);
  await page.locator('#marker-track').selectOption(other);
  await expect(page.locator(`.track-row[data-track="${other}"] .marker-chip`).filter({hasText:'空白轨道点击后'})).toHaveCount(1);
  await expect(page.locator(`.track-row[data-track="${original}"] .marker-chip`).filter({hasText:'空白轨道点击后'})).toHaveCount(0);
  await page.locator('#undo').click();
  await expect(page.locator(`.track-row[data-track="${original}"] .marker-chip`).filter({hasText:'空白轨道点击后'})).toHaveCount(1);
  console.log('PASS: track label/body clicks and rerenders preserve assignment; only editor selector moves marker; undo restores assignment.');
} finally {await browser.close();}
