const { Pool } = require('pg');

class PostgreSQLDatabase {
  constructor() {
    // Enhanced connection configuration with better SSL handling and reliability
    const connectionConfig = {
      connectionString: process.env.DATABASE_URL,
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000, // Increased timeout
      statement_timeout: 30000, // 30 second statement timeout
      query_timeout: 30000, // 30 second query timeout
    };

    // Better SSL configuration for remote databases
    if (process.env.DATABASE_URL) {
      if (process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')) {
        connectionConfig.ssl = false; // Local development
      } else {
        connectionConfig.ssl = { rejectUnauthorized: false }; // Remote databases (Replit, cloud)
      }
    } else {
      connectionConfig.ssl = false; // Fallback for missing DATABASE_URL
    }

    this.pool = new Pool(connectionConfig);

    this.isReady = false;
    this.initPromise = this.init();
  }

  // Initialize database and create tables with retry logic
  async init() {
    const maxRetries = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔄 PostgreSQL connection attempt ${attempt}/${maxRetries}...`);

        // Test connection with timeout
        const client = await this.pool.connect();
        console.log('✅ Connected to PostgreSQL database');
        client.release();

        await this.createTables();
        this.isReady = true;
        console.log('✅ PostgreSQL database initialized successfully');
        return; // Success, exit the retry loop

      } catch (error) {
        lastError = error;
        console.error(`❌ PostgreSQL connection attempt ${attempt} failed:`, error.message);

        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
          console.log(`⏳ Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    console.error('❌ All PostgreSQL connection attempts failed');
    throw lastError;
  }

  // Ensure database is ready
  async ready() {
    if (!this.isReady) {
      await this.initPromise;
    }
    return this.isReady;
  }

