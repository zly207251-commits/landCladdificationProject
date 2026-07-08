const readline = require('readline');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function run() {
  console.log('\n======================================================');
  console.log('🤖 نظام فحص أخطاء الواجهة الأمامية للوكيل الجغرافي');
  console.log('======================================================\n');

  let testUrl = await askQuestion('🔗 أدخل عنوان الموقع (الافتراضي: http://localhost:3000): ');
  if (!testUrl.trim()) {
    testUrl = 'http://localhost:3000';
  }

  const username = await askQuestion('👤 اسم المستخدم: ');
  const password = await askQuestion('🔑 كلمة المرور: ');

  console.log('\n🚀 جاري بدء الفحص التلقائي للصفحات والعمليات...');
  console.log(`📍 العنوان المستهدف: ${testUrl}`);
  console.log('⏳ يرجى الانتظار، جاري رصد الكونسول وطلبات الشبكة...\n');

  rl.close();

  // إعداد المتغيرات البيئية للاختبار
  const env = {
    ...process.env,
    TEST_URL: testUrl,
    TEST_USERNAME: username,
    TEST_PASSWORD: password
  };

  const reportPath = path.join(__dirname, '../test-errors-report.json');
  
  // مسح أي تقرير قديم إذا وجد
  if (fs.existsSync(reportPath)) {
    fs.unlinkSync(reportPath);
  }

  // تشغيل Playwright
  exec('npx playwright test tests/frontend-e2e.spec.js --project=chromium', { env }, (error, stdout, stderr) => {
    console.log('======================================================');
    console.log('📋 تقرير الفحص النهائي (E2E Test Report)');
    console.log('======================================================\n');

    if (fs.existsSync(reportPath)) {
      try {
        const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
        let hasErrors = false;

        // دالة لعرض الأخطاء بشكل منسق
        const printCategoryErrors = (title, list) => {
          if (list && list.length > 0) {
            hasErrors = true;
            console.log(`❌ أخطاء في مرحلة [ ${title} ]:`);
            list.forEach((err, idx) => {
              console.log(`   ${idx + 1}. ${err}`);
            });
            console.log();
          } else {
            console.log(`✅ لا توجد أخطاء في مرحلة [ ${title} ]`);
            console.log();
          }
        };

        printCategoryErrors('تسجيل الدخول / المصادقة', report.login);
        printCategoryErrors('الإنشاء / رفع الصور والروابط', report.create);
        printCategoryErrors('التعديل / تحديث الإعدادات والبيانات', report.update);
        printCategoryErrors('الحذف / إلغاء العمليات', report.delete);

        if (report.general && report.general.length > 0) {
          printCategoryErrors('أخطاء عامة في الصفحة', report.general);
        }

        if (!hasErrors) {
          console.log('🎉 ممتاز! لم يتم العثور على أي أخطاء كونسول أو أخطاء شبكة (API Errors) أثناء الفحص.');
        } else {
          console.log('⚠️ تم اكتشاف بعض المشاكل والأخطاء البرمجية. يرجى مراجعة التفاصيل أعلاه وتعديل الكود.');
        }

      } catch (e) {
        console.log('❌ خطأ أثناء قراءة تقرير الأخطاء:', e.message);
      }
    } else {
      console.log('❌ فشل تشغيل الفحص أو لم يتم إنشاء تقرير.');
      console.log('stdout:', stdout);
      console.log('stderr:', stderr);
    }
    console.log('\n======================================================');
  });
}

run().catch(err => {
  console.error('حدث خطأ غير متوقع:', err);
  rl.close();
});
