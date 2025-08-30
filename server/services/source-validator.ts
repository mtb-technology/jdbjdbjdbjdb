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
      const response = await fetch(url, { 
        method: 'HEAD',
        timeout: 5000 
      });
      return response.ok;
    } catch (error) {
      console.error(`Source verification failed for ${url}:`, error);
      return false;
    }
  }
}