  // Create simple database schema for content file storage
  async createTables() {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Content Files table - tracks content files stored on disk (simplified)
      const contentFilesSQL = `
        CREATE TABLE IF NOT EXISTS content_files (
          id SERIAL PRIMARY KEY,
          url VARCHAR(1000) NOT NULL,
          url_hash VARCHAR(32) UNIQUE NOT NULL,
          domain VARCHAR(255) NOT NULL,

          -- File information
          file_path VARCHAR(500) NOT NULL,
          file_name VARCHAR(100) NOT NULL,
          file_size INTEGER DEFAULT 0,

          -- Content metadata
          title TEXT,
          content_blocks INTEGER DEFAULT 0,
          unique_blocks INTEGER DEFAULT 0,
          estimated_words INTEGER DEFAULT 0,

          -- Processing metadata
          extraction_method VARCHAR(50) NOT NULL,
          filter_method VARCHAR(50) NOT NULL,
          processing_time INTEGER DEFAULT 0,

          -- Quality metrics
          content_quality_score FLOAT DEFAULT 0.0,

          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `;

      // Execute table creation query
      await client.query(contentFilesSQL);

      // Create indexes for performance
      const indexQueries = [
        'CREATE INDEX IF NOT EXISTS idx_content_files_url_hash ON content_files(url_hash);',
        'CREATE INDEX IF NOT EXISTS idx_content_files_domain ON content_files(domain);',
        'CREATE INDEX IF NOT EXISTS idx_content_files_method ON content_files(extraction_method);',
        'CREATE INDEX IF NOT EXISTS idx_content_files_created ON content_files(created_at);',
      ];

      for (const indexQuery of indexQueries) {
        await client.query(indexQuery);
      }

      await client.query('COMMIT');
      console.log('✅ PostgreSQL simple schema created successfully');
      console.log('📊 Schema designed for simple content file storage');

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('❌ Error creating tables:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  // Get a database client from the pool
  async getClient() {
    await this.ready();
    return this.pool.connect();
  }

  // Execute a query with automatic client management
  async query(text, params) {
    await this.ready();
    const client = await this.pool.connect();
    try {
      const result = await client.query(text, params);
      return result;
    } finally {
      client.release();
    }
  }

  // Generate hash for URL
  generateUrlHash(url) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(url).digest('hex');
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

  // Save content file information
  async saveContentFile(url, domain, filePath, fileName, fileSize, contentMetadata, processingTime = 0) {
    await this.ready();
    const urlHash = this.generateUrlHash(url);

    // If domain is not provided, extract from URL
    if (!domain) {
      domain = this.extractDomainName(url);
    }

    try {
      const sql = `
        INSERT INTO content_files 
        (url, url_hash, domain, file_path, file_name, file_size, title, 
         content_blocks, unique_blocks, estimated_words, extraction_method, 
         filter_method, processing_time, content_quality_score, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
        ON CONFLICT (url_hash) DO UPDATE SET
          file_path = EXCLUDED.file_path,
          file_name = EXCLUDED.file_name,
          file_size = EXCLUDED.file_size,
          title = EXCLUDED.title,
          content_blocks = EXCLUDED.content_blocks,
          unique_blocks = EXCLUDED.unique_blocks,
          estimated_words = EXCLUDED.estimated_words,
          extraction_method = EXCLUDED.extraction_method,
          filter_method = EXCLUDED.filter_method,
          processing_time = EXCLUDED.processing_time,
          content_quality_score = EXCLUDED.content_quality_score,
          updated_at = NOW()
      `;

      await this.query(sql, [
        url, urlHash, domain, filePath, fileName, fileSize,
        contentMetadata.title || '',
        contentMetadata.contentBlocks || 0,
        contentMetadata.uniqueBlocks || 0,
        contentMetadata.estimatedWords || 0,
        contentMetadata.extractionMethod || 'unknown',
        contentMetadata.filterMethod || 'none',
        processingTime,
        contentMetadata.qualityScore || 0.0
      ]);

      console.log(`✅ Content file information saved: ${fileName}`);
      return {
        urlHash: urlHash,
        success: true
      };
    } catch (error) {
      console.error('❌ Error saving content file information:', error.message);
      throw error;
    }
  }

  // Get content file information by URL
  async getContentFile(url) {
    await this.ready();
    const urlHash = this.generateUrlHash(url);

    try {
      const sql = 'SELECT * FROM content_files WHERE url_hash = $1';
      const result = await this.query(sql, [urlHash]);

      if (result.rows.length > 0) {
        const row = result.rows[0];
        return {
          id: row.id,
          url: row.url,
          urlHash: row.url_hash,
          domain: row.domain,
          filePath: row.file_path,
          fileName: row.file_name,
          fileSize: row.file_size,
          title: row.title,
          contentBlocks: row.content_blocks,
          uniqueBlocks: row.unique_blocks,
          estimatedWords: row.estimated_words,
          extractionMethod: row.extraction_method,
          filterMethod: row.filter_method,
          processingTime: row.processing_time,
          qualityScore: row.content_quality_score,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        };
      } else {
        return null;
      }
    } catch (error) {
      console.error('❌ Error getting content file information:', error.message);
      throw error;
    }
  }

  // List all content files
  async listContentFiles(limit = 100, offset = 0) {
    await this.ready();

    try {
      const sql = `
        SELECT * FROM content_files 
        ORDER BY created_at DESC 
        LIMIT $1 OFFSET $2
      `;
      
      const result = await this.query(sql, [limit, offset]);
      
      return result.rows.map(row => ({
        id: row.id,
        url: row.url,
        urlHash: row.url_hash,
        domain: row.domain,
        filePath: row.file_path,
        fileName: row.file_name,
        fileSize: row.file_size,
        title: row.title,
        contentBlocks: row.content_blocks,
        uniqueBlocks: row.unique_blocks,
        estimatedWords: row.estimated_words,
        extractionMethod: row.extraction_method,
        filterMethod: row.filter_method,
        processingTime: row.processing_time,
        qualityScore: row.content_quality_score,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      }));
    } catch (error) {
      console.error('❌ Error listing content files:', error.message);
      throw error;
    }
  }

  // Get simple statistics
  async getStatistics() {
    await this.ready();

    try {
      const sql = `
        SELECT 
          COUNT(*) as total_content_files,
          COUNT(DISTINCT domain) as unique_domains,
          SUM(file_size) as total_file_size,
          AVG(processing_time) as avg_processing_time,
          AVG(content_quality_score) as avg_quality_score
        FROM content_files
      `;

      const result = await this.query(sql, []);
      const row = result.rows[0];

      return {
        totalContentFiles: parseInt(row.total_content_files) || 0,
        uniqueDomains: parseInt(row.unique_domains) || 0,
        totalFileSize: parseInt(row.total_file_size) || 0,
        avgProcessingTime: Math.round(parseFloat(row.avg_processing_time) || 0),
        avgQualityScore: parseFloat(row.avg_quality_score) || 0.0
      };
    } catch (error) {
      console.error('❌ Error getting statistics:', error.message);
      throw error;
    }
  }

  // Close all connections
  async close() {
    await this.pool.end();
    console.log('✅ PostgreSQL database connections closed');
  }
}

module.exports = new PostgreSQLDatabase();
