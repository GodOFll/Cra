
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// تنظیمات اصلی
const CRAWLER_API_URL = 'http://localhost:5000';

// لیست URL های تست
const TEST_URLS = [
  'https://coincentral.com/shiba-inu-price-forecast-2025-whales-signal-growth-as-bullzilla-joins-the-best-crypto-presales-to-buy-now/'
];

// رنگ‌ها برای نمایش
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bright: '\x1b[1m'
};

// تابع نمایش محتوای استخراج شده با تأکید بر ترتیب HTML
function displayExtractedContent(result) {
  if (!result.success || !result.extractedData || !result.extractedData.blocks) {
    console.log(`${colors.red}      ❌ محتوایی برای نمایش وجود ندارد${colors.reset}`);
    return;
  }

  const blocks = result.extractedData.blocks;
  console.log(`${colors.cyan}      📦 تعداد بلوک‌های محتوا: ${blocks.length}${colors.reset}`);
  
  // Check if HTML order is preserved
  if (result.extractedData.extractionMethod && result.extractedData.extractionMethod.includes('sequential')) {
    console.log(`${colors.green}      ✅ ترتیب HTML حفظ شده است${colors.reset}`);
  }
  
  if (blocks.length > 0) {
    console.log(`${colors.yellow}      📋 نمونه محتوای استخراج شده (به ترتیب HTML):${colors.reset}`);
    
    // نمایش حداکثر 8 بلوک اول برای بررسی بهتر ترتیب
    const sampleBlocks = blocks.slice(0, 8);
    
    sampleBlocks.forEach((block, index) => {
      const orderInfo = block._meta && block._meta.documentOrder ? 
        ` [ترتیب: ${block._meta.documentOrder}]` : '';
      
      console.log(`${colors.blue}        ${index + 1}.${orderInfo} ${colors.reset}`);
      
      if (block.title) {
        console.log(`${colors.bright}        📰 عنوان: ${block.title.substring(0, 70)}${block.title.length > 70 ? '...' : ''}${colors.reset}`);
        if (block._meta && block._meta.tag) {
          console.log(`${colors.blue}        🏷️ تگ: ${block._meta.tag}${colors.reset}`);
        }
      } else if (block.content) {
        console.log(`${colors.green}        📄 متن: ${block.content.substring(0, 70)}${block.content.length > 70 ? '...' : ''}${colors.reset}`);
        if (block._meta && block._meta.tag) {
          console.log(`${colors.blue}        🏷️ تگ: ${block._meta.tag}${colors.reset}`);
        }
      } else if (block.image) {
        console.log(`${colors.yellow}        🖼️ تصویر: ${block.image.substring(0, 50)}${block.image.length > 50 ? '...' : ''}${colors.reset}`);
        if (block.alt) {
          console.log(`${colors.yellow}        📝 توضیح: ${block.alt.substring(0, 50)}${colors.reset}`);
        }
      }
      
      if (block.link) {
        console.log(`${colors.cyan}        🔗 لینک: ${block.link.substring(0, 50)}${block.link.length > 50 ? '...' : ''}${colors.reset}`);
      }
      
      console.log(''); // خط فاصل
    });
    
    if (blocks.length > 8) {
      console.log(`${colors.yellow}      📊 ... و ${blocks.length - 8} بلوک دیگر${colors.reset}`);
    }
    
    // نمایش آمار ترتیب
    const hasOrder = blocks.filter(b => b._meta && b._meta.documentOrder).length;
    if (hasOrder > 0) {
      console.log(`${colors.green}      ✅ ${hasOrder} بلوک دارای اطلاعات ترتیب HTML هستند${colors.reset}`);
    }
  }
}

// تابع بررسی و نمایش فایل محتوا
async function checkAndDisplayContentFile(result) {
  if (!result.success || !result.contentFile) {
    return;
  }

  try {
    const contentPath = result.contentFile.filePath;
    if (fs.existsSync(contentPath)) {
      const contentData = JSON.parse(fs.readFileSync(contentPath, 'utf8'));
      
      console.log(`${colors.cyan}      💾 فایل محتوا: ${result.contentFile.fileName}${colors.reset}`);
      console.log(`${colors.blue}      📊 آمار فایل: ${result.contentFile.fileSize} بایت${colors.reset}`);
      console.log(`${colors.green}      🏷️ عنوان: ${contentData.title}${colors.reset}`);
      console.log(`${colors.yellow}      📝 تعداد بلوک‌ها: ${contentData.blocks ? contentData.blocks.length : 0}${colors.reset}`);
      console.log(`${colors.yellow}      📈 تعداد کلمات: ${contentData.totalWords || 0}${colors.reset}`);
      
      // نمایش نمونه محتوا از فایل
      if (contentData.blocks && contentData.blocks.length > 0) {
        console.log(`${colors.cyan}      📑 نمونه محتوای فایل:${colors.reset}`);
        const sampleBlocks = contentData.blocks.slice(0, 3);
        
        sampleBlocks.forEach((block, index) => {
          if (block.title) {
            console.log(`${colors.bright}        📰 ${block.title.substring(0, 60)}${block.title.length > 60 ? '...' : ''}${colors.reset}`);
          } else if (block.content) {
            console.log(`${colors.green}        📄 ${block.content.substring(0, 60)}${block.content.length > 60 ? '...' : ''}${colors.reset}`);
          } else if (block.image) {
            console.log(`${colors.yellow}        🖼️ ${block.image}${colors.reset}`);
          }
        });
      }
    }
  } catch (error) {
    console.log(`${colors.red}      ❌ خطا در خواندن فایل محتوا: ${error.message}${colors.reset}`);
  }
}

