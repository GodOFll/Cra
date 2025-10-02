const nonBrowserCrawler = require('./non-browser-crawler');
const browserCrawler = require('./crawler'); // The existing Playwright crawler
const database = require('./database-config');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class SmartCrawlerCoordinator {
  constructor() {
    this.maxRetries = 2;
    this.fallbackEnabled = true;
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

  // Generate URL hash
  generateUrlHash(url) {
    return crypto.createHash('md5').update(url).digest('hex');
  }

  // Main simple crawling method
  async crawlUrl(url, options = {}) {
    const startTime = Date.now();
    const domain = this.extractDomainName(url);

    console.log('🧠 =================================');
    console.log(`🧠 SIMPLE SMART CRAWLER: ${url}`);
    console.log(`🧠 Domain: ${domain}`);
    console.log('🧠 =================================');

    try {
      let crawlResult = null;
      let finalMethod = null;

      // Simple strategy: try non-browser first, fallback to browser if needed
      console.log('🚀 Starting non-browser crawling...');
      crawlResult = await this.executeNonBrowserCrawl(url);
      finalMethod = 'non_browser';

      

      // If successful, process the content without saving JSON file
      if (crawlResult.success) {
        const processingTime = Date.now() - startTime;

        console.log('🏆 =================================');
        console.log('🏆 SIMPLE CRAWL COMPLETED');
        console.log(`🏆 URL: ${url}`);
        console.log(`🏆 Method: ${finalMethod}`);
        console.log(`🏆 Processing time: ${processingTime}ms`);
        console.log('🏆 Content will be saved by client only');
        console.log('🏆 =================================');

        // Process blocks with content detection
        const processedBlocks = this.convertToSimpleBlocks(crawlResult.extractedData.data);
        const mainContentBlocks = processedBlocks.filter(block => block._meta && block._meta.isMainContent);
        const mainContentWords = mainContentBlocks.reduce((sum, block) => {
          const text = block.content || block.title || '';
          return sum + this.countWords(text);
        }, 0);

        // Remove _meta from blocks for clean output
        const cleanBlocks = processedBlocks.map(block => {
          const { _meta, ...cleanBlock } = block;
          return cleanBlock;
        });

        return {
          success: true,
          url: url,
          domain: domain,
          method: finalMethod,
          processingTime: processingTime,
          extractedData: {
            title: crawlResult.extractedData.title,
            summary: `Crawled content with ${crawlResult.extractedData.totalItems || 0} items (${mainContentBlocks.length} main content blocks)`,
            totalItems: crawlResult.extractedData.totalItems || 0,
            totalWords: crawlResult.extractedData.totalWords || 0,
            mainContentBlocks: mainContentBlocks.length,
            mainContentWords: mainContentWords,
            contentDetectionApplied: true,
            extractionMethod: finalMethod,
            blocks: cleanBlocks
          }
        };
      } else {
        const totalTime = Date.now() - startTime;

        console.log('❌ =================================');
        console.log('❌ SIMPLE CRAWL FAILED');
        console.log(`❌ URL: ${url}`);
        console.log(`❌ Final method: ${finalMethod}`);
        console.log(`❌ Error: ${crawlResult.error}`);
        console.log(`❌ Processing time: ${totalTime}ms`);
        console.log('❌ =================================');

        return {
          success: false,
          url: url,
          domain: domain,
          method: finalMethod,
          processingTime: totalTime,
          error: crawlResult.error
        };
      }

    } catch (error) {
      const totalTime = Date.now() - startTime;
      console.error('❌ Smart crawl coordinator error:', error);

      return {
        success: false,
        url: url,
        domain: domain,
        processingTime: totalTime,
        error: error.message
      };
    }
  }

  // Execute non-browser crawling
  async executeNonBrowserCrawl(url) {
    try {
      const result = await nonBrowserCrawler.crawlUrl(url);
      return result;
    } catch (error) {
      return {
        success: false,
        method: 'non_browser',
        error: error.message,
        processingTime: 0
      };
    }
  }

  // Execute browser crawling using existing Playwright crawler
  async executeBrowserCrawl(url) {
    try {
      const startTime = Date.now();

      // Use the existing browser crawler but extract more structured data
      const result = await browserCrawler.crawlUrl(url);
      const processingTime = Date.now() - startTime;

      // Transform the result to match our expected format
      if (result && result.title) {
        return {
          success: true,
          method: 'browser',
          processingTime: processingTime,
          extractedData: {
            url: url,
            title: result.title,
            totalItems: 1, // Basic browser crawler doesn't count items
            totalWords: result.wordCount || 0,
            extractedAt: new Date().toISOString(),
            extractionMethod: 'browser',
            data: {
              allItemsInOrder: [
                {
                  title: result.title,
                  content: result.content || '',
                  _meta: {
                    type: 'browser_extracted',
                    wordCount: result.wordCount || 0
                  }
                }
              ],
              statistics: {
                totalWords: result.wordCount || 0,
                totalChars: result.contentLength || 0
              }
            }
          }
        };
      } else {
        throw new Error('No data extracted from browser crawler');
      }
    } catch (error) {
      return {
        success: false,
        method: 'browser',
        error: error.message,
        processingTime: 0
      };
    }
  }



  // Convert complex data structure to simple blocks
  convertToSimpleBlocks(data) {
    if (!data || !data.allItemsInOrder) {
      return [];
    }

    const simpleBlocks = [];

    for (const item of data.allItemsInOrder) {
      const block = {};

      // Handle different types of content - preserve both title and content if present
      if (item.title) {
        block.title = item.title;
      }
      if (item.content) {
        block.content = item.content;
      }
      if (item.img || item.image) {
        block.image = item.img || item.image;
        if (item.alt) {
          block.alt = item.alt;
        }
      }

      // Add link if available
      if (item.link) {
        block.link = item.link;
      }

      // Only add non-empty blocks
      if (Object.keys(block).length > 0) {
        simpleBlocks.push(block);
      }
    }

    // Apply content detection and filtering
    const filteredBlocks = this.detectAndFilterMainContent(simpleBlocks);

    return filteredBlocks;
  }

  // Content detection and filtering system
  detectAndFilterMainContent(blocks) {
    console.log(`🔍 Starting content detection analysis on ${blocks.length} blocks...`);

    if (!blocks || blocks.length === 0) {
      return [];
    }

    // Step 1: Detect content regions based on the algorithm
    const contentRegions = this.detectContentRegions(blocks);

    // Step 2: Check for link patterns at the end
    const finalRegions = this.checkLinkPatterns(blocks, contentRegions);

    // Step 3: Extract main content blocks
    const mainContentBlocks = this.extractMainContentBlocks(blocks, finalRegions);

    console.log(`🎯 Content detection completed: ${mainContentBlocks.length}/${blocks.length} blocks identified as main content`);

    return mainContentBlocks;
  }

  // Detect content regions based on content length and titles
  detectContentRegions(blocks) {
    const regions = [];
    let currentRegion = null;
    let hasFoundValidContentInFirst10Blocks = false;

    // First pass: check if VALID content exists in first 10 blocks
    // Valid content = title OR content with 5+ words
    for (let i = 0; i < Math.min(10, blocks.length); i++) {
      const block = blocks[i];
      const hasTitle = !!(block.title && block.title.trim());
      const hasContent = !!(block.content && block.content.trim());
      const contentWordCount = hasContent ? this.countWords(block.content) : 0;

      // Check for valid content: title OR content with 5+ words
      if (hasTitle || (hasContent && contentWordCount >= 15)) {
        hasFoundValidContentInFirst10Blocks = true;
        console.log(`🔍 Found valid content in first 10 blocks at index ${i}: ${hasTitle ? 'title' : `content (${contentWordCount} words)`}`);
        break;
      }
    }

    console.log(`🔍 Valid content found in first 10 blocks: ${hasFoundValidContentInFirst10Blocks}`);

    let isFirstContentRegion = true;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const hasTitle = !!(block.title && block.title.trim());
      const hasContent = !!(block.content && block.content.trim());
      const contentWordCount = hasContent ? this.countWords(block.content) : 0;

      // Check for valid content: title OR content with 5+ words
      const isValidContentStart = hasTitle || (hasContent && contentWordCount >= 15);

      if (isValidContentStart) {
        if (!currentRegion) {
          // Start new region
          let extendRange = 10; // Default range

          // Use extended range (20) ONLY for the first content region AND if no valid content in first 10 blocks
          if (isFirstContentRegion && !hasFoundValidContentInFirst10Blocks) {
            extendRange = 20;
            console.log(`📈 Using extended range (${extendRange} blocks) for first content region - no valid content in first 10 blocks`);
          } else {
            console.log(`📊 Using standard range (${extendRange} blocks) for content region`);
          }

          currentRegion = {
            start: i,
            end: Math.min(i + extendRange - 1, blocks.length - 1),
            reason: hasTitle ? 'title_start' : 'content_start',
            isFirstRegion: isFirstContentRegion,
            extendRange: extendRange,
            lastValidContentIndex: i
          };

          isFirstContentRegion = false;
          console.log(`🔥 Started new content region at block ${i}: end=${currentRegion.end} (reason: ${currentRegion.reason})`);
        } else {
          // Valid content found within existing region - extend the region dynamically
          const newEnd = Math.min(i + currentRegion.extendRange - 1, blocks.length - 1);

          if (newEnd > currentRegion.end) {
            console.log(`🔄 Extended region from ${currentRegion.end} to ${newEnd} due to valid content at block ${i}`);
            currentRegion.end = newEnd;
            currentRegion.lastValidContentIndex = i;
          } else {
            // Update last valid content index even if we don't extend the end
            currentRegion.lastValidContentIndex = i;
          }
        }
      }

      // Check if current region should end
      if (currentRegion && i >= currentRegion.end) {
        // Look ahead for more valid content in next 10 blocks FROM last valid content index
        let hasMoreValidContent = false;
        let nextValidContentIndex = -1;
        const base = currentRegion.lastValidContentIndex;
        const lookAheadEnd = Math.min(base + 10, blocks.length - 1);

        console.log(`🔍 Looking ahead from last valid content index ${base} to ${lookAheadEnd} (10 block window)`);

        for (let j = base + 1; j <= lookAheadEnd; j++) {
          const nextBlock = blocks[j];
          const nextHasTitle = !!(nextBlock.title && nextBlock.title.trim());
          const nextHasContent = !!(nextBlock.content && nextBlock.content.trim());
          const nextContentWordCount = nextHasContent ? this.countWords(nextBlock.content) : 0;

          if (nextHasTitle || (nextHasContent && nextContentWordCount >= 15)) {
            hasMoreValidContent = true;
            nextValidContentIndex = j;
            console.log(`🔍 Found more valid content at block ${j} (within 10 blocks of last valid ${base})`);
            break;
          }
        }

        if (hasMoreValidContent) {
          // Extend the current region to include the next valid content
          const newEnd = Math.min(nextValidContentIndex + currentRegion.extendRange - 1, blocks.length - 1);
          console.log(`🔄 Extended region to ${newEnd} to include valid content at block ${nextValidContentIndex}`);
          currentRegion.end = newEnd;
          currentRegion.lastValidContentIndex = nextValidContentIndex;
        } else {
          // Finalize current region
          regions.push(currentRegion);
          console.log(`✅ Finalized content region: blocks ${currentRegion.start}-${currentRegion.end} (${currentRegion.reason}, last valid: ${currentRegion.lastValidContentIndex})`);
          currentRegion = null;
        }
      }
    }

    // Add final region if exists
    if (currentRegion) {
      regions.push(currentRegion);
      console.log(`✅ Finalized final content region: blocks ${currentRegion.start}-${currentRegion.end} (${currentRegion.reason}, last valid: ${currentRegion.lastValidContentIndex})`);
    }

    console.log(`📊 Total detected content regions: ${regions.length}`);
    return regions;
  }

  // Check for link patterns that indicate end of content
  checkLinkPatterns(blocks, contentRegions) {
    if (contentRegions.length === 0) {
      return contentRegions;
    }

    const finalRegions = [];

    for (const region of contentRegions) {
      let adjustedEnd = region.end;
      let contentLinkPairs = 0;
      let consecutivePairs = 0;
      const requiredConsecutive = 15; // Need 5 consecutive pairs as specified by user

      console.log(`🔗 Checking link patterns for region ${region.start}-${region.end} (looking for ${requiredConsecutive} consecutive content+link or title+link pairs)`);

      // Check each block in the region for content+link or title+link pattern
      for (let i = region.start; i <= region.end; i++) {
        const block = blocks[i];
        const hasValidContent = !!(block.content && block.content.trim());
        const hasValidTitle = !!(block.title && block.title.trim());
        const contentWordCount = hasValidContent ? this.countWords(block.content) : 0;
        const titleWordCount = hasValidTitle ? this.countWords(block.title) : 0;
        const hasLink = !!(block.link && block.link.trim());

        // Consider valid for pattern if either content or title has 5+ words
        const isValidContentForPattern = (hasValidContent && contentWordCount >= 5) ||
                                         (hasValidTitle && titleWordCount >= 5);

        if (isValidContentForPattern) {
          let foundAssociatedLink = false;

          // Check if this content block has an associated link
          if (hasLink) {
            // Direct content+link in same block
            foundAssociatedLink = true;
          } else {
            // Check next 3 blocks for associated link
            for (let j = i + 1; j <= Math.min(i + 3, blocks.length - 1); j++) {
              if (blocks[j].link && blocks[j].link.trim()) {
                foundAssociatedLink = true;
                break;
              }
            }
          }

          if (foundAssociatedLink) {
            contentLinkPairs++;
            consecutivePairs++;

            // Determine what type of content was found
            let contentType = 'content';
            let contentText = block.content || '';
            let wordCount = contentWordCount;

            if (hasValidTitle && titleWordCount >= 5) {
              if (!hasValidContent || contentWordCount < 5) {
                contentType = 'title';
                contentText = block.title || '';
                wordCount = titleWordCount;
              } else if (titleWordCount > contentWordCount) {
                contentType = 'title';
                contentText = block.title || '';
                wordCount = titleWordCount;
              }
            }

            console.log(`🔗 Found ${contentType}+link pair ${consecutivePairs} at block ${i}: "${contentText.substring(0, 30)}..." (${wordCount} words)`);
          } else {
            consecutivePairs = 0; // Reset consecutive count when valid content has no associated link
          }

          // If we find required consecutive content+link or title+link pairs, this indicates menu/navigation
          if (consecutivePairs >= requiredConsecutive) {
            adjustedEnd = i - (requiredConsecutive - 1); // End before the pattern started
            console.log(`🔗 Detected content+link or title+link pattern (${requiredConsecutive} consecutive pairs), adjusting region end from ${region.end} to ${adjustedEnd}`);
            break;
          }
        } else {
          // Reset consecutive count when encountering non-valid content (to enforce "متوالی")
          if (consecutivePairs > 0) {
            console.log(`🔗 Reset consecutive pairs due to non-valid content at block ${i}`);
            consecutivePairs = 0;
          }
        }
      }

      // Only add region if it has valid bounds
      if (adjustedEnd >= region.start) {
        finalRegions.push({
          start: region.start,
          end: adjustedEnd,
          reason: region.reason,
          isFirstRegion: region.isFirstRegion,
          linkPatternDetected: consecutivePairs >= requiredConsecutive,
          contentLinkPairs: contentLinkPairs
        });

        console.log(`✅ Final region: ${region.start}-${adjustedEnd}, content+link/title+link pairs: ${contentLinkPairs}, pattern detected: ${consecutivePairs >= requiredConsecutive}`);
      } else {
        console.log(`❌ Rejected region ${region.start}-${region.end}: adjusted end ${adjustedEnd} before start`);
      }
    }

    return finalRegions;
  }

  // Extract main content blocks from detected regions
  extractMainContentBlocks(blocks, regions) {
    if (regions.length === 0) {
      // Rule 4: If no content regions and only link patterns, don't extract anything
      const hasOnlyLinkPatterns = this.checkOnlyLinkPatterns(blocks);
      if (hasOnlyLinkPatterns) {
        console.log(`⚠️ Page contains only link patterns, no main content extracted`);
        return [];
      }

      // If no patterns detected, still apply content filtering
      const filteredBlocks = blocks.filter(block => this.shouldIncludeBlock(block))
        .map((block, index) => ({
          ...block,
          _meta: {
            ...block._meta,
            regionReason: 'no_region_filter',
            blockIndex: index,
            isMainContent: true,
            contentWordCount: block.content ? this.countWords(block.content) : 0
          }
        }));

      console.log(`🔍 No regions detected, applied content filtering: ${filteredBlocks.length}/${blocks.length} blocks kept`);
      return filteredBlocks;
    }

    const mainContentBlocks = [];

    for (const region of regions) {
      for (let i = region.start; i <= region.end; i++) {
        if (i < blocks.length) {
          const block = blocks[i];

          // Apply content filtering: exclude blocks with content < 5 words
          // except those containing numbers or titles
          const shouldIncludeBlock = this.shouldIncludeBlock(block);

          if (shouldIncludeBlock) {
            mainContentBlocks.push({
              ...block,
              _meta: {
                regionReason: region.reason,
                blockIndex: i,
                isMainContent: true,
                isFirstRegion: region.isFirstRegion || false,
                contentWordCount: block.content ? this.countWords(block.content) : 0
              }
            });
          } else {
            const wordCount = block.content ? this.countWords(block.content) : 0;
            const hasLink = !!(block.link);
            console.log(`🔍 Filtered out block at index ${i}: content too short (${wordCount} words) without numbers. Content: "${(block.content || '').substring(0, 50)}..." ${hasLink ? '[HAS LINK]' : '[NO LINK]'}`);
          }
        }
      }
    }

    return mainContentBlocks;
  }

  // Check if a block should be included in the final content
  shouldIncludeBlock(block) {
    // Always include blocks with titles (non-empty)
    if (block.title && block.title.trim()) {
      return true;
    }

    // Always include blocks with images
    if (block.image && block.image.trim()) {
      return true;
    }

    // For content blocks, apply strict filtering
    if (block.content && block.content.trim()) {
      const wordCount = this.countWords(block.content);

      // Primary rule: Include if content has 5 or more words
      if (wordCount >= 20) {
        return true;
      }

      // EXCLUDE all short content (less than 5 words)
      const hasLink = !!(block.link && block.link.trim());
      const hasNumbers = this.containsNumbers(block.content);
      console.log(`🔍 Excluding short content: "${block.content}" (${wordCount} words)${hasLink ? ' [HAS LINK]' : ' [NO LINK]'}${hasNumbers ? ' [HAS NUMBERS]' : ''}`);
      return false;
    }

    // For blocks without content but with links only (pure link blocks)
    if (block.link && block.link.trim() && !block.content && !block.title && !block.image) {
      console.log(`🔗 Excluding pure link block: "${block.link}"`);
      return false;
    }

    // Only include if it has meaningful content
    return false;
  }

  // Check if text contains numbers (digits)
  containsNumbers(text) {
    if (!text || typeof text !== 'string') {
      return false;
    }

    // Look for any digit in the text
    return /\d/.test(text);
  }

  // Check if page contains only link patterns (Rule 4)
  checkOnlyLinkPatterns(blocks) {
    let linkPatternCount = 0;
    let contentBlockCount = 0;

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const hasValidContent = !!(block.content && block.content.trim());
      const hasValidTitle = !!(block.title && block.title.trim());
      const hasContent = hasValidContent || hasValidTitle;
      const hasLink = !!(block.link);

      if (hasContent) {
        contentBlockCount++;

        if (hasLink) {
          linkPatternCount++;
        } else {
          // Check next 3 blocks for link
          for (let j = i + 1; j <= Math.min(i + 3, blocks.length - 1); j++) {
            if (blocks[j].link) {
              linkPatternCount++;
              break;
            }
          }
        }
      }
    }

    // If most content blocks have associated links, consider it link-pattern only
    return contentBlockCount > 0 && (linkPatternCount / contentBlockCount) > 0.7;
  }

  // Count words in text
  countWords(text) {
    if (!text || typeof text !== 'string') {
      return 0;
    }

    // Clean the text and split by whitespace
    const trimmed = text.trim();
    if (trimmed === '') {
      return 0;
    }

    // Split by one or more whitespace characters and filter out empty strings
    const words = trimmed.split(/\s+/).filter(word => word.length > 0);
    return words.length;
  }

  // Batch crawl multiple URLs
  async crawlUrls(urls, options = {}) {
    console.log(`🌟 Simple batch crawling ${urls.length} URLs...`);
    const results = [];
    const delay = options.delay || 2000; // 2 second delay between requests

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      console.log(`🔄 [${i + 1}/${urls.length}] Crawling: ${url}`);

      try {
        const result = await this.crawlUrl(url, options);
        results.push(result);

        if (result.success) {
          console.log(`✅ [${i + 1}/${urls.length}] Success: ${result.method} - ${result.extractedData.title}`);
        } else {
          console.log(`❌ [${i + 1}/${urls.length}] Failed: ${result.error}`);
        }
      } catch (error) {
        console.error(`❌ [${i + 1}/${urls.length}] Exception:`, error.message);
        results.push({
          success: false,
          url: url,
          error: error.message,
          processingTime: 0
        });
      }

      // Add delay between requests
      if (i < urls.length - 1 && delay > 0) {
        console.log(`⏳ Waiting ${delay}ms before next request...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`🏁 Batch crawling completed: ${successCount}/${urls.length} successful`);

    return {
      success: true,
      totalUrls: urls.length,
      successfulUrls: successCount,
      failedUrls: urls.length - successCount,
      results: results
    };
  }
}

module.exports = new SmartCrawlerCoordinator();
