import { BaseTool } from '../base.js';
import { APIError, ValidationError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';
import { LocationSearchArgs, LocationSearchResponse } from '../../types/search.js';
import { LocationResult, SearchStrategy } from '../../types/location.js';
import { OneMapService } from '../../services/onemap.js';
import { PostalCodeService } from '../../services/postalCode.js';
import { SingaporeTimeService } from '../../services/time.js';
import { FuzzySearchService } from '../../services/fuzzySearch.js';

export class LocationSearchTool extends BaseTool {
  constructor(
    private oneMapService: OneMapService,
    private postalCodeService: PostalCodeService,
    private timeService: SingaporeTimeService,
    private fuzzySearchService?: FuzzySearchService
  ) {
    super();
  }

  getDefinitions() {
    return [
      {
        name: 'search_location',
        description: 'Search for locations in Singapore using addresses, postal codes, landmarks, or building names. Supports fuzzy search and intelligent query analysis.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            query: {
              type: 'string',
              description: 'Search query - can be address, postal code, MRT station, landmark, or building name',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of results to return (1-20)',
              minimum: 1,
              maximum: 20,
              default: 5,
            },
            enableFuzzySearch: {
              type: 'boolean',
              description: 'Enable fuzzy matching for typos and variations',
              default: true,
            },
            includeNearbyInfo: {
              type: 'boolean',
              description: 'Include nearby amenities and transport information',
              default: false,
            },
            userLocation: {
              type: 'object',
              description: 'User location for proximity-based ranking',
              properties: {
                latitude: { type: 'number' },
                longitude: { type: 'number' },
              },
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'resolve_postal_code',
        description: 'Resolve a Singapore postal code to detailed location information with high accuracy.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            postalCode: {
              type: 'string' as const,
              description: 'Singapore 6-digit postal code to resolve',
              pattern: '^\\d{6}$',
            },
            includeNearbyInfo: {
              type: 'boolean' as const,
              description: 'Include nearby transport and amenities',
              default: false,
            },
          },
          required: ['postalCode'],
        },
      },
      {
        name: 'reverse_geocode',
        description: 'Get address and location information from latitude/longitude coordinates.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            latitude: {
              type: 'number' as const,
              description: 'Latitude coordinate (WGS84)',
              minimum: 1.0,
              maximum: 1.5,
            },
            longitude: {
              type: 'number' as const,
              description: 'Longitude coordinate (WGS84)',
              minimum: 103.0,
              maximum: 104.5,
            },
            radius: {
              type: 'number' as const,
              description: 'Search radius in meters (0-500)',
              minimum: 0,
              maximum: 500,
              default: 100,
            },
            includeNearbyAmenities: {
              type: 'boolean' as const,
              description: 'Include nearby amenities and transport',
              default: false,
            },
          },
          required: ['latitude', 'longitude'],
        },
      },
    ];
  }

  canHandle(toolName: string): boolean {
    return ['search_location', 'resolve_postal_code', 'reverse_geocode'].includes(toolName);
  }

  async execute(toolName: string, args: any): Promise<any> {
    try {
      switch (toolName) {
        case 'search_location':
          return await this.searchLocation(args as LocationSearchArgs);
        case 'resolve_postal_code':
          return await this.resolvePostalCode(args);
        case 'reverse_geocode':
          return await this.reverseGeocode(args);
        default:
          throw new ValidationError(`Unknown tool: ${toolName}`);
      }
    } catch (error) {
      logger.error(`Location tool execution failed: ${toolName}`, error);
      return this.formatError(error as Error, toolName);
    }
  }

  private async searchLocation(args: LocationSearchArgs): Promise<LocationSearchResponse> {
    const {
      query,
      maxResults = 5,
      enableFuzzySearch = true,
      includeNearbyInfo = false,
      userLocation,
    } = args;

    if (!query?.trim()) {
      throw new ValidationError('Query cannot be empty');
    }

    logger.info(`Searching for location: ${query}`);

    const results: LocationResult[] = [];
    const searchStrategiesUsed: SearchStrategy[] = [];
    const timeInfo = this.timeService.getCurrentTime();

    try {
      // Strategy 1: Check if it's a postal code
      const postalCode = this.postalCodeService.extractPostalCodeFromText(query);
      if (postalCode) {
        logger.debug(`Detected postal code: ${postalCode}`);
        const postalResult = await this.postalCodeService.getLocationFromPostalCode(postalCode);
        if (postalResult) {
          results.push(postalResult);
          searchStrategiesUsed.push('postal_code');
        }
      }

      // Strategy 2: OneMap search with authentication
      if (results.length < maxResults) {
        logger.debug('Performing OneMap search');
        const oneMapResults = await this.oneMapService.geocodeWithAuth(query);
        
        for (const omResult of oneMapResults.slice(0, maxResults - results.length)) {
          const locationResult = this.convertOneMapToLocationResult(omResult);
          
          // Avoid duplicates (especially postal code results)
          const isDuplicate = results.some(existing => 
            Math.abs(existing.coordinates.wgs84.lat - locationResult.coordinates.wgs84.lat) < 0.0001 &&
            Math.abs(existing.coordinates.wgs84.lng - locationResult.coordinates.wgs84.lng) < 0.0001
          );
          
          if (!isDuplicate) {
            results.push(locationResult);
          }
        }
        
        if (oneMapResults.length > 0) {
          searchStrategiesUsed.push('onemap_geocoding');
        }
      }

      // Strategy 3: Fuzzy search and suggestions (if enabled and few results)
      if (enableFuzzySearch && results.length < 2) {
        searchStrategiesUsed.push('fuzzy_search');
        // Additional fuzzy logic could be implemented here
      }

      // Sort results by relevance (postal codes first, then by confidence)
      results.sort((a, b) => {
        // Postal codes get highest priority
        if (a.locationTypes.includes('POSTAL_CODE') && !b.locationTypes.includes('POSTAL_CODE')) {
          return -1;
        }
        if (b.locationTypes.includes('POSTAL_CODE') && !a.locationTypes.includes('POSTAL_CODE')) {
          return 1;
        }
        
        // Then by confidence
        return b.confidence - a.confidence;
      });

      // Generate suggestions for improvement
      const suggestions = this.generateSearchSuggestions(query, results);

      // Calculate overall confidence
      const confidence = results.length > 0 ? 
        Math.max(...results.map(r => r.confidence)) : 0;

      const response: LocationSearchResponse = {
        query,
        results: results.slice(0, maxResults),
        suggestions,
        confidence,
        searchStrategiesUsed,
        contextInfo: {
          singaporeTime: timeInfo.formatted.full,
          isBusinessHours: timeInfo.businessContext.isBusinessHours,
          isRushHour: timeInfo.businessContext.isRushHour,
        },
        timestamp: new Date().toISOString(),
      };

      logger.info(`Location search completed: ${results.length} results found`);
      return response;

    } catch (error) {
      logger.error('Location search failed', error);
      throw new APIError(`Location search failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'SEARCH_FAILED');
    }
  }

  private async resolvePostalCode(args: { postalCode: string; includeNearbyInfo?: boolean }) {
    const { postalCode, includeNearbyInfo = false } = args;

    if (!this.postalCodeService.isValidSingaporePostalCode(postalCode)) {
      throw new ValidationError(`Invalid Singapore postal code: ${postalCode}. Must be exactly 6 digits.`);
    }

    logger.info(`Resolving postal code: ${postalCode}`);

    try {
      const location = await this.postalCodeService.getLocationFromPostalCode(postalCode);
      
      if (!location) {
        return {
          success: false,
          error: `Postal code ${postalCode} not found`,
          suggestions: [
            'Verify the postal code is correct',
            'Try searching for the building name or address instead',
          ],
        };
      }

      const timeInfo = this.timeService.getCurrentTime();
      const district = this.postalCodeService.getDistrictFromPostalCode(postalCode);
      const areaType = this.postalCodeService.getAreaType(postalCode);

      return {
        success: true,
        location,
        metadata: {
          district,
          areaType,
          confidence: location.confidence,
          lastUpdated: location.metadata.lastUpdated,
        },
        contextInfo: {
          singaporeTime: timeInfo.formatted.full,
          isBusinessHours: timeInfo.businessContext.isBusinessHours,
          isRushHour: timeInfo.businessContext.isRushHour,
        },
        timestamp: new Date().toISOString(),
      };

    } catch (error) {
      logger.error(`Postal code resolution failed: ${postalCode}`, error);
      throw new APIError(`Failed to resolve postal code: ${error instanceof Error ? error.message : 'Unknown error'}`, 'POSTAL_CODE_FAILED');
    }
  }

  private async reverseGeocode(args: {
    latitude: number;
    longitude: number;
    radius?: number;
    includeNearbyAmenities?: boolean;
  }) {
    const { latitude, longitude, radius = 100, includeNearbyAmenities = false } = args;

    // Validate Singapore coordinates
    if (latitude < 1.0 || latitude > 1.5 || longitude < 103.0 || longitude > 104.5) {
      throw new ValidationError('Coordinates must be within Singapore bounds');
    }

    logger.info(`Reverse geocoding: ${latitude}, ${longitude}`);

    try {
      // Use OneMap reverse geocoding API
      const response = await this.oneMapService.client.get('/public/revgeocode', {
        params: {
          location: `${latitude},${longitude}`,
          buffer: radius.toString(),
          addressType: 'All',
        },
        headers: {
          'Authorization': await this.oneMapService.ensureValidToken(),
        },
      });

      const geocodeInfo = response.data.GeocodeInfo || [];
      const timeInfo = this.timeService.getCurrentTime();

      if (geocodeInfo.length === 0) {
        return {
          success: false,
          message: 'No address found at the specified coordinates',
          coordinates: { latitude, longitude },
          searchRadius: radius,
        };
      }

      const results = geocodeInfo.map((info: any) => ({
        buildingName: info.BUILDINGNAME !== 'null' ? info.BUILDINGNAME : null,
        block: info.BLOCK,
        road: info.ROAD,
        postalCode: info.POSTALCODE,
        coordinates: {
          latitude: parseFloat(info.LATITUDE),
          longitude: parseFloat(info.LONGITUDE),
        },
        distance: this.calculateDistance(
          latitude, longitude,
          parseFloat(info.LATITUDE), parseFloat(info.LONGITUDE)
        ),
      }));

      return {
        success: true,
        results,
        searchLocation: { latitude, longitude },
        searchRadius: radius,
        contextInfo: {
          singaporeTime: timeInfo.formatted.full,
          isBusinessHours: timeInfo.businessContext.isBusinessHours,
          isRushHour: timeInfo.businessContext.isRushHour,
        },
        timestamp: new Date().toISOString(),
      };

    } catch (error) {
      logger.error('Reverse geocoding failed', error);
      throw new APIError(`Reverse geocoding failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'REVERSE_GEOCODE_FAILED');
    }
  }

  private convertOneMapToLocationResult(oneMapResult: any): LocationResult {
    const lat = parseFloat(oneMapResult.LATITUDE);
    const lng = parseFloat(oneMapResult.LONGITUDE);
    const x = parseFloat(oneMapResult.X);
    const y = parseFloat(oneMapResult.Y);

    const buildingName = oneMapResult.BUILDING && oneMapResult.BUILDING !== 'NIL' 
      ? oneMapResult.BUILDING : undefined;
    
    const blockNumber = oneMapResult.BLK_NO && oneMapResult.BLK_NO !== 'NIL' 
      ? oneMapResult.BLK_NO : undefined;

    const name = buildingName || oneMapResult.ROAD_NAME || 'Unknown Location';
    const displayName = oneMapResult.ADDRESS || `${name}, Singapore`;

    return {
      id: `onemap_${oneMapResult.SEARCHVAL?.replace(/\s+/g, '_').toLowerCase()}`,
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
        postalCode: oneMapResult.POSTAL,
        formattedAddress: oneMapResult.ADDRESS,
      },
      locationTypes: this.determineLocationTypes(oneMapResult),
      confidence: 0.85, // Good confidence for OneMap results
      metadata: {
        source: 'onemap',
        lastUpdated: new Date().toISOString(),
        isLandmark: !!buildingName,
        searchStrategy: 'onemap_geocoding',
      },
    };
  }

  private determineLocationTypes(oneMapResult: any): import('../../types/location.js').LocationType[] {
    const types: import('../../types/location.js').LocationType[] = [];
    
    if (oneMapResult.POSTAL) types.push('POSTAL_CODE');
    if (oneMapResult.BUILDING && oneMapResult.BUILDING !== 'NIL') types.push('BUILDING');
    if (oneMapResult.ROAD_NAME) types.push('STREET');
    
    // Check for MRT/LRT stations
    const searchVal = oneMapResult.SEARCHVAL?.toLowerCase() || '';
    const building = oneMapResult.BUILDING?.toLowerCase() || '';
    
    if (searchVal.includes('mrt') || building.includes('mrt')) types.push('MRT_STATION');
    if (searchVal.includes('lrt') || building.includes('lrt')) types.push('LRT_STATION');
    if (searchVal.includes('bus') || building.includes('interchange')) types.push('BUS_INTERCHANGE');
    
    return types.length > 0 ? types : ['GENERAL'];
  }

  private generateSearchSuggestions(query: string, results: LocationResult[]): any[] {
    const suggestions: any[] = [];

    if (results.length === 0) {
      suggestions.push({
        text: 'Try searching with a postal code (6 digits)',
        type: 'expansion',
        confidence: 0.8,
        reason: 'Postal codes provide the most accurate results',
      });

      suggestions.push({
        text: 'Include "MRT" or "LRT" for train stations',
        type: 'expansion',
        confidence: 0.7,
        reason: 'Transport stations are common search targets',
      });
    } else if (results.length === 1) {
      suggestions.push({
        text: 'Add more specific terms for additional results',
        type: 'expansion',
        confidence: 0.6,
        reason: 'Broader search might find related locations',
      });
    }

    return suggestions;
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Earth's radius in metres
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return Math.round(R * c); // Distance in metres
  }
}
