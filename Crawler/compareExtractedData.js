
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class ExtractedDataComparator {
  constructor() {
    this.exactMatches = [];
    this.outputDir = path.join(__dirname, 'comparison_results');
    
    // Create output directory if it doesn't exist
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
      console.log('📁 Created comparison results directory:', this.outputDir);
    }
  }

  // Generate hash for a block to enable fast comparison
  generateBlockHash(block) {
    // Normalize the block by removing any order-sensitive properties
    const normalizedBlock = { ...block };
    
    // Sort arrays to ensure consistent hashing
    if (normalizedBlock.content && Array.isArray(normalizedBlock.content)) {
      normalizedBlock.content = [...normalizedBlock.content].sort();
    }
    if (normalizedBlock.alt && Array.isArray(normalizedBlock.alt)) {
      normalizedBlock.alt = [...normalizedBlock.alt].sort();
    }

    // Create hash from normalized content
    const hashString = JSON.stringify(normalizedBlock, Object.keys(normalizedBlock).sort());
    return crypto.createHash('md5').update(hashString).digest('hex');
  }

  // Deep equality check for two blocks
  isBlockEqual(block1, block2) {
    // Quick check: if hashes are different, blocks are different
    if (this.generateBlockHash(block1) !== this.generateBlockHash(block2)) {
      return false;
    }

    // Detailed comparison
    const keys1 = Object.keys(block1).sort();
    const keys2 = Object.keys(block2).sort();

    // Check if same number of properties
    if (keys1.length !== keys2.length) {
      return false;
    }

    // Check if all keys are the same
    if (!keys1.every((key, index) => key === keys2[index])) {
      return false;
    }

    // Compare each property
    for (const key of keys1) {
      if (!this.deepEqual(block1[key], block2[key])) {
        return false;
      }
    }

    return true;
  }

  // Deep equality for any type of value
  deepEqual(val1, val2) {
    if (val1 === val2) return true;
    
    if (val1 == null || val2 == null) return val1 === val2;
    
    if (typeof val1 !== typeof val2) return false;
    
    if (Array.isArray(val1)) {
      if (!Array.isArray(val2) || val1.length !== val2.length) return false;
      
      // Sort arrays before comparison for order independence
      const sorted1 = [...val1].sort();
      const sorted2 = [...val2].sort();
      
      return sorted1.every((item, index) => this.deepEqual(item, sorted2[index]));
    }
    
    if (typeof val1 === 'object') {
      const keys1 = Object.keys(val1).sort();
      const keys2 = Object.keys(val2).sort();
      
      if (keys1.length !== keys2.length) return false;
      if (!keys1.every((key, index) => key === keys2[index])) return false;
      
      return keys1.every(key => this.deepEqual(val1[key], val2[key]));
    }
    
    return false;
  }

  // Compare two extracted data files
  compareFiles(file1Path, file2Path) {
    console.log('🔍 Starting comparison of extracted data files...');
    console.log(`📄 File 1: ${file1Path}`);
    console.log(`📄 File 2: ${file2Path}`);

    // Load and parse JSON files
    let data1, data2;
    
    try {
      const content1 = fs.readFileSync(file1Path, 'utf8');
      data1 = JSON.parse(content1);
      console.log(`✅ File 1 loaded: ${data1.totalItems || 0} items`);
    } catch (error) {
      throw new Error(`Failed to load file 1: ${error.message}`);
    }

    try {
      const content2 = fs.readFileSync(file2Path, 'utf8');
      data2 = JSON.parse(content2);
      console.log(`✅ File 2 loaded: ${data2.totalItems || 0} items`);
    } catch (error) {
      throw new Error(`Failed to load file 2: ${error.message}`);
    }

    // Extract blocks for comparison
    const blocks1 = data1.data?.allItemsInOrder || [];
    const blocks2 = data2.data?.allItemsInOrder || [];

    console.log(`🔄 Comparing ${blocks1.length} blocks from file 1 with ${blocks2.length} blocks from file 2...`);

    // Create hash maps for fast lookup
    const hashMap1 = new Map();
    const hashMap2 = new Map();

    // Build hash maps
    blocks1.forEach((block, index) => {
      const hash = this.generateBlockHash(block);
      if (!hashMap1.has(hash)) {
        hashMap1.set(hash, []);
      }
      hashMap1.get(hash).push({ block, originalIndex: index });
    });

    blocks2.forEach((block, index) => {
      const hash = this.generateBlockHash(block);
      if (!hashMap2.has(hash)) {
        hashMap2.set(hash, []);
      }
      hashMap2.get(hash).push({ block, originalIndex: index });
    });

    // Find exact matches
    this.exactMatches = [];
    const processedHashes = new Set();

    for (const [hash, items1] of hashMap1) {
      if (hashMap2.has(hash) && !processedHashes.has(hash)) {
        const items2 = hashMap2.get(hash);
        
        // For each item in file 1 with this hash
        for (const item1 of items1) {
          // Find exact match in file 2
          for (const item2 of items2) {
            if (this.isBlockEqual(item1.block, item2.block)) {
              this.exactMatches.push({
                block: { ...item1.block }, // Create copy
                file1Index: item1.originalIndex,
                file2Index: item2.originalIndex,
                hash: hash
              });
              break; // Only match once per block from file 1
            }
          }
        }
        
        processedHashes.add(hash);
      }
    }

    console.log(`✅ Found ${this.exactMatches.length} exact matches`);

    // Generate comparison results
    const comparisonResult = {
      comparedAt: new Date().toISOString(),
      file1: {
        path: file1Path,
        url: data1.url,
        title: data1.title,
        totalItems: data1.totalItems,
        totalWords: data1.totalWords
      },
      file2: {
        path: file2Path,
        url: data2.url,
        title: data2.title,
        totalItems: data2.totalItems,
        totalWords: data2.totalWords
      },
      comparison: {
        totalExactMatches: this.exactMatches.length,
        file1UniqueBlocks: blocks1.length - this.exactMatches.length,
        file2UniqueBlocks: blocks2.length - this.exactMatches.length,
        matchPercentageFile1: ((this.exactMatches.length / blocks1.length) * 100).toFixed(2),
        matchPercentageFile2: ((this.exactMatches.length / blocks2.length) * 100).toFixed(2)
      },
      data: {
        exactMatches: this.exactMatches.map(match => ({
          block: match.block,
          indices: {
            file1: match.file1Index,
            file2: match.file2Index
          },
          hash: match.hash
        }))
      }
    };

    return comparisonResult;
  }

  // Save comparison results to file
  saveResults(comparisonResult, outputFileName = null) {
    if (!outputFileName) {
      const timestamp = Date.now();
      outputFileName = `comparison_${timestamp}.json`;
    }

    const outputPath = path.join(this.outputDir, outputFileName);
    
    try {
      fs.writeFileSync(outputPath, JSON.stringify(comparisonResult, null, 2), 'utf8');
      console.log(`💾 Comparison results saved to: ${outputPath}`);
      return outputPath;
    } catch (error) {
      throw new Error(`Failed to save results: ${error.message}`);
    }
  }

  // Compare two files and save results
  async compareAndSave(file1Path, file2Path, outputFileName = null) {
    try {
      const startTime = Date.now();
      
      const results = this.compareFiles(file1Path, file2Path);
      const savedPath = this.saveResults(results, outputFileName);
      
      const duration = Date.now() - startTime;
      
      console.log('🏆 =====================================');
      console.log('🏆 COMPARISON COMPLETED SUCCESSFULLY');
      console.log(`⏱️ Duration: ${duration}ms`);
      console.log(`📊 Total Matches: ${results.comparison.totalExactMatches}`);
      console.log(`📈 Match Rate File 1: ${results.comparison.matchPercentageFile1}%`);
      console.log(`📈 Match Rate File 2: ${results.comparison.matchPercentageFile2}%`);
      console.log(`💾 Results saved: ${savedPath}`);
      console.log('🏆 =====================================');
      
      return {
        success: true,
        results: results,
        savedPath: savedPath,
        duration: duration
      };
      
    } catch (error) {
      console.error('❌ Comparison failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Batch compare multiple files
  async compareMultipleFiles(filePairs) {
    const results = [];
    
    for (let i = 0; i < filePairs.length; i++) {
      const [file1, file2] = filePairs[i];
      console.log(`\n🔄 [${i + 1}/${filePairs.length}] Comparing files...`);
      
      const result = await this.compareAndSave(file1, file2, `batch_comparison_${i + 1}_${Date.now()}.json`);
      results.push(result);
      
      // Add small delay between comparisons
      if (i < filePairs.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    return results;
  }
}

// Export for use as module
module.exports = ExtractedDataComparator;

// CLI usage when run directly
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('📖 Usage:');
    console.log('  node compareExtractedData.js <file1.json> <file2.json> [outputFileName.json]');
    console.log('');
    console.log('📝 Example:');
    console.log('  node compareExtractedData.js extracted_text/file1.json extracted_text/file2.json');
    console.log('  node compareExtractedData.js extracted_text/file1.json extracted_text/file2.json custom_output.json');
    process.exit(1);
  }

  const file1Path = args[0];
  const file2Path = args[1];
  const outputFileName = args[2] || null;

  // Check if files exist
  if (!fs.existsSync(file1Path)) {
    console.error(`❌ File 1 not found: ${file1Path}`);
    process.exit(1);
  }

  if (!fs.existsSync(file2Path)) {
    console.error(`❌ File 2 not found: ${file2Path}`);
    process.exit(1);
  }

  // Run comparison
  const comparator = new ExtractedDataComparator();
  comparator.compareAndSave(file1Path, file2Path, outputFileName);
}
