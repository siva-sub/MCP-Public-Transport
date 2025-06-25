import { z } from 'zod';
import { BaseTool, ToolDefinition } from '../base';
import { LTAService } from '../../services/lta';
import { OneMapService } from '../../services/onemap';
import { validateInput, LocationSchema } from '../../utils/validation';
import { logger } from '../../utils/logger';
import haversineDistance from 'haversine-distance';

const BusStopsInputSchema = z.intersection(LocationSchema, z.object({
  radius: z.number().min(100).max(5000).default(500),
  limit: z.number().min(1).max(50).default(10),
}));

export class BusStopsTool extends BaseTool {
  constructor(
    private ltaService: LTAService,
    private oneMapService: OneMapService
  ) {
    super();
  }

  getDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'find_bus_stops',
        description: 'Find bus stops by location name, coordinates, or road name',
        inputSchema: this.createSchema({
          location: {
            type: 'string',
            description: 'Location name (e.g., "Marina Bay", "Orchard Road")',
          },
          lat: {
            type: 'number',
            description: 'Latitude coordinate',
          },
          lng: {
            type: 'number',
            description: 'Longitude coordinate',
          },
          radius: {
            type: 'number',
            minimum: 100,
            maximum: 5000,
            default: 500,
            description: 'Search radius in meters',
          },
          limit: {
            type: 'number',
            minimum: 1,
            maximum: 50,
            default: 10,
            description: 'Maximum number of results',
          },
        }),
      },
    ];
  }

  canHandle(toolName: string): boolean {
    return toolName === 'find_bus_stops';
  }

  async execute(toolName: string, args: unknown): Promise<any> {
    try {
      const { location, lat, lng, radius, limit } = validateInput(BusStopsInputSchema, args);
      
      let searchLat = lat;
      let searchLng = lng;
      
      // Geocode location if coordinates not provided
      if (!searchLat || !searchLng) {
        if (!location) {
          throw new Error('Either location name or coordinates must be provided');
        }
        
        logger.info(`Geocoding location: ${location}`);
        const geocoded = await this.oneMapService.geocode(location);
        
        if (!geocoded) {
          return {
            error: `Could not find coordinates for location: ${location}`,
            timestamp: new Date().toISOString(),
          };
        }
        
        searchLat = geocoded.latitude;
        searchLng = geocoded.longitude;
      }

      logger.info(`Finding bus stops near ${searchLat}, ${searchLng}`, { radius, limit });
      
      // Get all bus stops (cached)
      const allStops = await this.ltaService.getAllBusStops();
      
      // Calculate distances and filter
      const nearbyStops = allStops
        .map(stop => ({
          ...stop,
          distance: haversineDistance(
            { latitude: searchLat!, longitude: searchLng! },
            { latitude: stop.latitude, longitude: stop.longitude }
          ),
        }))
        .filter(stop => stop.distance <= (radius || 500))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, limit);

      return {
        searchLocation: {
          latitude: searchLat,
          longitude: searchLng,
          name: location,
        },
        radius,
        totalFound: nearbyStops.length,
        stops: nearbyStops.map(stop => ({
          busStopCode: stop.busStopCode,
          description: stop.description,
          roadName: stop.roadName,
          latitude: stop.latitude,
          longitude: stop.longitude,
          distanceMeters: Math.round(stop.distance),
          walkingTimeMinutes: Math.ceil(stop.distance / 80), // Assume 80m/min walking speed
        })),
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error(`Bus stops tool failed: ${toolName}`, error);
      return this.formatError(error as Error, toolName);
    }
  }
}
