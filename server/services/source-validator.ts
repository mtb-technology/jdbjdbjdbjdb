export class SourceValidator {
  private allowedDomains = [
    'belastingdienst.nl',
    'wetten.overheid.nl', 
    'rijksoverheid.nl'
  ];

  async validateSource(url: string): Promise<boolean> {
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
      return false;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch(url, { 
        method: 'HEAD',
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      console.error(`Source verification failed for ${url}:`, error);
      return false;
    }
  }
}
