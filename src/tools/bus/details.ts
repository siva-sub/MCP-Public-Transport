import { z } from 'zod';
import { BaseTool, ToolDefinition } from '../base.js';
import { LTAService } from '../../services/lta.js';
import { OneMapService } from '../../services/onemap.js';
import { BusStop, BusService } from '../../types/transport.js';
import { logger } from '../../utils/logger.js';
import haversineDistance from 'haversine-distance';

const BusStopDetailsInputSchema = z.object({
  busStopCode: z.string().min(5, 'Bus stop code must be at least 5 characters'),
  includeServices: z.boolean().default(true),
  includeNearbyStops: z.boolean().default(true),
  includeNearbyAmenities: z.boolean().default(false),
  nearbyRadius: z.number().min(50).max(1000).default(200),
});

export interface NearbyAmenity {
  name: string;
  type: 'shopping' | 'food' | 'transport' | 'healthcare' | 'education' | 'recreation' | 'other';
  distance: number;
  walkingTime: number;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
}

export interface AccessibilityInfo {
  wheelchairAccessible: boolean;
  sheltered: boolean;
  seatingAvailable: boolean;
  tactilePaving: boolean;
  audioAnnouncements: boolean;
  notes?: string;
}

export interface BusStopDetails {
  busStopCode: string;
  description: string;
  roadName: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  services: BusService[];
  nearbyStops: Array<{
    busStopCode: string;
    description: string;
    distance: number;
    walkingTime: number;
    servicesCount: number;
  }>;
  nearbyAmenities: NearbyAmenity[];
  accessibility: AccessibilityInfo;
  locationContext: {
    district?: string;
    area?: string;
    landmarks: string[];
    transportHubs: string[];
  };
  operationalInfo: {
    operatingHours: string;
    lastUpdated: string;
    dataSource: string;
  };
}

export class BusStopDetailsTool extends BaseTool {
  constructor(
    private ltaService: LTAService,
    private oneMapService: OneMapService
  ) {
    super();
  }

  getDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'get_bus_stop_details',
        description: 'Get comprehensive details about a specific bus stop including services, nearby amenities, accessibility information, and location context.',
        inputSchema: this.createSchema({
          busStopCode: {
            type: 'string',
            description: 'Bus stop code (e.g., "83139", "01012")',
            minLength: 5,
          },
          includeServices: {
            type: 'boolean',
            default: true,
            description: 'Include bus services and real-time arrival information',
          },
          includeNearbyStops: {
            type: 'boolean',
            default: true,
            description: 'Include nearby bus stops within walking distance',
          },
          includeNearbyAmenities: {
            type: 'boolean',
            default: false,
            description: 'Include nearby amenities like shopping centers, food courts, etc.',
          },
          nearbyRadius: {
            type: 'number',
            minimum: 50,
            maximum: 1000,
            default: 200,
            description: 'Search radius in meters for nearby stops and amenities',
          },
        }, ['busStopCode']),
      },
    ];
  }

  canHandle(toolName: string): boolean {
    return toolName === 'get_bus_stop_details';
  }

  async execute(toolName: string, args: unknown): Promise<any> {
    try {
      const {
        busStopCode,
        includeServices,
        includeNearbyStops,
        includeNearbyAmenities,
        nearbyRadius,
      } = BusStopDetailsInputSchema.parse(args);

      logger.info(`Getting details for bus stop: ${busStopCode}`, {
        includeServices,
        includeNearbyStops,
        includeNearbyAmenities,
        nearbyRadius,
      });

      // Get all bus stops to find the target stop
      const allBusStops = await this.ltaService.getAllBusStops();
      const targetStop = allBusStops.find(stop => stop.busStopCode === busStopCode);

      if (!targetStop) {
        return {
          error: `Bus stop ${busStopCode} not found`,
          suggestions: [
            'Verify the bus stop code is correct',
            'Try using the search_bus_stops tool to find the correct code',
          ],
          timestamp: new Date().toISOString(),
        };
      }

      // Build the detailed response
      const details: BusStopDetails = {
        busStopCode: targetStop.busStopCode,
        description: targetStop.description,
        roadName: targetStop.roadName,
        coordinates: {
          latitude: targetStop.latitude,
          longitude: targetStop.longitude,
        },
        services: [],
        nearbyStops: [],
        nearbyAmenities: [],
        accessibility: this.inferAccessibilityInfo(targetStop),
        locationContext: await this.getLocationContext(targetStop),
        operationalInfo: {
          operatingHours: '24/7 (service dependent)',
          lastUpdated: new Date().toISOString(),
          dataSource: 'LTA DataMall',
        },
      };

      // Get bus services if requested
      if (includeServices) {
        try {
          details.services = await this.ltaService.getBusArrival(busStopCode);
        } catch (error) {
          logger.warn(`Failed to get bus services for ${busStopCode}`, error);
          details.services = [];
        }
      }

      // Get nearby stops if requested
      if (includeNearbyStops) {
        details.nearbyStops = await this.getNearbyStops(targetStop, allBusStops, nearbyRadius);
      }

      // Get nearby amenities if requested
      if (includeNearbyAmenities) {
        details.nearbyAmenities = await this.getNearbyAmenities(targetStop, nearbyRadius);
      }

      return {
        success: true,
        details,
        metadata: {
          servicesCount: details.services.length,
          nearbyStopsCount: details.nearbyStops.length,
          nearbyAmenitiesCount: details.nearbyAmenities.length,
          searchRadius: nearbyRadius,
        },
        timestamp: new Date().toISOString(),
      };

    } catch (error) {
      logger.error(`Bus stop details failed: ${toolName}`, error);
      return this.formatError(error as Error, toolName);
    }
  }

  private async getNearbyStops(
    targetStop: BusStop,
    allStops: BusStop[],
    radius: number
  ): Promise<Array<{
    busStopCode: string;
    description: string;
    distance: number;
    walkingTime: number;
    servicesCount: number;
  }>> {
    const nearbyStops = allStops
      .filter(stop => stop.busStopCode !== targetStop.busStopCode)
      .map(stop => ({
        ...stop,
        distance: haversineDistance(
          { latitude: targetStop.latitude, longitude: targetStop.longitude },
          { latitude: stop.latitude, longitude: stop.longitude }
        ),
      }))
      .filter(stop => stop.distance <= radius)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 10); // Limit to 10 nearby stops

    // Get service counts for nearby stops
    const stopsWithServices = await Promise.all(
      nearbyStops.map(async (stop) => {
        try {
          const services = await this.ltaService.getBusArrival(stop.busStopCode);
          return {
            busStopCode: stop.busStopCode,
            description: stop.description,
            distance: Math.round(stop.distance),
            walkingTime: Math.ceil(stop.distance / 80), // 80m/min walking speed
            servicesCount: services.length,
          };
        } catch (error) {
          return {
            busStopCode: stop.busStopCode,
            description: stop.description,
            distance: Math.round(stop.distance),
            walkingTime: Math.ceil(stop.distance / 80),
            servicesCount: 0,
          };
        }
      })
    );

    return stopsWithServices;
  }

  private async getNearbyAmenities(
    targetStop: BusStop,
    radius: number
  ): Promise<NearbyAmenity[]> {
    const amenities: NearbyAmenity[] = [];

    try {
      // Search for nearby amenities using OneMap
      const searchQueries = [
        'shopping mall',
        'hawker centre',
        'food court',
        'mrt station',
        'hospital',
        'school',
        'community centre',
        'park',
      ];

      for (const query of searchQueries) {
        try {
          const results = await this.oneMapService.geocodeWithAuth(
            `${query} near ${targetStop.roadName}`
          );

          for (const result of results.slice(0, 2)) { // Limit results per category
            const distance = haversineDistance(
              { latitude: targetStop.latitude, longitude: targetStop.longitude },
              { latitude: parseFloat(result.LATITUDE), longitude: parseFloat(result.LONGITUDE) }
            );

            if (distance <= radius) {
              amenities.push({
                name: result.BUILDING || result.ROAD_NAME || 'Unknown',
                type: this.categorizeAmenity(query),
                distance: Math.round(distance),
                walkingTime: Math.ceil(distance / 80),
                coordinates: {
                  latitude: parseFloat(result.LATITUDE),
                  longitude: parseFloat(result.LONGITUDE),
                },
              });
            }
          }
        } catch (error) {
          logger.debug(`Failed to search for ${query}`, error);
        }
      }
    } catch (error) {
      logger.warn('Failed to get nearby amenities', error);
    }

    // Remove duplicates and sort by distance
    const uniqueAmenities = amenities.filter((amenity, index, self) =>
      index === self.findIndex(a => a.name === amenity.name && a.type === amenity.type)
    );

    return uniqueAmenities
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 15); // Limit to 15 amenities
  }

  private categorizeAmenity(query: string): NearbyAmenity['type'] {
    const categoryMap: Record<string, NearbyAmenity['type']> = {
      'shopping mall': 'shopping',
      'hawker centre': 'food',
      'food court': 'food',
      'mrt station': 'transport',
      'hospital': 'healthcare',
      'school': 'education',
      'community centre': 'recreation',
      'park': 'recreation',
    };

    return categoryMap[query] || 'other';
  }

  private inferAccessibilityInfo(busStop: BusStop): AccessibilityInfo {
    // Basic accessibility inference based on description and location
    const description = busStop.description.toLowerCase();
    const roadName = busStop.roadName.toLowerCase();

    return {
      wheelchairAccessible: true, // Most Singapore bus stops are wheelchair accessible
      sheltered: !description.includes('temp') && !description.includes('temporary'),
      seatingAvailable: description.includes('int') || description.includes('interchange') || 
                       description.includes('terminal') || description.includes('hub'),
      tactilePaving: true, // Most modern stops have tactile paving
      audioAnnouncements: description.includes('mrt') || description.includes('interchange'),
      notes: description.includes('temp') ? 'Temporary bus stop - facilities may be limited' : undefined,
    };
  }

  private async getLocationContext(busStop: BusStop): Promise<{
    district?: string;
    area?: string;
    landmarks: string[];
    transportHubs: string[];
  }> {
    const landmarks: string[] = [];
    const transportHubs: string[] = [];
    
    // Extract landmarks from description
    const description = busStop.description;
    const roadName = busStop.roadName;

    // Common Singapore landmarks and transport hubs
    const landmarkPatterns = [
      /\b(mall|plaza|centre|center|hospital|school|park|garden|temple|mosque|church)\b/gi,
      /\b(blk|block)\s*\d+[a-z]?/gi,
    ];

    const transportPatterns = [
      /\b(mrt|lrt|interchange|terminal|station)\b/gi,
    ];

    for (const pattern of landmarkPatterns) {
      const matches = description.match(pattern);
      if (matches) {
        landmarks.push(...matches.map(m => m.trim()));
      }
    }

    for (const pattern of transportPatterns) {
      const matches = description.match(pattern);
      if (matches) {
        transportHubs.push(...matches.map(m => m.trim()));
      }
    }

    // Infer district from road name or description
    let district: string | undefined;
    const commonDistricts = [
      'Jurong', 'Tampines', 'Woodlands', 'Sengkang', 'Punggol', 'Ang Mo Kio',
      'Toa Payoh', 'Bishan', 'Orchard', 'Marina', 'Raffles', 'Chinatown',
      'Little India', 'Bugis', 'Clarke Quay', 'Sentosa', 'Changi',
    ];

    for (const dist of commonDistricts) {
      if (description.toLowerCase().includes(dist.toLowerCase()) || 
          roadName.toLowerCase().includes(dist.toLowerCase())) {
        district = dist;
        break;
      }
    }

    return {
      district,
      area: roadName,
      landmarks: [...new Set(landmarks)], // Remove duplicates
      transportHubs: [...new Set(transportHubs)], // Remove duplicates
    };
  }
}
