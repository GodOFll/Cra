const { PlaywrightCrawler } = require('@crawlee/playwright');

class Crawler {
  constructor() {
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this.timeout = 120000;
  }

  // Simple browser crawling method - only basic extraction
  async crawlUrl(url) {
    try {
      // Validate URL
      if (!url || typeof url !== 'string') {
        throw new Error('Invalid URL provided');
      }

      // Add protocol if missing
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }

      console.log(`🌐 Starting basic browser extraction from: ${url}`);
      
      return await this.basicExtraction(url);

    } catch (error) {
      // Handle specific error types with more detailed messages
      if (error.message.includes('net::ERR_NAME_NOT_RESOLVED')) {
        throw new Error(`Domain not found: ${url}`);
      } else if (error.message.includes('net::ERR_CONNECTION_REFUSED')) {
        throw new Error(`Connection refused: ${url}`);
      } else if (error.message.includes('TimeoutError') || error.message.includes('timeout')) {
        throw new Error(`Request timeout: ${url}`);
      } else if (error.message.includes('net::ERR_')) {
        throw new Error(`Network error for ${url}: ${error.message}`);
      } else {
        console.error(`🔥 Crawler error details:`, error);
        throw new Error(`Failed to crawl ${url}: ${error.message}`);
      }
    }
  }

  // Basic extraction method (simplified)
  async basicExtraction(url) {
    return new Promise(async (resolve, reject) => {
      let extractedData = null;
      let crawlError = null;
      
      const crawler = new PlaywrightCrawler({
        maxRequestsPerCrawl: 1,
        requestHandlerTimeoutSecs: 60,
        launchContext: {
          launchOptions: {
            headless: true,
            args: [
              '--no-sandbox', 
              '--disable-setuid-sandbox', 
              '--disable-dev-shm-usage',
              '--disable-gpu',
              '--disable-web-security'
            ]
          },
          userAgent: this.userAgent
        },
        requestHandler: async ({ page }) => {
          try {
            console.log('⏳ Loading page...');
            await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
            await page.waitForTimeout(3000);

            // Basic page info extraction
            const title = await page.title() || '';
            const url_final = page.url();
            
            extractedData = {
              url: url_final,
              title: title.trim(),
              message: 'Basic extraction completed - use Content Box Extractor for detailed content analysis',
              extractedAt: new Date().toISOString(),
              extractionMethod: 'Basic Crawler'
            };
            
            console.log(`✅ Basic extraction completed for: ${title}`);
            
          } catch (error) {
            console.error('❌ Error during basic extraction:', error);
            crawlError = error;
          }
        },
        failedRequestHandler: async ({ request, error }) => {
          console.error(`❌ Basic crawling failed for ${request.url}: ${error.message}`);
          crawlError = error;
        }
      });

      try {
        await crawler.addRequests([url]);
        await crawler.run();
        await crawler.teardown();

        if (crawlError) {
          reject(crawlError);
        } else if (!extractedData) {
          reject(new Error('No data was extracted'));
        } else {
          resolve(extractedData);
        }
      } catch (error) {
        console.error(`🔥 Crawler error:`, error);
        reject(error);
      }
    });
  }
}

module.exports = new Crawler();
