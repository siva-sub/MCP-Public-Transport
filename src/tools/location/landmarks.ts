/**
 * Landmarks and Facilities Discovery Tool
 * Uses OneMap Themes API to find landmarks, facilities, and points of interest
 */

import { z } from 'zod';
import { BaseTool, ToolDefinition } from '../base.js';
import { ThemesService, ThemeSearchResult } from '../../services/themes.js';
import { OneMapService } from '../../services/onemap.js';
import { validateInput } from '../../utils/validation.js';
import { logger } from '../../utils/logger.js';

const LandmarkSearchInputSchema = z.object({
  location: z.union([
    z.string().min(1, 'Location must be provided'),
    z.object({
      postalCode: z.string().regex(/^\d{6}$/, 'Postal code must be 6 digits'),
    }),
    z.object({
      latitude: z.number().min(1.0).max(1.5),
      longitude: z.number().min(103.0).max(104.5),
      name: z.string().optional(),
    }),
  ]),
  radius: z.number().min(100).max(5000).default(1000),
  categories: z.array(z.string()).optional(),
  facilityType: z.string().optional(),
  maxResults: z.number().min(1).max(50).default(20),
});

interface LandmarkSearchResponse {
  success: boolean;
  location: {
    name: string;
    coordinates: [number, number];
    address?: string;
  };
  searchRadius: number;
  results: Array<{
    category: string;
    theme: string;
    facilities: Array<{
      name: string;
      description: string;
      distance: number;
      coordinates: [number, number];
      category: string;
      owner: string;
      website?: string;
      additionalInfo?: Record<string, any>;
    }>;
    totalCount: number;
  }>;
  summary: {
    totalFacilities: number;
    categoriesFound: string[];
    nearestFacility?: {
      name: string;
      distance: number;
      category: string;
    };
  };
  metadata: {
    searchTime: number;
    apiCalls: number;
    cacheHits: number;
  };
}

export class LandmarksDiscoveryTool extends BaseTool {
  constructor(
    private themesService: ThemesService,
    private oneMapService: OneMapService
  ) {
    super();
  }

  getDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'find_landmarks_and_facilities',
        description: 'Discover landmarks, facilities, and points of interest near a location using Singapore\'s comprehensive thematic data',
        inputSchema: this.createSchema({
          location: {
            oneOf: [
              {
                type: 'string',
                description: 'Location as address, landmark, or postal code (e.g., "Marina Bay", "Orchard Road", "828770")',
              },
              {
                type: 'object',
                properties: {
                  postalCode: {
                    type: 'string',
                    pattern: '^\\d{6}$',
                    description: 'Singapore postal code (6 digits)',
                  },
                },
                required: ['postalCode'],
                description: 'Location as postal code object',
              },
              {
                type: 'object',
                properties: {
                  latitude: {
                    type: 'number',
                    minimum: 1.0,
                    maximum: 1.5,
                    description: 'Latitude coordinate',
                  },
                  longitude: {
                    type: 'number',
                    minimum: 103.0,
                    maximum: 104.5,
                    description: 'Longitude coordinate',
                  },
                  name: {
                    type: 'string',
                    description: 'Optional location name',
                  },
                },
                required: ['latitude', 'longitude'],
                description: 'Location as coordinates',
              },
            ],
            description: 'Target location to search around',
          },
          radius: {
            type: 'number',
            minimum: 100,
            maximum: 5000,
            default: 1000,
            description: 'Search radius in meters (100-5000m)',
          },
          categories: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['education', 'health', 'community', 'recreation', 'transport', 'shopping', 'tourism', 'government', 'religious', 'sports'],
            },
            description: 'Filter by specific categories (optional)',
          },
          facilityType: {
            type: 'string',
            description: 'Search for specific facility types (e.g., "schools", "hospitals", "parks", "libraries")',
          },
          maxResults: {
            type: 'number',
            minimum: 1,
            maximum: 50,
            default: 20,
            description: 'Maximum number of results to return per category',
          },
        }, ['location']),
      },
    ];
  }

  canHandle(toolName: string): boolean {
    return toolName === 'find_landmarks_and_facilities';
  }

  async execute(toolName: string, args: unknown): Promise<LandmarkSearchResponse> {
    const startTime = Date.now();
    let apiCalls = 0;
    let cacheHits = 0;

    try {
      const input = validateInput(LandmarkSearchInputSchema, args);
      
      logger.info('Finding landmarks and facilities', {
        location: input.location,
        radius: input.radius,
        categories: input.categories,
        facilityType: input.facilityType
      });

      // Resolve the location
      const location = await this.resolveLocation(input.location);
      apiCalls++;

      if (!location) {
        return this.createErrorResponse('Could not resolve the specified location', startTime, apiCalls, cacheHits);
      }

      let searchResults: ThemeSearchResult[] = [];

      // Search by specific facility type if provided
      if (input.facilityType) {
        searchResults = await this.themesService.findFacilitiesByType(
          input.facilityType,
          location.latitude,
          location.longitude,
          input.radius
        );
        apiCalls += 3; // Estimate for theme searches
      } else {
        // Search for landmarks near location
        searchResults = await this.themesService.findLandmarksNear(
          location.latitude,
          location.longitude,
          input.radius,
          input.categories
        );
        apiCalls += 5; // Estimate for theme searches
      }

      // Process and format results
      const formattedResults = this.formatSearchResults(searchResults, input.maxResults || 20);
      
      // Generate summary
      const summary = this.generateSummary(formattedResults);

      const processingTime = Date.now() - startTime;

      return {
        success: true,
        location: {
          name: location.name || 'Unknown Location',
          coordinates: [location.latitude, location.longitude],
          address: location.address,
        },
        searchRadius: input.radius || 1000,
        results: formattedResults,
        summary,
        metadata: {
          searchTime: processingTime,
          apiCalls,
          cacheHits,
        },
      };

    } catch (error) {
      logger.error(`Landmark search failed: ${toolName}`, error);
      return this.createErrorResponse(
        error instanceof Error ? error.message : 'Unknown error occurred',
        startTime,
        apiCalls,
        cacheHits
      );
    }
  }

  private async resolveLocation(locationInput: any) {
    try {
      // Handle coordinate objects
      if (locationInput && typeof locationInput === 'object' && 'latitude' in locationInput) {
        return {
          latitude: locationInput.latitude,
          longitude: locationInput.longitude,
          name: locationInput.name || 'Custom Location',
          address: locationInput.name || `${locationInput.latitude.toFixed(6)}, ${locationInput.longitude.toFixed(6)}`,
        };
      }

      // Handle postal code objects
      if (locationInput && typeof locationInput === 'object' && 'postalCode' in locationInput) {
        return await this.oneMapService.geocode(locationInput.postalCode);
      }

      // Handle string inputs (addresses, landmarks, postal codes)
      if (typeof locationInput === 'string') {
        return await this.oneMapService.geocode(locationInput);
      }

      return null;
    } catch (error) {
      logger.error('Location resolution failed', { error, input: locationInput });
      return null;
    }
  }

  private formatSearchResults(searchResults: ThemeSearchResult[], maxResults: number) {
    return searchResults.map(result => ({
      category: result.theme.category,
      theme: result.theme.themeName,
      facilities: result.features.slice(0, maxResults).map(feature => ({
        name: feature.name,
        description: feature.description,
        distance: Math.round(feature.distance ?? 0),
        coordinates: feature.coordinates,
        category: feature.category,
        owner: feature.owner,
        website: feature.hyperlink,
        additionalInfo: this.extractAdditionalInfo(feature.properties),
      })),
      totalCount: result.totalCount,
    })).filter(result => result.facilities.length > 0);
  }

  private extractAdditionalInfo(properties: Record<string, any>): Record<string, any> {
    const additionalInfo: Record<string, any> = {};
    
    // Extract useful properties while filtering out internal data
    const relevantKeys = ['CASE_SIZE', 'HOMES', 'PUBLIC_PLACES', 'SYMBOLCOLOR', 'Type'];
    
    for (const key of relevantKeys) {
      if (properties[key] && properties[key] !== '') {
        additionalInfo[key.toLowerCase()] = properties[key];
      }
    }

    return additionalInfo;
  }

  private generateSummary(results: any[]) {
    const totalFacilities = results.reduce((sum, result) => sum + result.facilities.length, 0);
    const categoriesFound = [...new Set(results.map(result => result.category))];
    
    let nearestFacility: any = undefined;
    let minDistance = Infinity;

    for (const result of results) {
      for (const facility of result.facilities) {
        if (facility.distance < minDistance) {
          minDistance = facility.distance;
          nearestFacility = {
            name: facility.name,
            distance: facility.distance,
            category: facility.category,
          };
        }
      }
    }

    return {
      totalFacilities,
      categoriesFound,
      nearestFacility,
    };
  }

  private createErrorResponse(message: string, startTime: number, apiCalls: number, cacheHits: number): LandmarkSearchResponse {
    return {
      success: false,
      location: {
        name: 'Unknown',
        coordinates: [0, 0],
      },
      searchRadius: 0,
      results: [],
      summary: {
        totalFacilities: 0,
        categoriesFound: [],
      },
      metadata: {
        searchTime: Date.now() - startTime,
        apiCalls,
        cacheHits,
      },
    };
  }
}
