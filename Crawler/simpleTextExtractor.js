
const { PlaywrightCrawler } = require('@crawlee/playwright');
const fs = require('fs');
const path = require('path');

class SimpleTextExtractor {
  constructor() {
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this.outputDir = path.join(__dirname, 'extracted_text');

    // Create output directory if it doesn't exist
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
      console.log('📁 Created text output directory:', this.outputDir);
    }
  }

  // Generate safe filename from URL with URL hash for unique per-URL caching
  generateFileName(url) {
    const crypto = require('crypto');
    const urlHash = crypto.createHash('md5').update(url).digest('hex').substring(0, 8);
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace(/[^a-zA-Z0-9]/g, '_');
    const timestamp = Date.now();
    return `text_${domain}_${urlHash}_${timestamp}.json`;
  }

  // Check for existing extracted files for a specific URL (URL-scoped caching)
  findExistingExtractedFile(url, ignoreCache = false) {
    if (ignoreCache) {
      return null; // Force fresh extraction when ignoreCache is true
    }
    
    try {
      const crypto = require('crypto');
      const urlHash = crypto.createHash('md5').update(url).digest('hex').substring(0, 8);
      const urlObj = new URL(url);
      const domain = urlObj.hostname.replace(/[^a-zA-Z0-9]/g, '_');
      
      // List all files in extracted_text directory
      const files = fs.readdirSync(this.outputDir);
      
      // Find files matching the specific URL pattern (domain + URL hash)
      const matchingFiles = files.filter(file => 
        file.startsWith(`text_${domain}_${urlHash}_`) && file.endsWith('.json')
      );
      
      if (matchingFiles.length > 0) {
        // Return the most recent file (highest timestamp)
        const sortedFiles = matchingFiles.sort().reverse();
        const latestFile = sortedFiles[0];
        const filePath = path.join(this.outputDir, latestFile);
        
        console.log(`📄 Found existing extracted file for URL ${url}: ${latestFile}`);
        return filePath;
      }
      
      return null;
    } catch (error) {
      console.log(`⚠️ Error checking for existing files: ${error.message}`);
      return null;
    }
  }

  // Load existing extracted data from file
  loadExistingData(filePath) {
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(data);
      console.log(`✅ Loaded existing data: ${parsed.totalItems} items, ${parsed.totalWords} words`);
      return parsed;
    } catch (error) {
      console.log(`❌ Error loading existing data: ${error.message}`);
      return null;
    }
  }

  // Clean and normalize text content
  cleanText(text) {
    if (!text) return '';

    return text
      .trim()
      .replace(/\s+/g, ' ') // Replace multiple whitespaces with single space
      .replace(/[\r\n\t]+/g, ' ') // Replace line breaks and tabs with space
      .replace(/\u00A0/g, ' ') // Replace non-breaking spaces
      .replace(/[^\x20-\x7E\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g, ''); // Keep printable ASCII and Arabic characters
  }

  // Extract text content from all elements in order
  extractTextInOrder(document) {
    const extractedItems = [];
    let itemIndex = 0;

    // Define element types and their categories
    const elementCategories = {
      'h1': 'title_main',
      'h2': 'title_section',
      'h3': 'title_subsection',
      'h4': 'title_small',
      'h5': 'title_small',
      'h6': 'title_small',
      'p': 'content_paragraph',
      'div': 'content_general',
      'span': 'content_inline',
      'section': 'content_section',
      'article': 'content_article',
      'li': 'content_list_item',
      'td': 'content_table_cell',
      'th': 'content_table_header',
      'blockquote': 'content_quote',
      'figcaption': 'content_caption',
      'label': 'content_label',
      'button': 'content_button',
      'a': 'content_link'
    };

    // Function to recursively walk through all elements
    const walkElements = (element, parentLinkInfo = null) => {
      // Skip script, style, and other non-content elements
      const skipTags = ['script', 'style', 'noscript', 'meta', 'link', 'head', 'title'];
      if (skipTags.includes(element.tagName?.toLowerCase())) {
        return;
      }

      const tagName = element.tagName?.toLowerCase() || 'unknown';

      // Check if this is an <a> tag to pass down link info
      let currentLinkInfo = parentLinkInfo;
      if (tagName === 'a') {
        const href = element.getAttribute('href');
        if (href) {
          currentLinkInfo = {
            href: href,
            linkType: this.determineLinkType(href)
          };
        }
      }

      // Get ALL text content from this element (including nested text)
      const allTextContent = this.getAllTextContent(element);

      // Get text that's directly in this element (not from children)
      const directText = this.getDirectTextContent(element);

      // Only process if we have meaningful content
      if (allTextContent && allTextContent.length > 2) {
        const category = elementCategories[tagName] || 'content_general';

        // For leaf elements or elements with only direct text, use all content
        const hasTextChildren = this.hasTextOnlyChildren(element);
        const contentToUse = hasTextChildren ? allTextContent : directText;

        if (contentToUse && contentToUse.length > 2) {
          const item = {
            index: ++itemIndex,
            type: 'text',
            category: category,
            tag: tagName,
            content: contentToUse,
            length: contentToUse.length,
            wordCount: contentToUse.split(/\s+/).filter(w => w.length > 0).length
          };

          // Add link information if element is inside a link or is a link itself
          if (currentLinkInfo) {
            item.href = currentLinkInfo.href;
            item.linkType = currentLinkInfo.linkType;
            item.insideLink = true;
          } else if (tagName === 'a') {
            // Fallback for direct link detection
            const href = element.getAttribute('href');
            if (href) {
              item.href = href;
              item.linkType = this.determineLinkType(href);
              item.insideLink = false;
            }
          }

          // Add class and id if available
          const className = element.getAttribute('class');
          const id = element.getAttribute('id');
          if (className) item.className = className;
          if (id) item.id = id;

          extractedItems.push(item);
        }
      }

      // Check for images
      if (tagName === 'img') {
        const src = element.getAttribute('src');
        const alt = element.getAttribute('alt') || '';
        const title = element.getAttribute('title') || '';

        if (src) {
          const imageItem = {
            index: ++itemIndex,
            type: 'image',
            category: 'media_image',
            tag: 'img',
            src: src,
            alt: alt,
            title: title,
            content: alt || title || 'تصویر بدون توضیح'
          };

          // Add link information if image is inside a link
          if (currentLinkInfo) {
            imageItem.href = currentLinkInfo.href;
            imageItem.linkType = currentLinkInfo.linkType;
            imageItem.insideLink = true;
          }

          extractedItems.push(imageItem);
        }
      }

      // Only recurse into children if this element doesn't contain substantial direct text
      // or if we're inside an <a> tag (to capture nested structure)
      if (!directText || directText.length < 10 || currentLinkInfo) {
        for (const child of element.children || []) {
          walkElements(child, currentLinkInfo);
        }
      }
    };

    // Start walking from body
    const body = document.body || document.documentElement;
    if (body) {
      walkElements(body);
    }

    return extractedItems;
  }

  // Get ALL text content from element and its children
  getAllTextContent(element) {
    const textContent = element.textContent || element.innerText || '';
    return this.cleanText(textContent);
  }

  // Get direct text content of an element (excluding children)
  getDirectTextContent(element) {
    let directText = '';

    // Get all child nodes and extract only text nodes
    for (const node of element.childNodes || []) {
      if (node.nodeType === 3) { // Text node
        const text = node.textContent || '';
        if (text.trim()) {
          directText += text;
        }
      }
    }

    return this.cleanText(directText);
  }

  // Check if element has children that are primarily text (no complex nesting)
  hasTextOnlyChildren(element) {
    if (!element.children || element.children.length === 0) {
      return true; // Leaf element
    }

    // If element has only inline children (span, strong, em, etc.), treat as text-only
    const inlineTags = ['span', 'strong', 'em', 'b', 'i', 'u', 'small', 'mark', 'code'];
    const children = Array.from(element.children);

    return children.every(child => {
      const tagName = child.tagName?.toLowerCase();
      return inlineTags.includes(tagName) && !this.hasComplexChildren(child);
    });
  }

  // Check if element has complex nested structure
  hasComplexChildren(element) {
    if (!element.children || element.children.length === 0) {
      return false;
    }

    const complexTags = ['div', 'p', 'section', 'article', 'ul', 'ol', 'li', 'table', 'tr', 'td'];

    for (const child of element.children) {
      const tagName = child.tagName?.toLowerCase();
      if (complexTags.includes(tagName)) {
        return true;
      }
      if (this.hasComplexChildren(child)) {
        return true;
      }
    }

    return false;
  }

  // Determine link type
  determineLinkType(href) {
    if (!href) return 'unknown';

    if (href.startsWith('mailto:')) return 'email';
    if (href.startsWith('tel:')) return 'phone';
    if (href.startsWith('#')) return 'anchor';
    if (href.startsWith('http://') || href.startsWith('https://')) return 'external';
    if (href.startsWith('/')) return 'internal';

    return 'relative';
  }

  // Group items by their link association with improved logic
  groupItemsByLink(items) {
    const linkGroups = new Map();
    const nonLinkItems = [];

    for (const item of items) {
      if (item.href && item.insideLink) {
        // Group items that are inside <a> tags by their href
        if (!linkGroups.has(item.href)) {
          linkGroups.set(item.href, {
            hasLink: true,
            href: item.href,
            linkType: item.linkType,
            items: []
          });
        }
        linkGroups.get(item.href).items.push(item);
      } else {
        // Items not inside <a> tags
        const group = {
          hasLink: false,
          href: item.href || '',
          linkType: item.linkType || '',
          items: [item]
        };

        // If item itself is a link (not inside one), mark it
        if (item.href && !item.insideLink) {
          group.hasLink = true;
          group.linkType = item.linkType;
        }

        nonLinkItems.push(group);
      }
    }

    // Combine link groups and non-link items in original order
    const result = [];
    const processedHrefs = new Set();

    // Maintain order by going through original items
    for (const item of items) {
      if (item.href && item.insideLink && !processedHrefs.has(item.href)) {
        result.push(linkGroups.get(item.href));
        processedHrefs.add(item.href);
      } else if (!item.href || !item.insideLink) {
        // Find corresponding non-link item
        const nonLinkItem = nonLinkItems.find(group =>
          group.items.length === 1 && group.items[0].index === item.index
        );
        if (nonLinkItem) {
          result.push(nonLinkItem);
        }
      }
    }

    return result;
  }

  // Main extraction method - OPTIMIZED FOR MINIMAL RESOURCE USAGE with CACHE-FIRST approach
  async extractSimpleText(url, options = {}) {
    const { ignoreCache = false } = options;
    console.log(`🌐 Starting lightweight text extraction from: ${url}`);

    // Cache-first approach: Check for existing extracted files (unless ignoreCache is true)
    const existingFile = this.findExistingExtractedFile(url, ignoreCache);
    if (existingFile) {
      const cachedData = this.loadExistingData(existingFile);
      if (cachedData) {
        console.log(`🎯 Using cached extracted data for: ${url}`);
        return cachedData;
      }
    }

    console.log(`🚀 No cache found, starting live extraction for: ${url}`);

    return new Promise(async (resolve, reject) => {
      let extractedData = null;
      let crawlError = null;

      const crawler = new PlaywrightCrawler({
        maxRequestsPerCrawl: 1,
        requestHandlerTimeoutSecs: 60, // Reduced timeout
        launchContext: {
          launchOptions: {
            headless: true,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-gpu',
              '--disable-web-security',
              // Optimizations for text extraction only
              '--disable-plugins',
              '--disable-extensions',
              '--disable-default-apps',
              '--disable-sync',
              '--disable-translate',
              '--disable-background-timer-throttling',
              '--disable-backgrounding-occluded-windows',
              '--disable-renderer-backgrounding',
              '--disable-features=TranslateUI',
              '--disable-features=VizDisplayCompositor',
              '--no-first-run',
              '--memory-pressure-off',
              '--max_old_space_size=256'
            ]
          },
          userAgent: this.userAgent
        },
        requestHandler: async ({ page }) => {
          try {
            console.log('⏳ Loading page content (minimal mode)...');
            
            // Set minimal viewport to save memory
            await page.setViewportSize({ width: 800, height: 600 });
            
            // Wait only for basic DOM content
            await page.waitForLoadState('domcontentloaded', { timeout: 30000 });
            
            // Short wait for any immediate dynamic content
            await page.waitForTimeout(2000); // Reduced from 3000ms

            // Get page info
            const title = await page.title() || '';
            const finalUrl = page.url();

            // Extract HTML content directly
            const html = await page.content();

            // Create a DOM parser to work with the HTML
            const { JSDOM } = require('jsdom');
            const dom = new JSDOM(html);
            const document = dom.window.document;

            console.log('📄 Extracting text content (lightweight processing)...');

            // Extract all text content in order
            const allItems = this.extractTextInOrder(document);

            // Calculate statistics
            const totalWords = allItems
              .filter(item => item.type === 'text')
              .reduce((sum, item) => sum + (item.wordCount || 0), 0);

            const totalCharacters = allItems
              .filter(item => item.type === 'text')
              .reduce((sum, item) => sum + (item.length || 0), 0);

            // Create clean block structure
            const cleanBlocks = [];

            for (const item of allItems) {
              const block = {};
              
              if (item.type === 'text') {
                const isTitle = item.category.includes('title') ||
                               item.tag === 'h1' || item.tag === 'h2' ||
                               item.tag === 'h3' || item.tag === 'h4' ||
                               item.tag === 'h5' || item.tag === 'h6';

                if (isTitle) {
                  block.title = item.content;
                } else {
                  block.content = item.content;
                }
              } else if (item.type === 'image') {
                block.image = item.src;
                if (item.alt) {
                  block.alt = item.alt;
                }
              }
              
              // Add link if available
              if (item.href) {
                block.link = item.href;
              }
              
              // Only add non-empty blocks
              if (Object.keys(block).length > 0) {
                cleanBlocks.push(block);
              }
            }

            extractedData = {
              url: finalUrl,
              title: title.trim(),
              totalItems: cleanBlocks.length,
              totalWords: totalWords,
              extractedAt: new Date().toISOString(),
              extractionMode: 'lightweight',
              blocks: cleanBlocks,
              statistics: {
                totalTextItems: allItems.filter(item => item.type === 'text').length,
                totalImages: allItems.filter(item => item.type === 'image').length,
                totalWords: totalWords,
                totalCharacters: totalCharacters
              }
            };

            console.log(`✅ Lightweight text extraction completed: ${allItems.length} items extracted`);
            console.log(`📊 Text items: ${allItems.filter(item => item.type === 'text').length}`);
            console.log(`🖼️ Images: ${allItems.filter(item => item.type === 'image').length}`);
            console.log(`📝 Total words: ${totalWords}`);

          } catch (error) {
            console.error('❌ Error during lightweight text extraction:', error);
            crawlError = error;
          }
        },
        failedRequestHandler: async ({ request, error }) => {
          console.error(`❌ Failed to extract text from ${request.url}: ${error.message}`);
          crawlError = error;
        }
      });

      try {
        console.log(`🚀 Starting lightweight text extraction crawler for: ${url}`);
        await crawler.addRequests([url]);
        await crawler.run();
        await crawler.teardown();
        console.log(`🔧 Lightweight text extraction completed`);

        if (crawlError) {
          reject(crawlError);
        } else if (!extractedData) {
          reject(new Error('No text data was extracted'));
        } else {
          // Save results to file
          const fileName = this.generateFileName(url);
          const filePath = path.join(this.outputDir, fileName);

          fs.writeFileSync(filePath, JSON.stringify(extractedData, null, 2), 'utf8');
          console.log(`💾 Text data saved to: ${filePath}`);

          resolve({
            url: url,
            fileName: fileName,
            filePath: filePath,
            totalItems: extractedData.totalItems,
            totalWords: extractedData.totalWords,
            extractedAt: extractedData.extractedAt,
            data: extractedData
          });
        }
      } catch (error) {
        console.error(`🔥 Lightweight text extraction error:`, error);
        reject(error);
      }
    });
  }

  // Extract text from multiple URLs
  async extractMultipleSimpleText(urls) {
    console.log(`🌐 Starting batch lightweight text extraction for ${urls.length} URLs`);
    const results = [];

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      console.log(`🔄 [${i + 1}/${urls.length}] Extracting text from: ${url}`);

      try {
        const result = await this.extractSimpleText(url);
        results.push({
          success: true,
          ...result
        });
        console.log(`✅ Successfully extracted text from ${url}`);
      } catch (error) {
        console.error(`❌ Failed to extract text from ${url}:`, error.message);
        results.push({
          success: false,
          url: url,
          error: error.message,
          extractedAt: new Date().toISOString()
        });
      }

      // Add delay between requests
      if (i < urls.length - 1) {
        console.log('⏳ Waiting 1 second before next extraction...');
        await new Promise(resolve => setTimeout(resolve, 1000)); // Reduced delay
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`🏆 Batch lightweight text extraction completed: ${successCount}/${results.length} successful`);

    return results;
  }
}

module.exports = new SimpleTextExtractor();
