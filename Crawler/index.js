const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crawler = require('./crawler');
const simpleTextExtractor = require('./simpleTextExtractor');
const smartCrawlerCoordinator = require('./smart-crawler-coordinator');
const database = require('./database-config');

const app = express();
const PORT = 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Security function to validate URLs and prevent SSRF
function validateUrl(url) {
  try {
    const urlObj = new URL(url);
    
    // Only allow http and https
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      throw new Error('Only HTTP and HTTPS protocols are allowed');
    }
    
    // Block private/internal IPs
    const hostname = urlObj.hostname.toLowerCase();
    if (hostname === 'localhost' || 
        hostname.startsWith('127.') || 
        hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        hostname.includes('internal') ||
        hostname.includes('local')) {
      throw new Error('Private/internal URLs are not allowed');
    }
    
    // Basic domain allowlist for high-security environments
    const allowedDomains = [
      'coindesk.com', 'crypto.news', 'cointelegraph.com', 'cryptonews.com',
      'reuters.com', 'bloomberg.com', 'techcrunch.com', 'news.bitcoin.com'
    ];
    
    // For demo purposes, allow all domains but log suspicious ones
    if (!allowedDomains.some(domain => hostname.includes(domain))) {
      console.log(`⚠️ Crawling non-allowlisted domain: ${hostname}`);
    }
    
    return true;
  } catch (error) {
    throw new Error(`Invalid URL: ${error.message}`);
  }
}

// Directory for storing crawl results
const resultsDir = path.join(__dirname, 'results');

// Ensure results directory exists
if (!fs.existsSync(resultsDir)) {
  fs.mkdirSync(resultsDir, { recursive: true });
  console.log('📁 Created results directory:', resultsDir);
}

// Initialize PostgreSQL database on startup with fallback
async function initializeDatabase() {
  try {
    console.log('🔗 Initializing PostgreSQL database...');
    
    // Check if DATABASE_URL is available
    if (!process.env.DATABASE_URL) {
      console.log('⚠️ DATABASE_URL not found, continuing without PostgreSQL (file storage only)');
      return false;
    }
    
    await database.ready();
    console.log('✅ PostgreSQL database ready for intelligent crawling');
    return true;
  } catch (error) {
    console.error('⚠️ Failed to initialize PostgreSQL database:', error.message);
    console.log('📁 Continuing with file storage only (PostgreSQL features disabled)');
    return false;
  }
}

// Initialize database and then run migration for legacy data
let postgreSQLAvailable = false;
initializeDatabase().then((available) => {
  postgreSQLAvailable = available;
  migrateLegacyData();
}).catch(error => {
  console.error('⚠️ Database initialization warning:', error);
  postgreSQLAvailable = false;
  migrateLegacyData();
});

// Function to sanitize requestId to safe characters only
function sanitizeRequestId(requestId) {
  if (!requestId || typeof requestId !== 'string') {
    throw new Error('Invalid requestId: must be a non-empty string');
  }

  const sanitized = requestId.trim().replace(/[^A-Za-z0-9_-]/g, '_');
  if (sanitized.length === 0) {
    throw new Error('Invalid requestId: results in empty string after sanitization');
  }

  return sanitized;
}

// Function to get file path for a specific request ID with security checks
function getRequestFilePath(requestId) {
  const sanitizedId = sanitizeRequestId(requestId);
  const filePath = path.join(resultsDir, `crawl_results_${sanitizedId}.json`);

  // Security guard: ensure the resolved path stays within resultsDir
  const resolvedPath = path.resolve(filePath);
  const resolvedResultsDir = path.resolve(resultsDir);

  if (!resolvedPath.startsWith(resolvedResultsDir + path.sep) && resolvedPath !== resolvedResultsDir) {
    throw new Error('Invalid requestId: path traversal attempt detected');
  }

  return filePath;
}

