const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// هيكلية حفظ الأخطاء
const testErrors = {
  login: [],
  create: [],
  update: [],
  delete: [],
  general: []
};

test.describe('فحص أخطاء الواجهة الأمامية (Frontend E2E Error Monitor)', () => {
  let pageErrors = [];
  let consoleErrors = [];
  let networkErrors = [];

  test.beforeEach(async ({ page }) => {
    pageErrors = [];
    consoleErrors = [];
    networkErrors = [];

    // استماع للأخطاء البرمجية غير المعالجة
    page.on('pageerror', (exception) => {
      pageErrors.push(exception.message);
    });

    // استماع لأخطاء الكونسول
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // استماع لطلبات الشبكة الفاشلة
    page.on('response', (response) => {
      if (response.status() >= 400) {
        networkErrors.push(`API Error [${response.status()}] URL: ${response.url()}`);
      }
    });
  });

  test.afterEach(async ({ page }, testInfo) => {
    // تصنيف وحفظ الأخطاء المكتشفة في هذا الاختبار الفرعي
    const allErrors = [
      ...pageErrors.map(e => `[Page Error] ${e}`),
      ...consoleErrors.map(c => `[Console Error] ${c}`),
      ...networkErrors.map(n => `[Network Error] ${n}`)
    ];

    // إضافة خطأ الفشل الخاص بالاختبار نفسه (مثل عدم القدرة على الاتصال أو تجاوز الوقت)
    if (testInfo.status !== 'passed' && testInfo.error) {
      const cleanMsg = testInfo.error.message ? testInfo.error.message.replace(/\u001b\[\d+m/g, '') : 'فشل غير معروف';
      allErrors.push(`[Execution Failure] ${cleanMsg}`);
    }

    if (allErrors.length > 0) {
      const reportPath = path.join(__dirname, '../test-errors-report.json');
      let currentReport = { login: [], create: [], update: [], delete: [], general: [] };
      
      if (fs.existsSync(reportPath)) {
        try {
          currentReport = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
        } catch (e) {
          // ignore parsing error, start fresh
        }
      }

      if (testInfo.title.includes('تسجيل الدخول')) {
        currentReport.login.push(...allErrors);
      } else if (testInfo.title.includes('إنشاء') || testInfo.title.includes('الرفع')) {
        currentReport.create.push(...allErrors);
      } else if (testInfo.title.includes('تعديل') || testInfo.title.includes('الإعدادات')) {
        currentReport.update.push(...allErrors);
      } else if (testInfo.title.includes('حذف')) {
        currentReport.delete.push(...allErrors);
      } else {
        currentReport.general.push(...allErrors);
      }

      fs.writeFileSync(reportPath, JSON.stringify(currentReport, null, 2), 'utf-8');
    }
  });


  test('1. فحص وتسجيل الدخول', async ({ page }) => {
    const targetUrl = process.env.TEST_URL || 'http://localhost:3000';
    const username = process.env.TEST_USERNAME || '';
    const password = process.env.TEST_PASSWORD || '';

    await page.goto(targetUrl);
    await page.waitForLoadState('networkidle');

    // إذا كانت هناك حقول تسجيل دخول، نملؤها
    const usernameInput = page.locator('input[type="text"], input[type="email"], input[placeholder*="المستخدم"], input[name*="user"]').first();
    const passwordInput = page.locator('input[type="password"], input[placeholder*="مرور"], input[name*="pass"]').first();
    const submitBtn = page.locator('button[type="submit"], button:has-text("دخول"), button:has-text("تسجيل")').first();

    if (await usernameInput.isVisible() && await passwordInput.isVisible()) {
      if (username) await usernameInput.fill(username);
      if (password) await passwordInput.fill(password);
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        await page.waitForLoadState('networkidle');
      }
    } else {
      console.log('💡 لم يتم العثور على نموذج تسجيل دخول، سيتم التخطي وافتراض الدخول المباشر.');
    }
  });

  test('2. فحص عملية الإنشاء (الرفع برابط خارجي)', async ({ page }) => {
    const targetUrl = process.env.TEST_URL || 'http://localhost:3000';
    await page.goto(targetUrl);
    await page.waitForLoadState('networkidle');

    // الضغط على وضع الرفع "رابط خارجي"
    const urlModeBtn = page.locator('button:has-text("رابط خارجي")');
    if (await urlModeBtn.isVisible()) {
      await urlModeBtn.click();
      
      // إدخال رابط وهمي للتحقق
      const urlInput = page.locator('input[type="url"]');
      if (await urlInput.isVisible()) {
        await urlInput.fill('http://localhost:3031/temp_upload_test.png');
        
        const submitBtn = page.locator('button:has-text("استيراد من Google Drive"), button:has-text("رابط خارجي")').first();
        if (await submitBtn.isVisible()) {
          // نضغط على الزر ونتابع الاستجابة
          await submitBtn.click();
          // ننتظر قليلاً لنرى إذا كان هناك أي خطأ API أو خطأ برمجية ينطلق عند الإرسال
          await page.waitForTimeout(3000);
        }
      }
    } else {
      console.log('⚠️ لم يتم العثور على زر رفع "رابط خارجي" في الصفحة الرئيسية.');
    }
  });

  test('3. فحص عملية التعديل (صفحة الإعدادات)', async ({ page }) => {
    const targetUrl = process.env.TEST_URL || 'http://localhost:3000';
    await page.goto(`${targetUrl}/settings`);
    await page.waitForLoadState('networkidle');

    // فحص وتعديل مدخلات الإعدادات
    const minMaskAreaInput = page.locator('input[type="number"]').first();
    if (await minMaskAreaInput.isVisible()) {
      const currentValue = await minMaskAreaInput.inputValue();
      const newValue = String(parseInt(currentValue || '500') + 10);
      
      // كتابة قيمة جديدة لتحديث الإعدادات محلياً
      await minMaskAreaInput.fill(newValue);
      await minMaskAreaInput.dispatchEvent('change');
      
      // ننتظر قليلاً لحفظ الإعدادات تلقائياً محلياً ورصد الأخطاء
      await page.waitForTimeout(2000);
    } else {
      console.log('⚠️ لم يتم العثور على مدخلات تعديل في صفحة الإعدادات.');
    }
  });
});