// تابع اصلی تست
async function testSmartCrawlerComplete() {
  console.log(`${colors.bright}${colors.cyan}🧠 تست کامل سیستم Smart Crawler${colors.reset}`);
  console.log(`${colors.blue}📅 شروع تست: ${new Date().toLocaleString('fa-IR')}${colors.reset}`);
  console.log(`${colors.blue}🌐 تعداد URL های تست: ${TEST_URLS.length}${colors.reset}\n`);

  // تولید شناسه یکتا برای درخواست
  const requestId = `smart-test-${Date.now()}`;
  
  try {
    console.log(`${colors.yellow}🚀 ارسال درخواست به سیستم Smart Crawler...${colors.reset}`);
    console.log(`${colors.blue}🆔 شناسه درخواست: ${requestId}${colors.reset}`);
    console.log(`${colors.blue}📋 URL های ارسالی:${colors.reset}`);
    
    TEST_URLS.forEach((url, index) => {
      console.log(`   ${index + 1}. ${url}`);
    });
    
    const startTime = Date.now();
    
    // ارسال درخواست به API هوشمند
    const response = await axios.post(`${CRAWLER_API_URL}/api/smart-crawl`, {
      urls: TEST_URLS,
      requestId: requestId,
      query: 'تست کامل سیستم خزنده هوشمند'
    }, {
      timeout: 600000, // 10 دقیقه timeout
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    const endTime = Date.now();
    const totalDuration = ((endTime - startTime) / 1000).toFixed(2);
    
    if (response.data.success) {
      console.log(`\n${colors.green}✅ سیستم Smart Crawler با موفقیت کار کرد!${colors.reset}`);
      console.log(`${colors.green}⏱️ زمان کل: ${totalDuration} ثانیه${colors.reset}`);
      
      const summary = response.data.summary;
      console.log(`\n${colors.bright}📊 خلاصه نتایج:${colors.reset}`);
      console.log(`${colors.blue}   🎯 کل URL ها: ${summary.total}${colors.reset}`);
      console.log(`${colors.green}   ✅ موفق: ${summary.successful}${colors.reset}`);
      console.log(`${colors.red}   ❌ ناموفق: ${summary.failed}${colors.reset}`);
      console.log(`${colors.cyan}   🚀 غیربرورزری موفق: ${summary.nonBrowserSuccesses}${colors.reset}`);
      console.log(`${colors.yellow}   🌐 برورزری موفق: ${summary.browserSuccesses}${colors.reset}`);
      
      console.log(`\n${colors.bright}📄 جزئیات نتایج و محتوای استخراج شده:${colors.reset}`);
      
      for (let index = 0; index < response.data.crawlResults.length; index++) {
        const result = response.data.crawlResults[index];
        
        if (result.success) {
          console.log(`${colors.green}   ✅ ${index + 1}. ${result.url}${colors.reset}`);
          console.log(`${colors.blue}      🔧 روش: ${result.method}${colors.reset}`);
          console.log(`${colors.blue}      ⏱️ زمان: ${result.processingTime}ms${colors.reset}`);
          
          if (result.extractedData && result.extractedData.title) {
            console.log(`${colors.yellow}      📰 عنوان: ${result.extractedData.title}${colors.reset}`);
          }
          
          if (result.extractedData && result.extractedData.totalItems) {
            console.log(`${colors.cyan}      📊 بلوک‌های محتوا: ${result.extractedData.totalItems}${colors.reset}`);
          }
          
          if (result.extractedData && result.extractedData.totalWords) {
            console.log(`${colors.cyan}      📝 تعداد کلمات: ${result.extractedData.totalWords}${colors.reset}`);
          }
          
          // نمایش محتوای استخراج شده
          displayExtractedContent(result);
          
          // بررسی و نمایش فایل محتوا
          await checkAndDisplayContentFile(result);
          
          console.log(''); // خط خالی برای جدا کردن نتایج
          
        } else {
          console.log(`${colors.red}   ❌ ${index + 1}. ${result.url}${colors.reset}`);
          console.log(`${colors.red}      🚫 خطا: ${result.error}${colors.reset}`);
        }
      }
      
      console.log(`\n${colors.bright}💾 فایل نتایج ذخیره شد در: ${response.data.savedFilePath}${colors.reset}`);
      
      // نمایش آمار هوشمندی
      if (summary.nonBrowserSuccesses > 0) {
        console.log(`\n${colors.bright}🧠 سیستم هوشمند بهینه کار کرد!${colors.reset}`);
        console.log(`${colors.green}   ${summary.nonBrowserSuccesses} URL با روش سریع غیربرورزری پردازش شد${colors.reset}`);
      }
      
      if (summary.browserSuccesses > 0) {
        console.log(`${colors.yellow}   ${summary.browserSuccesses} URL نیاز به برورزر داشت${colors.reset}`);
      }
      
      // نمایش آمار کلی محتوا
      const totalBlocks = response.data.crawlResults
        .filter(r => r.success && r.extractedData && r.extractedData.blocks)
        .reduce((sum, r) => sum + r.extractedData.blocks.length, 0);
      
      const totalWords = response.data.crawlResults
        .filter(r => r.success && r.extractedData && r.extractedData.totalWords)
        .reduce((sum, r) => sum + r.extractedData.totalWords, 0);
      
      console.log(`\n${colors.bright}📈 آمار کلی محتوای استخراج شده:${colors.reset}`);
      console.log(`${colors.cyan}   📦 کل بلوک‌های محتوا: ${totalBlocks}${colors.reset}`);
      console.log(`${colors.cyan}   📝 کل کلمات استخراج شده: ${totalWords}${colors.reset}`);
      
      console.log(`\n${colors.bright}${colors.green}🎉 تست کامل با موفقیت انجام شد!${colors.reset}`);
      
    } else {
      console.log(`\n${colors.red}❌ خطا در سیستم Smart Crawler: ${response.data.error}${colors.reset}`);
    }
    
  } catch (error) {
    console.error(`\n${colors.red}❌ خطای کلی: ${error.message}${colors.reset}`);
    
    if (error.code === 'ECONNREFUSED') {
      console.log(`${colors.yellow}💡 لطفاً مطمئن شوید که سرور Crawler روی ${CRAWLER_API_URL} در حال اجرا است${colors.reset}`);
      console.log(`${colors.yellow}   برای اجرا: npm start${colors.reset}`);
    }
    
    if (error.response) {
      console.log(`${colors.red}   وضعیت HTTP: ${error.response.status}${colors.reset}`);
      if (error.response.data) {
        console.log(`${colors.red}   جزئیات: ${JSON.stringify(error.response.data, null, 2)}${colors.reset}`);
      }
    }
  }
}

// تابع تست URL واحد
async function testSingleUrl(url) {
  console.log(`\n${colors.cyan}🧪 تست URL واحد: ${url}${colors.reset}`);
  
  const requestId = `single-test-${Date.now()}`;
  
  try {
    const response = await axios.post(`${CRAWLER_API_URL}/api/smart-crawl`, {
      urls: [url],
      requestId: requestId,
      query: `تست واحد برای ${url}`
    }, {
      timeout: 300000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (response.data.success && response.data.crawlResults[0].success) {
      const result = response.data.crawlResults[0];
      console.log(`${colors.green}✅ موفق: ${result.method} - ${result.processingTime}ms${colors.reset}`);
      
      if (result.extractedData && result.extractedData.title) {
        console.log(`${colors.yellow}📰 عنوان: ${result.extractedData.title}${colors.reset}`);
      }
      
      // نمایش محتوای استخراج شده
      displayExtractedContent(result);
      
      // بررسی و نمایش فایل محتوا
      await checkAndDisplayContentFile(result);
      
    } else {
      console.log(`${colors.red}❌ ناموفق${colors.reset}`);
    }
    
  } catch (error) {
    console.log(`${colors.red}❌ خطا: ${error.message}${colors.reset}`);
  }
}

// تابع اصلی
async function main() {
  console.log(`${colors.bright}${'='.repeat(60)}${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}   🧠 تست سیستم Smart Crawler   ${colors.reset}`);
  console.log(`${colors.bright}${'='.repeat(60)}${colors.reset}`);
  
  // بررسی وضعیت سرور
  try {
    console.log(`${colors.blue}🔍 بررسی وضعیت سرور...${colors.reset}`);
    const healthResponse = await axios.get(`${CRAWLER_API_URL}/health`, { timeout: 5000 });
    console.log(`${colors.green}✅ سرور آماده است: ${healthResponse.data.status}${colors.reset}`);
  } catch (error) {
    console.log(`${colors.red}❌ سرور در دسترس نیست!${colors.reset}`);
    console.log(`${colors.yellow}💡 لطفاً سرور را اجرا کنید: npm start${colors.reset}`);
    return;
  }
  
  // اجرای تست کامل
  await testSmartCrawlerComplete();
  
  console.log(`\n${colors.bright}${'='.repeat(60)}${colors.reset}`);
  console.log(`${colors.bright}${colors.green}   ✅ تست کامل پایان یافت   ${colors.reset}`);
  console.log(`${colors.bright}${'='.repeat(60)}${colors.reset}`);
}

// Export برای استفاده در سایر فایل‌ها
module.exports = {
  testSmartCrawlerComplete,
  testSingleUrl,
  TEST_URLS,
  displayExtractedContent,
  checkAndDisplayContentFile
};

// اجرا در صورت فراخوانی مستقیم
if (require.main === module) {
  main();
}