// Function to save crawl results for a specific request ID (FILTERED CONTENT ONLY)
function saveRequestResults(requestId, crawlResults, query) {
  try {
    const filePath = getRequestFilePath(requestId);
    
    // Filter results to remove any raw content - SUMMARY ONLY
    const filteredResults = crawlResults.map(result => ({
      url: result.url,
      success: result.success,
      method: result.method || 'unknown',
      processingTime: result.processingTime || 0,
      crawledAt: result.crawledAt,
      error: result.error,
      // Only store processed summary data, NO RAW CONTENT
      extractedData: result.extractedData ? {
        title: result.extractedData.title || 'Untitled',
        summary: result.extractedData.summary || 'No summary available',
        wordCount: result.extractedData.wordCount || 0,
        linkCount: result.extractedData.linkCount || 0,
        headingCount: result.extractedData.headingCount || 0,
        contentLength: result.extractedData.contentLength || 0,
        dataType: 'FILTERED_SUMMARY_ONLY'
      } : null
    }));

    const resultData = {
      requestId: requestId,
      query: query,
      crawledAt: new Date().toISOString(),
      totalUrls: filteredResults.length,
      successfulUrls: filteredResults.filter(r => r.success).length,
      dataPolicy: 'NO_RAW_CONTENT_STORED',
      results: filteredResults
    };

    fs.writeFileSync(filePath, JSON.stringify(resultData, null, 2), 'utf8');
    console.log(`💾 Saved ${filteredResults.length} FILTERED results to: ${filePath}`);
    return filePath;
  } catch (error) {
    console.error('Error saving request results:', error.message);
    throw error;
  }
}

// Function to load results for a specific request ID
function loadRequestResults(requestId) {
  try {
    const filePath = getRequestFilePath(requestId);
    if (fs.existsSync(filePath)) {
      const fileData = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(fileData);
    }
    return null;
  } catch (error) {
    console.error('Error loading request results:', error.message);
    return null;
  }
}

// Function to get all saved request IDs
function getAllRequestIds() {
  try {
    const files = fs.readdirSync(resultsDir);
    return files
      .filter(file => file.startsWith('crawl_results_') && file.endsWith('.json'))
      .map(file => file.replace('crawl_results_', '').replace('.json', ''));
  } catch (error) {
    console.error('Error reading results directory:', error.message);
    return [];
  }
}

// Migration function for legacy data
function migrateLegacyData() {
  const legacyFilePath = path.join(__dirname, 'crawled_data.json');

  if (!fs.existsSync(legacyFilePath)) {
    return; // No legacy data to migrate
  }

  try {
    console.log('🔄 Detecting legacy data file. Starting migration...');
    const legacyData = JSON.parse(fs.readFileSync(legacyFilePath, 'utf8'));

    if (!Array.isArray(legacyData) || legacyData.length === 0) {
      console.log('⚠️ Legacy file is empty or invalid. Skipping migration.');
      return;
    }

    // Group legacy data by requestId
    const groupedData = {};
    legacyData.forEach(item => {
      const requestId = item.requestId || 'unknown-legacy-request';
      if (!groupedData[requestId]) {
        groupedData[requestId] = {
          requestId: requestId,
          query: item.query || 'Legacy Query',
          crawledAt: item.crawledAt || new Date().toISOString(),
          results: []
        };
      }
      groupedData[requestId].results.push({
        url: item.url,
        success: item.success,
        extractedData: item.extractedData,
        error: item.error,
        crawledAt: item.crawledAt
      });
    });

    // Save each group as separate files
    let migratedCount = 0;
    Object.keys(groupedData).forEach(requestId => {
      const group = groupedData[requestId];
      group.totalUrls = group.results.length;
      group.successfulUrls = group.results.filter(r => r.success).length;

      const filePath = getRequestFilePath(requestId);
      if (!fs.existsSync(filePath)) { // Don't overwrite existing files
        fs.writeFileSync(filePath, JSON.stringify(group, null, 2), 'utf8');
        migratedCount++;
        console.log(`📁 Migrated requestId "${requestId}" with ${group.results.length} URLs`);
      } else {
        console.log(`⚠️ Skipping requestId "${requestId}" - file already exists`);
      }
    });

    // Backup the legacy file
    const backupPath = path.join(__dirname, 'crawled_data_backup.json');
    fs.copyFileSync(legacyFilePath, backupPath);
    fs.unlinkSync(legacyFilePath);

    console.log(`✅ Migration completed! Migrated ${migratedCount} request groups.`);
    console.log(`🗃️ Legacy file backed up to: ${backupPath}`);

  } catch (error) {
    console.error('❌ Error during migration:', error.message);
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', service: 'Crawler API', port: PORT });
});

