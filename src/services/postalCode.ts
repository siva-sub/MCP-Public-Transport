import { logger } from '../utils/logger.js';
import { CacheService } from './cache.js';
import { APIError, ValidationError } from '../utils/errors.js';
import { LocationResult, OneMapSearchResult } from '../types/location.js';

// Define enhanced OneMapService interface
interface OneMapServiceInterface {
  geocodeWithAuth(query: string): Promise<OneMapSearchResult[]>;
}

export class PostalCodeService {
  constructor(
    private oneMapService: OneMapServiceInterface,
    private cache?: CacheService
  ) {}

  isValidSingaporePostalCode(code: string): boolean {
    // Singapore postal codes are exactly 6 digits
    return /^\d{6}$/.test(code);
  }

  extractPostalCodeFromText(text: string): string | null {
    // Extract 6-digit postal codes from text
    const matches = text.match(/\b\d{6}\b/g);
    return matches ? matches[0] : null;
  }

  async getLocationFromPostalCode(postalCode: string): Promise<LocationResult | null> {
    if (!this.isValidSingaporePostalCode(postalCode)) {
      throw new ValidationError(`Invalid Singapore postal code: ${postalCode}`);
    }

    const cacheKey = `postal_${postalCode}`;
    
    if (this.cache) {
      try {
        const cached = await this.cache.get<LocationResult>(cacheKey);
        if (cached) {
          logger.debug(`Postal code ${postalCode} found in cache`);
          return cached;
        }
      } catch (error) {
        logger.warn('Cache lookup failed for postal code', { postalCode, error });
      }
    }

    try {
      logger.info(`Resolving postal code: ${postalCode}`);
      
      // Search using postal code directly
      const searchResults = await this.oneMapService.geocodeWithAuth(postalCode);
      
      if (searchResults.length === 0) {
        logger.warn(`No results found for postal code: ${postalCode}`);
        return null;
      }

      // Take the first result (most relevant)
      const result = this.convertToLocationResult(searchResults[0], postalCode);
      
      // Cache successful results for 24 hours
      if (this.cache) {
        try {
          await this.cache.set(cacheKey, result, 86400);
          logger.debug(`Cached postal code result: ${postalCode}`);
        } catch (error) {
          logger.warn('Failed to cache postal code result', { postalCode, error });
        }
      }
      
      logger.info(`Successfully resolved postal code ${postalCode} to ${result.displayName}`);
      return result;
    } catch (error) {
      logger.error(`Failed to resolve postal code ${postalCode}`, error);
      
      if (error instanceof APIError) {
        throw error;
      }
      
      throw new APIError(
        `Failed to resolve postal code ${postalCode}`,
        'POSTAL_CODE_RESOLUTION_FAILED',
        500
      );
    }
  }

  async validateAndResolvePostalCode(input: string): Promise<LocationResult | null> {
    // First try to extract postal code from input
    const postalCode = this.extractPostalCodeFromText(input);
    
    if (!postalCode) {
      // If input is exactly 6 digits, treat as postal code
      if (this.isValidSingaporePostalCode(input.trim())) {
        return this.getLocationFromPostalCode(input.trim());
      }
      return null;
    }
    
    return this.getLocationFromPostalCode(postalCode);
  }

