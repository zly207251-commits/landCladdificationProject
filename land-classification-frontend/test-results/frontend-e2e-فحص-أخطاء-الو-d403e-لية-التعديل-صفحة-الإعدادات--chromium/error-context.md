# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: frontend-e2e.spec.js >> فحص أخطاء الواجهة الأمامية (Frontend E2E Error Monitor) >> 3. فحص عملية التعديل (صفحة الإعدادات)
- Location: tests\frontend-e2e.spec.js:140:3

# Error details

```
Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/settings
Call log:
  - navigating to "http://localhost:3000/settings", waiting until "load"

```

# Test source

```ts
  42  |   });
  43  | 
  44  |   test.afterEach(async ({ page }, testInfo) => {
  45  |     // تصنيف وحفظ الأخطاء المكتشفة في هذا الاختبار الفرعي
  46  |     const allErrors = [
  47  |       ...pageErrors.map(e => `[Page Error] ${e}`),
  48  |       ...consoleErrors.map(c => `[Console Error] ${c}`),
  49  |       ...networkErrors.map(n => `[Network Error] ${n}`)
  50  |     ];
  51  | 
  52  |     // إضافة خطأ الفشل الخاص بالاختبار نفسه (مثل عدم القدرة على الاتصال أو تجاوز الوقت)
  53  |     if (testInfo.status !== 'passed' && testInfo.error) {
  54  |       const cleanMsg = testInfo.error.message ? testInfo.error.message.replace(/\u001b\[\d+m/g, '') : 'فشل غير معروف';
  55  |       allErrors.push(`[Execution Failure] ${cleanMsg}`);
  56  |     }
  57  | 
  58  |     if (allErrors.length > 0) {
  59  |       const reportPath = path.join(__dirname, '../test-errors-report.json');
  60  |       let currentReport = { login: [], create: [], update: [], delete: [], general: [] };
  61  |       
  62  |       if (fs.existsSync(reportPath)) {
  63  |         try {
  64  |           currentReport = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  65  |         } catch (e) {
  66  |           // ignore parsing error, start fresh
  67  |         }
  68  |       }
  69  | 
  70  |       if (testInfo.title.includes('تسجيل الدخول')) {
  71  |         currentReport.login.push(...allErrors);
  72  |       } else if (testInfo.title.includes('إنشاء') || testInfo.title.includes('الرفع')) {
  73  |         currentReport.create.push(...allErrors);
  74  |       } else if (testInfo.title.includes('تعديل') || testInfo.title.includes('الإعدادات')) {
  75  |         currentReport.update.push(...allErrors);
  76  |       } else if (testInfo.title.includes('حذف')) {
  77  |         currentReport.delete.push(...allErrors);
  78  |       } else {
  79  |         currentReport.general.push(...allErrors);
  80  |       }
  81  | 
  82  |       fs.writeFileSync(reportPath, JSON.stringify(currentReport, null, 2), 'utf-8');
  83  |     }
  84  |   });
  85  | 
  86  | 
  87  |   test('1. فحص وتسجيل الدخول', async ({ page }) => {
  88  |     const targetUrl = process.env.TEST_URL || 'http://localhost:3000';
  89  |     const username = process.env.TEST_USERNAME || '';
  90  |     const password = process.env.TEST_PASSWORD || '';
  91  | 
  92  |     await page.goto(targetUrl);
  93  |     await page.waitForLoadState('networkidle');
  94  | 
  95  |     // إذا كانت هناك حقول تسجيل دخول، نملؤها
  96  |     const usernameInput = page.locator('input[type="text"], input[type="email"], input[placeholder*="المستخدم"], input[name*="user"]').first();
  97  |     const passwordInput = page.locator('input[type="password"], input[placeholder*="مرور"], input[name*="pass"]').first();
  98  |     const submitBtn = page.locator('button[type="submit"], button:has-text("دخول"), button:has-text("تسجيل")').first();
  99  | 
  100 |     if (await usernameInput.isVisible() && await passwordInput.isVisible()) {
  101 |       if (username) await usernameInput.fill(username);
  102 |       if (password) await passwordInput.fill(password);
  103 |       if (await submitBtn.isVisible()) {
  104 |         await submitBtn.click();
  105 |         await page.waitForLoadState('networkidle');
  106 |       }
  107 |     } else {
  108 |       console.log('💡 لم يتم العثور على نموذج تسجيل دخول، سيتم التخطي وافتراض الدخول المباشر.');
  109 |     }
  110 |   });
  111 | 
  112 |   test('2. فحص عملية الإنشاء (الرفع برابط خارجي)', async ({ page }) => {
  113 |     const targetUrl = process.env.TEST_URL || 'http://localhost:3000';
  114 |     await page.goto(targetUrl);
  115 |     await page.waitForLoadState('networkidle');
  116 | 
  117 |     // الضغط على وضع الرفع "رابط خارجي"
  118 |     const urlModeBtn = page.locator('button:has-text("رابط خارجي")');
  119 |     if (await urlModeBtn.isVisible()) {
  120 |       await urlModeBtn.click();
  121 |       
  122 |       // إدخال رابط وهمي للتحقق
  123 |       const urlInput = page.locator('input[type="url"]');
  124 |       if (await urlInput.isVisible()) {
  125 |         await urlInput.fill('http://localhost:3031/temp_upload_test.png');
  126 |         
  127 |         const submitBtn = page.locator('button:has-text("استيراد من Google Drive"), button:has-text("رابط خارجي")').first();
  128 |         if (await submitBtn.isVisible()) {
  129 |           // نضغط على الزر ونتابع الاستجابة
  130 |           await submitBtn.click();
  131 |           // ننتظر قليلاً لنرى إذا كان هناك أي خطأ API أو خطأ برمجية ينطلق عند الإرسال
  132 |           await page.waitForTimeout(3000);
  133 |         }
  134 |       }
  135 |     } else {
  136 |       console.log('⚠️ لم يتم العثور على زر رفع "رابط خارجي" في الصفحة الرئيسية.');
  137 |     }
  138 |   });
  139 | 
  140 |   test('3. فحص عملية التعديل (صفحة الإعدادات)', async ({ page }) => {
  141 |     const targetUrl = process.env.TEST_URL || 'http://localhost:3000';
> 142 |     await page.goto(`${targetUrl}/settings`);
      |                ^ Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3000/settings
  143 |     await page.waitForLoadState('networkidle');
  144 | 
  145 |     // فحص وتعديل مدخلات الإعدادات
  146 |     const minMaskAreaInput = page.locator('input[type="number"]').first();
  147 |     if (await minMaskAreaInput.isVisible()) {
  148 |       const currentValue = await minMaskAreaInput.inputValue();
  149 |       const newValue = String(parseInt(currentValue || '500') + 10);
  150 |       
  151 |       // كتابة قيمة جديدة لتحديث الإعدادات محلياً
  152 |       await minMaskAreaInput.fill(newValue);
  153 |       await minMaskAreaInput.dispatchEvent('change');
  154 |       
  155 |       // ننتظر قليلاً لحفظ الإعدادات تلقائياً محلياً ورصد الأخطاء
  156 |       await page.waitForTimeout(2000);
  157 |     } else {
  158 |       console.log('⚠️ لم يتم العثور على مدخلات تعديل في صفحة الإعدادات.');
  159 |     }
  160 |   });
  161 | });
  162 | 
```