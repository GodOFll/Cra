const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');

class NonBrowserCrawler {
  constructor() {
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this.timeout = 30000; // 30 seconds
    this.maxRetries = 2;
    this.retryDelay = 1000; // 1 second
  }

  // Extract domain name from URL
  extractDomainName(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.toLowerCase();
    } catch (error) {
      throw new Error(`Invalid URL: ${url}`);
    }
  }

  // Clean and normalize text content
  cleanText(text) {
    if (!text) return '';
    return text.trim().replace(/\s+/g, ' ');
  }

  // Extract structured content from HTML using Cheerio - PRESERVING HTML ORDER
  extractStructuredContent(html, url) {
    const $ = cheerio.load(html);
    const extractedItems = [];
    let itemIndex = 0;

    // Get page title
    const title = $('title').text().trim() || '';

    // Remove script, style, and other non-content elements
    $('script, style, noscript, meta, link, head').remove();

    // Track processed elements to avoid duplicates
    const processedElements = new Set();

    // Traverse ALL elements in document order (depth-first) to preserve HTML sequence
    const traverseInOrder = (element) => {
      const $el = $(element);
      const tagName = element.tagName.toLowerCase();
      
      // Skip if already processed or if it's a script/style element
      if (processedElements.has(element) || ['script', 'style', 'noscript', 'meta', 'link'].includes(tagName)) {
        return;
      }

      // Mark as processed
      processedElements.add(element);

      let hasDirectContent = false;
      const item = {
        index: ++itemIndex,
        tag: tagName,
        documentOrder: itemIndex
      };

      // Handle standalone images
      if (tagName === 'img') {
        let src = $el.attr('src');
        const alt = $el.attr('alt') || '';

        if (src) {
          src = this.makeAbsoluteUrl(src, url);
          item.type = 'image';
          item.imgSrc = src;
          item.content = alt;
          item.length = alt.length;
          item.wordCount = alt.split(/\s+/).filter(w => w.length > 0).length;
          hasDirectContent = true;
        }
      }

      // Get ONLY direct text content (excluding child elements)
      const directText = $el.clone().children().remove().end().text().trim();
      const cleanedText = this.cleanText(directText);

      // Process text content only if it's meaningful and direct
      if (cleanedText.length >= 3 && tagName !== 'img') {
        const contentType = this.determineContentType(tagName, $el);
        if (contentType !== 'skip') {
          item.type = contentType;
          item.content = cleanedText;
          item.length = cleanedText.length;
          item.wordCount = cleanedText.split(/\s+/).filter(w => w.length > 0).length;
          hasDirectContent = true;

          // Handle links
          const href = $el.attr('href');
          if (href) {
            const absoluteHref = this.makeAbsoluteUrl(href, url);
            item.href = absoluteHref;
            item.linkType = this.determineLinkType(absoluteHref, url);
          }

          // Check for images within this text element
          const img = $el.find('img').first();
          if (img.length > 0) {
            const imgSrc = this.makeAbsoluteUrl(img.attr('src'), url);
            const imgAlt = this.cleanText(img.attr('alt') || '');
            if (imgSrc) {
              item.imgSrc = imgSrc;
              if (imgAlt) item.imgAlt = imgAlt;
            }
          }
        }
      }

      // Add item if it has content
      if (hasDirectContent) {
        const className = $el.attr('class');
        const id = $el.attr('id');
        if (className) item.className = className;
        if (id) item.id = id;

        extractedItems.push(item);
      }

      // Recursively process child elements in document order
      $el.children().each((index, child) => {
        traverseInOrder(child);
      });
    };

    // Start traversal from body to maintain document order
    $('body').children().each((index, element) => {
      traverseInOrder(element);
    });

    // Convert to structured blocks maintaining exact HTML order
    const structuredContent = extractedItems
      .sort((a, b) => a.documentOrder - b.documentOrder) // Ensure order is preserved
      .map(item => {
        const block = {};

        // Handle different content types
        if (item.type === 'image') {
          block.image = item.imgSrc;
          if (item.content) block.alt = item.content;
        } else {
          // Determine if it's a heading/title or regular content
          const isHeading = item.type === 'title' || 
                           ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(item.tag);

          if (isHeading) {
            block.title = item.content;
          } else {
            block.content = item.content;
          }
        }

        // Add link if available
        if (item.href) {
          block.link = item.href;
        }

        // Add inline image if element contains both text and image
        if (item.imgSrc && item.type !== 'image') {
          block.image = item.imgSrc;
          if (item.imgAlt) block.imageAlt = item.imgAlt;
        }

        // Preserve metadata for debugging
        block._meta = {
          tag: item.tag,
          type: item.type || 'content',
          index: item.index,
          documentOrder: item.documentOrder
        };

        if (item.className) block._meta.className = item.className;
        if (item.id) block._meta.id = item.id;

        return block;
      });

    // Calculate comprehensive statistics
    const totalWords = extractedItems.reduce((sum, item) => sum + (item.wordCount || 0), 0);
    const totalChars = extractedItems.reduce((sum, item) => sum + (item.length || 0), 0);

    return {
      url: url,
      title: title,
      totalItems: extractedItems.length,
      totalWords: totalWords,
      totalChars: totalChars,
      extractedAt: new Date().toISOString(),
      extractionMethod: 'non_browser_sequential',
      preservesHtmlOrder: true,
      data: {
        allItemsInOrder: structuredContent,
        statistics: {
          totalTextItems: extractedItems.filter(item => ['title', 'content', 'paragraph'].includes(item.type)).length,
          totalLinks: extractedItems.filter(item => item.href).length,
          totalImages: extractedItems.filter(item => item.imgSrc).length,
          totalWords: totalWords,
          totalChars: totalChars,
          processingNote: 'Content preserved in original HTML document order'
        }
      }
    };
  }

  // Determine content type based on element
  determineContentType(tagName, $el) {
    const className = $el.attr('class')?.toLowerCase() || '';
    const id = $el.attr('id')?.toLowerCase() || '';

    // Skip navigation and footer elements
    if (className.includes('nav') || className.includes('menu') ||
        className.includes('footer') || className.includes('header') ||
        id.includes('nav') || id.includes('menu') ||
        id.includes('footer') || id.includes('header')) {
      return 'skip';
    }

    // Classify by tag
    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
      return 'title';
    }

    if (['p', 'article', 'section'].includes(tagName)) {
      return 'content';
    }

    if (tagName === 'li') {
      return 'list_item';
    }

    if (['td', 'th'].includes(tagName)) {
      return 'table_content';
    }

    if (tagName === 'blockquote') {
      return 'quote';
    }

    if (tagName === 'figcaption') {
      return 'caption';
    }

    // Default to content for divs and spans with actual content
    if (['div', 'span'].includes(tagName)) {
      return 'content';
    }

    return 'content';
  }

  // Make relative URLs absolute
  makeAbsoluteUrl(url, baseUrl) {
    if (!url) return null;
    try {
      return new URL(url, baseUrl).href;
    } catch (error) {
      return null;
    }
  }

  // Determine link type
  determineLinkType(href, baseUrl) {
    if (!href) return 'unknown';

    try {
      const linkUrl = new URL(href);
      const baseUrlObj = new URL(baseUrl);

      if (linkUrl.hostname === baseUrlObj.hostname) {
        return 'internal';
      } else {
        return 'external';
      }
    } catch (error) {
      if (href.startsWith('#')) return 'anchor';
      if (href.startsWith('mailto:')) return 'email';
      if (href.startsWith('tel:')) return 'phone';
      return 'relative';
    }
  }

  // Main crawling method with retry logic
  async crawlUrl(url, options = {}) {
    const startTime = Date.now();
    const maxRetries = options.maxRetries || this.maxRetries;

    console.log(`🌐 Starting non-browser crawl: ${url}`);

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const response = await axios.get(url, {
          timeout: this.timeout,
          headers: {
            'User-Agent': this.userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
          },
          maxRedirects: 5,
          validateStatus: function (status) {
            return status >= 200 && status < 400; // Accept 2xx and 3xx status codes
          }
        });

        const contentType = response.headers['content-type'] || '';

        // Check if response is HTML
        if (!contentType.includes('text/html')) {
          throw new Error(`Non-HTML content type: ${contentType}`);
        }

        // Extract content from HTML
        const extractedData = this.extractStructuredContent(response.data, url);

        const processingTime = Date.now() - startTime;
        console.log(`✅ Non-browser crawl successful: ${url} (${processingTime}ms)`);

        return {
          success: true,
          method: 'non_browser',
          processingTime: processingTime,
          statusCode: response.status,
          contentLength: response.data.length,
          extractedData: extractedData
        };

      } catch (error) {
        console.log(`⚠️ Non-browser crawl attempt ${attempt} failed for ${url}: ${error.message}`);

        // If this was the last attempt, return failure
        if (attempt > maxRetries) {
          const processingTime = Date.now() - startTime;
          console.log(`❌ Non-browser crawl failed after ${maxRetries + 1} attempts: ${url}`);

          return {
            success: false,
            method: 'non_browser',
            processingTime: processingTime,
            error: error.message,
            shouldFallbackToBrowser: this.shouldFallbackToBrowser(error)
          };
        }

        // Wait before retry
        if (attempt <= maxRetries) {
          await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
        }
      }
    }
  }

  // Determine if we should fallback to browser-based crawling
  shouldFallbackToBrowser(error) {
    const errorMessage = error.message.toLowerCase();

    // JavaScript-heavy sites that require browser
    if (errorMessage.includes('timeout') ||
        errorMessage.includes('empty') ||
        errorMessage.includes('no content') ||
        errorMessage.includes('javascript')) {
      return true;
    }

    // Network errors that browser might handle better
    if (errorMessage.includes('enotfound') ||
        errorMessage.includes('econnrefused') ||
        errorMessage.includes('certificate')) {
      return false; // These are network issues, browser won't help
    }

    // Status code issues that might indicate JS-dependent content
    if (errorMessage.includes('403') ||
        errorMessage.includes('503') ||
        errorMessage.includes('cloudflare')) {
      return true;
    }

    return true; // Default to trying browser if unsure
  }

  // Batch crawl multiple URLs
  async crawlUrls(urls, options = {}) {
    console.log(`🌐 Starting batch non-browser crawl for ${urls.length} URLs`);
    const results = [];
    const delay = options.delay || 1000; // Default 1 second delay between requests

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      console.log(`🔄 [${i + 1}/${urls.length}] Non-browser crawling: ${url}`);

      const result = await this.crawlUrl(url, options);
      results.push({
        url: url,
        ...result
      });

      // Add delay between requests to be respectful
      if (i < urls.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`🏆 Batch non-browser crawl completed: ${successCount}/${results.length} successful`);

    return results;
  }
}

module.exports = new NonBrowserCrawler();