import { config } from '../config';
import { ServerError } from '../middleware/errorHandler';
import { ERROR_CODES } from '@shared/errors';

export class SourceValidator {
  private allowedDomains: string[];
  private verificationTimeout: number;
  private maxRetries: number;

  constructor() {
    // Use configuration instead of hardcoded values
    this.allowedDomains = [...config.sourceValidation.allowedDomains];
    this.verificationTimeout = config.sourceValidation.verificationTimeout;
    this.maxRetries = config.sourceValidation.maxRetries;
  }

  async validateSource(url: string): Promise<boolean> {
    if (!url || typeof url !== 'string') {
      return false;
    }

    try {
      const urlObj = new URL(url);
      const domain = urlObj.hostname.replace('www.', '');
      
      return this.allowedDomains.some(allowedDomain => 
        domain === allowedDomain || domain.endsWith(`.${allowedDomain}`)
      );
    } catch (error) {
      console.error('Invalid URL provided:', error);
      return false;
    }
  }

  getAllowedDomains(): string[] {
    return [...this.allowedDomains];
  }

  async verifySourceAvailability(url: string): Promise<boolean> {
    if (!this.validateSource(url)) {
      throw ServerError.business(
        ERROR_CODES.SOURCE_VALIDATION_FAILED,
        'De opgegeven URL is niet van een toegestane bron',
        { url, allowedDomains: this.allowedDomains }
      );
    }

    let lastError: Error | null = null;
    
    // Retry logic based on configuration
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.verificationTimeout);
        
        const response = await fetch(url, { 
          method: 'HEAD',
          signal: controller.signal,
          headers: {
            'User-Agent': 'De-Fiscale-Analist-Bot/1.0'
          }
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          return true;
        }
        
        lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`Source verification attempt ${attempt + 1}/${this.maxRetries} failed for ${url}:`, error);
        
        // Wait before retry (exponential backoff)
        if (attempt < this.maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
        }
      }
    }

    throw ServerError.business(
      ERROR_CODES.SOURCE_VALIDATION_FAILED,
      'De bron is niet beschikbaar of toegankelijk',
      { 
        url, 
        attempts: this.maxRetries, 
        lastError: lastError?.message 
      }
    );
  }

  /**
   * Validates multiple URLs concurrently
   */
  async validateSources(urls: string[]): Promise<{ valid: string[], invalid: string[] }> {
    const results = await Promise.allSettled(
      urls.map(async (url) => {
        const isValid = await this.validateSource(url);
        return { url, isValid };
      })
    );

    const valid: string[] = [];
    const invalid: string[] = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.isValid) {
        valid.push(result.value.url);
      } else {
        invalid.push(urls[index]);
      }
    });

    return { valid, invalid };
  }

  /**
   * Gets validation statistics
   */
  getValidationStats() {
    return {
      allowedDomains: this.allowedDomains.length,
      verificationTimeout: this.verificationTimeout,
      maxRetries: this.maxRetries,
      supportedDomains: this.allowedDomains
    };
  }
}