  private convertToLocationResult(oneMapResult: OneMapSearchResult, postalCode: string): LocationResult {
    const lat = parseFloat(oneMapResult.LATITUDE);
    const lng = parseFloat(oneMapResult.LONGITUDE);
    const x = parseFloat(oneMapResult.X);
    const y = parseFloat(oneMapResult.Y);

    // Validate coordinates
    if (isNaN(lat) || isNaN(lng) || isNaN(x) || isNaN(y)) {
      throw new APIError(
        `Invalid coordinates in OneMap response for postal code ${postalCode}`,
        'INVALID_COORDINATES',
        422
      );
    }

    // Determine building name (handle 'NIL' values from OneMap)
    const buildingName = oneMapResult.BUILDING && oneMapResult.BUILDING !== 'NIL' 
      ? oneMapResult.BUILDING 
      : undefined;
    
    const blockNumber = oneMapResult.BLK_NO && oneMapResult.BLK_NO !== 'NIL' 
      ? oneMapResult.BLK_NO 
      : undefined;

    // Create a meaningful display name
    let displayName = oneMapResult.ADDRESS;
    if (!displayName || displayName === 'NIL') {
      displayName = buildingName 
        ? `${buildingName}, Singapore ${postalCode}`
        : `${oneMapResult.ROAD_NAME}, Singapore ${postalCode}`;
    }

    // Determine location name
    const name = buildingName || 
                 oneMapResult.ROAD_NAME || 
                 `Postal Code ${postalCode}`;

    return {
      id: `postal_${postalCode}`,
      name,
      displayName,
      coordinates: {
        wgs84: { lat, lng },
        svy21: { x, y },
      },
      address: {
        buildingName,
        blockNumber,
        streetName: oneMapResult.ROAD_NAME,
        postalCode: oneMapResult.POSTAL || postalCode,
        formattedAddress: oneMapResult.ADDRESS,
      },
      locationTypes: ['POSTAL_CODE'],
      confidence: 0.95, // High confidence for exact postal code matches
      metadata: {
        source: 'onemap',
        lastUpdated: new Date().toISOString(),
        isLandmark: false,
        searchStrategy: 'postal_code',
      },
    };
  }

  // Get district information from postal code
  getDistrictFromPostalCode(postalCode: string): string | null {
    if (!this.isValidSingaporePostalCode(postalCode)) {
      return null;
    }

    const firstTwoDigits = parseInt(postalCode.substring(0, 2));
    
    // Singapore postal code district mapping (simplified)
    const districtMap: Record<string, string> = {
      '01-09': 'Downtown Core / Boat Quay / Chinatown',
      '10-16': 'Tanjong Pagar / Shenton Way',
      '17-19': 'Newton / Novena',
      '20-21': 'Orchard / River Valley',
      '22-23': 'Bukit Timah',
      '24-27': 'Clementi / West Coast',
      '28-30': 'Jurong',
      '31-33': 'Bukit Batok / Choa Chu Kang',
      '34-36': 'Kranji / Woodlands',
      '37-38': 'Yishun',
      '39-41': 'Ang Mo Kio',
      '42-45': 'Bishan / Thomson',
      '46-48': 'Toa Payoh',
      '49-50': 'Balestier / Serangoon',
      '51-52': 'MacPherson / Potong Pasir',
      '53-55': 'Geylang',
      '56-57': 'Katong / Marine Parade',
      '58-59': 'Bedok',
      '60-64': 'Changi / Tampines',
      '65-67': 'Pasir Ris',
      '68-69': 'Sengkang',
      '70-73': 'Hougang / Punggol',
      '75-80': 'Yio Chu Kang / Seletar',
      '81': 'Sentosa',
      '82': 'Punggol',
    };

    for (const [range, district] of Object.entries(districtMap)) {
      const [start, end] = range.split('-').map(num => parseInt(num));
      if (firstTwoDigits >= start && firstTwoDigits <= end) {
        return district;
      }
    }

    return null;
  }

  // Check if postal code is in a specific area
  isInArea(postalCode: string, area: string): boolean {
    const district = this.getDistrictFromPostalCode(postalCode);
    return district ? district.toLowerCase().includes(area.toLowerCase()) : false;
  }

  // Get area type from postal code
  getAreaType(postalCode: string): string | null {
    if (!this.isValidSingaporePostalCode(postalCode)) {
      return null;
    }

    const firstTwoDigits = parseInt(postalCode.substring(0, 2));
    
    if (firstTwoDigits >= 1 && firstTwoDigits <= 30) {
      return 'Central/West Singapore';
    } else if (firstTwoDigits >= 31 && firstTwoDigits <= 50) {
      return 'North Singapore';
    } else if (firstTwoDigits >= 51 && firstTwoDigits <= 82) {
      return 'East Singapore';
    }
    
    return null;
  }
}