// Receive URLs from Search API and crawl them
app.post('/api/crawl', async (req, res) => {
  console.log('📥 =================================');
  console.log('📥 NEW CRAWL REQUEST RECEIVED');
  console.log('📥 Request body:', JSON.stringify(req.body, null, 2));
  console.log('📥 =================================');

  try {
    const { urls, requestId, query } = req.body;

    if (!urls || !Array.isArray(urls)) {
      console.log('❌ Invalid request: URLs array is required');
      return res.status(400).json({
        success: false,
        error: 'URLs array is required'
      });
    }

    // Validate requestId
    if (!requestId || typeof requestId !== 'string' || requestId.trim().length === 0) {
      console.log('❌ Invalid request: Valid requestId is required');
      return res.status(400).json({
        success: false,
        error: 'Valid requestId is required (non-empty string)'
      });
    }

    // Sanitize requestId to safe characters only
    const sanitizedRequestId = sanitizeRequestId(requestId);
    if (sanitizedRequestId !== requestId.trim()) {
      console.log(`⚠️ RequestId sanitized: "${requestId}" -> "${sanitizedRequestId}"`);
    }

    // Validate query
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      console.log('❌ Invalid request: Valid query is required');
      return res.status(400).json({
        success: false,
        error: 'Valid query is required (non-empty string)'
      });
    }

    console.log(`🏁 Starting crawl for ${urls.length} URLs from request: ${sanitizedRequestId}`);
    console.log(`🔍 Query: "${query}"`);

    const crawlResults = [];

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      console.log(`🔄 [${i + 1}/${urls.length}] Crawling: ${url}`);

      try {
        const extractedData = await crawler.crawlUrl(url);

        // Store only summary data, NO RAW CONTENT
        const result = {
          url: url,
          success: true,
          extractedData: {
            title: extractedData.title,
            wordCount: extractedData.wordCount,
            contentLength: extractedData.contentLength,
            linkCount: extractedData.links ? extractedData.links.length : 0,
            headingCount: extractedData.headings ? extractedData.headings.length : 0,
            summary: extractedData.content ? extractedData.content.substring(0, 200) + '...' : 'No content summary'
          },
          crawledAt: new Date().toISOString()
        };

        crawlResults.push(result);

        console.log(`✅ Successfully crawled ${url}`);
        console.log(`📄 Title: ${extractedData.title}`);
        console.log(`📝 Content: ${extractedData.wordCount} words, ${extractedData.contentLength} characters`);
        console.log(`🔗 Links found: ${extractedData.links.length}`);
        console.log(`📋 Headings found: ${extractedData.headings.length}`);

      } catch (error) {
        console.error(`❌ Failed to crawl ${url}:`, error.message);

        const result = {
          url: url,
          success: false,
          error: error.message,
          crawledAt: new Date().toISOString()
        };

        crawlResults.push(result);
      }

      // Add delay between requests to be respectful
      if (i < urls.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    const successCount = crawlResults.filter(r => r.success).length;

    // Save all results to a separate file for this request
    const savedFilePath = saveRequestResults(sanitizedRequestId, crawlResults, query);

    console.log('🏆 =================================');
    console.log(`🏆 CRAWL COMPLETED for request: ${sanitizedRequestId}`);
    console.log(`🏆 Success: ${successCount}/${crawlResults.length}`);
    console.log(`💾 Results saved to: ${savedFilePath}`);
    console.log('🏆 =================================');

    res.json({
      success: true,
      requestId: sanitizedRequestId,
      crawlResults: crawlResults,
      savedFilePath: savedFilePath,
      summary: {
        total: crawlResults.length,
        successful: successCount,
        failed: crawlResults.length - successCount
      }
    });

  } catch (error) {
    console.error('Crawl error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// List all available crawl results
app.get('/api/results', (req, res) => {
  try {
    const requestIds = getAllRequestIds();
    const resultsList = requestIds.map(requestId => {
      const results = loadRequestResults(requestId);
      return {
        requestId: requestId,
        query: results?.query || 'Unknown',
        crawledAt: results?.crawledAt || 'Unknown',
        totalUrls: results?.totalUrls || 0,
        successfulUrls: results?.successfulUrls || 0,
        filePath: getRequestFilePath(requestId)
      };
    });

    res.json({
      success: true,
      totalRequests: requestIds.length,
      requests: resultsList
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get results by request ID with text-only content
app.get('/api/results/:requestId/content-only', (req, res) => {
  try {
    const { requestId } = req.params;

    // Sanitize and validate requestId for security
    const sanitizedRequestId = sanitizeRequestId(requestId);
    const requestData = loadRequestResults(sanitizedRequestId);

    if (!requestData) {
      return res.status(404).json({
        success: false,
        error: 'No crawled data found for this request ID'
      });
    }

    // Return only summarized content, NO RAW DATA
    const contentOnly = requestData.results.map(item => ({
      url: item.url,
      title: item.extractedData?.title || 'No title',
      contentLength: item.extractedData?.contentLength || 0,
      wordCount: item.extractedData?.wordCount || 0,
      linkCount: item.extractedData?.linkCount || 0,
      headingCount: item.extractedData?.headingCount || 0,
      summary: item.extractedData?.summary || 'No content summary available',
      crawledAt: item.crawledAt,
      success: item.success,
      dataType: 'FILTERED_SUMMARY_ONLY_NO_RAW_DATA'
    }));

    res.json({
      success: true,
      requestId: sanitizedRequestId,
      query: requestData.query,
      message: 'این داده‌ها فقط محتوای متنی استخراج شده هستند، نه HTML کامل',
      totalCrawled: contentOnly.length,
      data: contentOnly
    });
  } catch (error) {
    if (error.message.includes('Invalid requestId') || error.message.includes('path traversal')) {
      return res.status(400).json({
        success: false,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


// Simple Text Extraction endpoint
app.post('/api/extract-simple-text', async (req, res) => {
  console.log('📥 =================================');
  console.log('📥 NEW SIMPLE TEXT EXTRACTION REQUEST');
  console.log('📥 Request body:', JSON.stringify(req.body, null, 2));
  console.log('📥 =================================');

  try {
    const { urls, requestId, query } = req.body;

    if (!urls || !Array.isArray(urls)) {
      console.log('❌ Invalid request: URLs array is required');
      return res.status(400).json({
        success: false,
        error: 'URLs array is required'
      });
    }

    // Validate requestId
    if (!requestId || typeof requestId !== 'string' || requestId.trim().length === 0) {
      console.log('❌ Invalid request: Valid requestId is required');
      return res.status(400).json({
        success: false,
        error: 'Valid requestId is required (non-empty string)'
      });
    }

    // Sanitize requestId
    const sanitizedRequestId = sanitizeRequestId(requestId);

    console.log(`🏁 Starting simple text extraction for ${urls.length} URLs from request: ${sanitizedRequestId}`);
    console.log(`🔍 Query: "${query || 'Simple Text Extraction'}"`);

    const extractionResults = [];

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      console.log(`🔄 [${i + 1}/${urls.length}] Extracting simple text from: ${url}`);

      try {
        const extractedData = await simpleTextExtractor.extractSimpleText(url);

        const result = {
          url: url,
          success: true,
          extractedData: extractedData,
          extractedAt: new Date().toISOString()
        };

        extractionResults.push(result);

        console.log(`✅ Successfully extracted ${extractedData.totalItems} items from ${url}`);
        console.log(`📝 Total Words: ${extractedData.totalWords}`);

      } catch (error) {
        console.error(`❌ Failed to extract simple text from ${url}:`, error.message);

        const result = {
          url: url,
          success: false,
          error: error.message,
          extractedAt: new Date().toISOString()
        };

        extractionResults.push(result);
      }

      // Add delay between requests
      if (i < urls.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    const successCount = extractionResults.filter(r => r.success).length;
    const totalItems = extractionResults
      .filter(r => r.success)
      .reduce((total, r) => total + (r.extractedData.totalItems || 0), 0);
    const totalWords = extractionResults
      .filter(r => r.success)
      .reduce((total, r) => total + (r.extractedData.totalWords || 0), 0);

    // Save results
    const savedFilePath = saveRequestResults(sanitizedRequestId + '_simple_text', extractionResults, query || 'Simple Text Extraction');

    console.log('🏆 =================================');
    console.log(`🏆 SIMPLE TEXT EXTRACTION COMPLETED for request: ${sanitizedRequestId}`);
    console.log(`🏆 Success: ${successCount}/${extractionResults.length}`);
    console.log(`📄 Total Items Extracted: ${totalItems}`);
    console.log(`📝 Total Words Extracted: ${totalWords}`);
    console.log(`💾 Results saved to: ${savedFilePath}`);
    console.log('🏆 =================================');

    res.json({
      success: true,
      requestId: sanitizedRequestId + '_simple_text',
      extractionResults: extractionResults,
      savedFilePath: savedFilePath,
      summary: {
        total: extractionResults.length,
        successful: successCount,
        failed: extractionResults.length - successCount,
        totalItemsExtracted: totalItems,
        totalWordsExtracted: totalWords
      }
    });

  } catch (error) {
    console.error('Simple text extraction error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Single URL simple text extraction
app.get('/api/extract-simple-text/:url', async (req, res) => {
  try {
    const url = decodeURIComponent(req.params.url);
    console.log(`📄 Extracting simple text from: ${url}`);

    const result = await simpleTextExtractor.extractSimpleText(url);

    res.json({
      success: true,
      url: url,
      totalItems: result.totalItems,
      totalWords: result.totalWords,
      data: result.data,
      fileName: result.fileName
    });

  } catch (error) {
    console.error('❌ Single URL simple text extraction error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Live crawler viewer - take screenshot of what crawler sees
app.get('/api/live-view/:url', async (req, res) => {
  try {
    const url = decodeURIComponent(req.params.url);
    console.log(`📸 Taking live screenshot of: ${url}`);

    // Create filename from URL
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace(/[^a-zA-Z0-9]/g, '_');
    const timestamp = Date.now();
    const filename = `screenshot_${domain}_${timestamp}.png`;
    const screenshotPath = path.join(__dirname, 'screenshots', filename);

    // Ensure screenshots directory exists
    const screenshotsDir = path.join(__dirname, 'screenshots');
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
      console.log('📁 Created screenshots directory:', screenshotsDir);
    }

    const { PlaywrightCrawler } = require('@crawlee/playwright');
    let screenshotData = null;

    const crawler = new PlaywrightCrawler({
      maxRequestsPerCrawl: 1,
      requestHandlerTimeoutSecs: 120,
      launchContext: {
        launchOptions: {
          headless: true,
          args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--memory-pressure-off',
            '--max_old_space_size=256',
            '--aggressive-cache-discard',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
          ]
        },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      requestHandler: async ({ page }) => {
        try {
          // Wait for page to fully load
          await page.waitForLoadState('domcontentloaded', { timeout: 45000 });
          try {
            await page.waitForLoadState('networkidle', { timeout: 30000 });
          } catch (e) {
            console.log('⚠️ Network idle timeout, continuing with screenshot...');
          }
          await page.waitForTimeout(3000);

          // Handle cookie consent like in main crawler
          const cookieSelectors = [
            'button:has-text("Accept")',
            'button:has-text("Accept All")',
            'button:has-text("Agree")',
            '.cookie-accept, .accept-cookies'
          ];

          for (const selector of cookieSelectors) {
            try {
              const cookieButton = await page.locator(selector).first();
              if (await cookieButton.isVisible({ timeout: 2000 })) {
                await cookieButton.click({ timeout: 5000 });
                console.log(`✅ Cookie consent clicked: ${selector}`);
                await page.waitForTimeout(3000);
                break;
              }
            } catch (e) {
              // Continue to next selector
            }
          }

          // Take optimized screenshot and save to file
          screenshotData = await page.screenshot({ 
            fullPage: true,
            type: 'png',
            path: screenshotPath,
            animations: 'disabled',
            caret: 'hide',
            scale: 'device',
            omitBackground: false
          });

          console.log(`💾 Screenshot saved to: ${screenshotPath}`);

        } catch (error) {
          console.error('Screenshot error:', error);
        }
      }
    });

    await crawler.addRequests([{ url }]);
    await crawler.run();
    await crawler.teardown();

    if (screenshotData) {
      res.setHeader('Content-Type', 'image/png');
      res.send(screenshotData);
      console.log(`✅ Screenshot sent for: ${url}`);
      console.log(`📁 File saved as: ${filename}`);
    } else {
      res.status(500).json({ error: 'Failed to capture screenshot' });
    }

  } catch (error) {
    console.error('❌ Live view error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Smart Intelligent Crawling endpoint with domain learning
app.post('/api/smart-crawl', async (req, res) => {
  console.log('🧠 =================================');
  console.log('🧠 NEW SMART CRAWL REQUEST RECEIVED');
  console.log('🧠 Request body:', JSON.stringify(req.body, null, 2));
  console.log('🧠 =================================');

  try {
    const { urls, requestId, query } = req.body;

    if (!urls || !Array.isArray(urls)) {
      console.log('❌ Invalid request: URLs array is required');
      return res.status(400).json({
        success: false,
        error: 'URLs array is required'
      });
    }

    // Validate all URLs for security (SSRF protection)
    for (const url of urls) {
      try {
        validateUrl(url);
      } catch (validationError) {
        console.log(`❌ Invalid URL rejected: ${url} - ${validationError.message}`);
        return res.status(400).json({
          success: false,
          error: `Invalid URL: ${validationError.message}`
        });
      }
    }

    // Validate requestId
    if (!requestId || typeof requestId !== 'string' || requestId.trim().length === 0) {
      console.log('❌ Invalid request: Valid requestId is required');
      return res.status(400).json({
        success: false,
        error: 'Valid requestId is required (non-empty string)'
      });
    }

    // Sanitize requestId
    const sanitizedRequestId = sanitizeRequestId(requestId);

    console.log(`🧠 Starting smart crawl for ${urls.length} URLs from request: ${sanitizedRequestId}`);
    console.log(`🔍 Query: "${query || 'Smart Crawl'}"`);

    // ALWAYS use the smart crawler coordinator (regardless of PostgreSQL availability)
    let crawlResults = [];
    
    try {
      console.log('🧠 Using smart crawler coordinator...');
      const smartResult = await smartCrawlerCoordinator.crawlUrls(urls, {
        delay: 2000, // 2 second delay between requests
        maxRetries: 2
      });
      crawlResults = smartResult.results || [];
    } catch (error) {
      console.error('❌ Smart crawler failed:', error.message);
      throw error;
    }

    const successCount = crawlResults.filter(r => r.success).length;

    // Save smart crawl results (only filtered content, no raw data)
    const smartResults = crawlResults.map(result => ({
      url: result.url,
      success: result.success,
      method: result.method,
      processingTime: result.processingTime,
      extractedData: result.extractedData, // Already filtered, no raw data
      error: result.error,
      recommendation: result.recommendation,
      crawledAt: new Date().toISOString()
    }));

    const savedFilePath = saveRequestResults(sanitizedRequestId + '_smart', smartResults, query || 'Smart Crawl');

    console.log('🧠 =================================');
    console.log(`🧠 SMART CRAWL COMPLETED for request: ${sanitizedRequestId}`);
    console.log(`🧠 Success: ${successCount}/${crawlResults.length}`);
    console.log(`💾 Results saved to: ${savedFilePath}`);
    console.log('🧠 =================================');

    res.json({
      success: true,
      requestId: sanitizedRequestId + '_smart',
      crawlResults: smartResults,
      savedFilePath: savedFilePath,
      summary: {
        total: crawlResults.length,
        successful: successCount,
        failed: crawlResults.length - successCount,
        nonBrowserSuccesses: crawlResults.filter(r => r.success && r.method === 'non_browser').length,
        browserSuccesses: crawlResults.filter(r => r.success && r.method && r.method.includes('browser')).length
      }
    });

  } catch (error) {
    console.error('Smart crawl error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Fallback function for basic crawling when smart features are not available
async function fallbackToBasicCrawler(urls) {
  const results = [];
  
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`🔄 [${i + 1}/${urls.length}] Basic crawling: ${url}`);
    
    try {
      const extractedData = await crawler.crawlUrl(url);
      
      results.push({
        url: url,
        success: true,
        method: 'browser_basic',
        processingTime: 5000, // Estimated
        extractedData: {
          title: extractedData.title,
          summary: extractedData.content ? extractedData.content.substring(0, 200) + '...' : 'No content summary'
        }
      });
    } catch (error) {
      results.push({
        url: url,
        success: false,
        method: 'browser_basic',
        error: error.message,
        processingTime: 0
      });
    }
    
    // Add delay between requests
    if (i < urls.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  return results;
}




// Get filtered content file by URL hash
app.get('/api/content-file/:urlHash', async (req, res) => {
  try {
    const { urlHash } = req.params;
    
    // Validate URL hash format
    if (!/^[a-f0-9]{32}$/.test(urlHash)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid URL hash format'
      });
    }

    const filePath = path.join(__dirname, 'content', `${urlHash}.json`);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'Content file not found'
      });
    }

    const fileData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const fileStats = fs.statSync(filePath);

    res.json({
      success: true,
      urlHash: urlHash,
      url: fileData.url,
      savedAt: fileData.savedAt,
      processingTime: fileData.processingTime,
      fileSize: fileStats.size,
      filteredData: fileData.filteredData
    });

  } catch (error) {
    console.error('❌ Error getting content file:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// List all available content files
app.get('/api/content-files', async (req, res) => {
  try {
    const contentDir = path.join(__dirname, 'content');
    
    if (!fs.existsSync(contentDir)) {
      return res.json({
        success: true,
        totalFiles: 0,
        files: []
      });
    }

    const files = fs.readdirSync(contentDir)
      .filter(file => file.endsWith('.json'))
      .map(file => {
        const filePath = path.join(contentDir, file);
        const fileStats = fs.statSync(filePath);
        const urlHash = file.replace('.json', '');
        
        try {
          const fileData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          return {
            urlHash: urlHash,
            fileName: file,
            url: fileData.url,
            savedAt: fileData.savedAt,
            processingTime: fileData.processingTime || 0,
            fileSize: fileStats.size,
            title: fileData.filteredData?.title || 'Untitled'
          };
        } catch (error) {
          return {
            urlHash: urlHash,
            fileName: file,
            url: 'Unknown',
            savedAt: fileStats.mtime.toISOString(),
            processingTime: 0,
            fileSize: fileStats.size,
            title: 'Error reading file',
            error: 'File parse error'
          };
        }
      });

    res.json({
      success: true,
      totalFiles: files.length,
      files: files
    });

  } catch (error) {
    console.error('❌ Error listing content files:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Simple viewer page
app.get('/viewer', (req, res) => {
  const html = `
<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>نمایشگر زنده کراولر</title>
    <style>
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            margin: 0; 
            padding: 20px; 
            background: #f5f5f5;
            direction: rtl;
        }
        .container { 
            max-width: 1200px; 
            margin: 0 auto; 
            background: white; 
            border-radius: 10px; 
            padding: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 { 
            color: #333; 
            text-align: center;
            margin-bottom: 30px;
        }
        .input-group { 
            display: flex; 
            gap: 10px; 
            margin-bottom: 20px;
            align-items: center;
        }
        input { 
            flex: 1; 
            padding: 12px; 
            border: 2px solid #ddd; 
            border-radius: 5px; 
            font-size: 16px;
            direction: ltr;
        }
        button { 
            padding: 12px 24px; 
            background: #007bff; 
            color: white; 
            border: none; 
            border-radius: 5px; 
            cursor: pointer;
            font-size: 16px;
            font-weight: bold;
        }
        button:hover { 
            background: #0056b3; 
        }
        button:disabled { 
            background: #ccc; 
            cursor: not-allowed; 
        }
        #screenshot { 
            width: 100%; 
            border: 2px solid #ddd; 
            border-radius: 5px;
            display: none;
            margin-top: 20px;
        }
        .loading { 
            text-align: center; 
            padding: 40px; 
            font-size: 18px;
            color: #666;
        }
        .error { 
            color: #d32f2f; 
            text-align: center; 
            padding: 20px;
            background: #ffebee;
            border-radius: 5px;
            margin-top: 10px;
        }
        .info {
            background: #e3f2fd;
            color: #1976d2;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🖥️ نمایشگر زنده کراولر</h1>

        <div class="info">
            <strong>راهنمای استفاده:</strong> لینک سایت مورد نظر را وارد کنید تا ببینید کراولر چه چیزی می‌بیند
        </div>

        <div class="input-group">
            <input type="url" id="urlInput" placeholder="https://www.example.com" value="https://www.coindesk.com/">
            <button onclick="takeScreenshot()" id="captureBtn">📸 عکس بگیر</button>
        </div>

        <div id="loading" class="loading" style="display: none;">
            ⏳ در حال گرفتن عکس از صفحه... لطفاً صبر کنید
        </div>

        <div id="error" class="error" style="display: none;"></div>

        <img id="screenshot" alt="Screenshot">
    </div>

    <script>
        async function takeScreenshot() {
            const url = document.getElementById('urlInput').value;
            const loading = document.getElementById('loading');
            const error = document.getElementById('error');
            const screenshot = document.getElementById('screenshot');
            const btn = document.getElementById('captureBtn');

            if (!url) {
                showError('لطفاً آدرس سایت را وارد کنید');
                return;
            }

            // Reset UI
            loading.style.display = 'block';
            error.style.display = 'none';
            screenshot.style.display = 'none';
            btn.disabled = true;
            btn.textContent = '⏳ در حال عکس‌گیری...';

            try {
                const encodedUrl = encodeURIComponent(url);
                const response = await fetch(\`/api/live-view/\${encodedUrl}\`);

                if (response.ok) {
                    const blob = await response.blob();
                    const imageUrl = URL.createObjectURL(blob);

                    screenshot.src = imageUrl;
                    screenshot.style.display = 'block';
                    screenshot.onload = () => URL.revokeObjectURL(imageUrl);
                } else {
                    throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
                }
            } catch (err) {
                showError(\`خطا در گرفتن عکس: \${err.message}\`);
            } finally {
                loading.style.display = 'none';
                btn.disabled = false;
                btn.textContent = '📸 عکس بگیر';
            }
        }

        function showError(message) {
            const error = document.getElementById('error');
            error.textContent = message;
            error.style.display = 'block';
        }

        // Allow Enter key to trigger screenshot
        document.getElementById('urlInput').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                takeScreenshot();
            }
        });
    </script>
</body>
</html>`;

  res.send(html);
});


app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 =================================');
  console.log(`🔥 Crawler API server running on http://0.0.0.0:${PORT}`);
  console.log(`📁 Results directory: ${resultsDir}`);
  console.log(`📊 Available request files: ${getAllRequestIds().length}`);
  console.log('🔗 Available endpoints:');
  console.log('  POST /api/crawl - Receive URLs and crawl them (basic)');
  console.log('  POST /api/smart-crawl - Smart intelligent crawling (ADVANCED!) ✨');
  console.log('  POST /api/extract-simple-text - Extract all text in order');
  console.log('  GET /api/extract-simple-text/:url - Extract simple text from single URL');
  console.log('  GET /api/content-file/:urlHash - Get filtered content file by URL hash 📁');
  console.log('  GET /api/content-files - List all available content files 📁');
  console.log('  GET /api/results - List all crawl requests');
  console.log('  GET /api/results/:requestId - Get crawled data by request ID');
  console.log('  GET /api/results/:requestId/content-only - Get text-only content by request ID');
  console.log('  GET /api/live-view/:url - Get a live screenshot of a URL');
  console.log('  GET /viewer - View the live screenshot tool');
  console.log('  GET /health - Health check');
  console.log('🚀 =================================');
});
