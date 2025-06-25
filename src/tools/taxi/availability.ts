import { z } from 'zod';
import { BaseTool, ToolDefinition } from '../base';
import { LTAService } from '../../services/lta';
import { OneMapService } from '../../services/onemap';
import { validateInput, LocationSchema } from '../../utils/validation';
import { logger } from '../../utils/logger';
import haversineDistance from 'haversine-distance';

const TaxiAvailabilityInputSchema = z.intersection(LocationSchema, z.object({
  radius: z.number().min(100).max(5000).default(1000),
}));

export class TaxiAvailabilityTool extends BaseTool {
  constructor(
    private ltaService: LTAService,
    private oneMapService: OneMapService
  ) {
    super();
  }

  getDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'get_nearby_taxis',
        description: 'Find available taxis near a specified location',
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
            default: 1000,
            description: 'Search radius in meters',
          },
        }),
      },
    ];
  }

  canHandle(toolName: string): boolean {
    return toolName === 'get_nearby_taxis';
  }

  async execute(toolName: string, args: unknown): Promise<any> {
    try {
      const { location, lat, lng, radius } = validateInput(TaxiAvailabilityInputSchema, args);
      
      let searchLat = lat;
      let searchLng = lng;
      
      // Geocode location if coordinates not provided
      if (!searchLat || !searchLng) {
        if (!location) {
          throw new Error('Either location name or coordinates must be provided');
        }
        
        logger.info(`Geocoding location for taxi search: ${location}`);
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

      logger.info(`Finding taxis near ${searchLat}, ${searchLng}`, { radius });
      
      // Get taxi availability data
      const taxis = await this.ltaService.getTaxiAvailability();
      
      // Filter taxis within radius
      const nearbyTaxis = taxis
        .map(taxi => ({
          ...taxi,
          distance: haversineDistance(
            { latitude: searchLat!, longitude: searchLng! },
            { latitude: taxi.coordinates[0], longitude: taxi.coordinates[1] }
          ),
        }))
        .filter(taxi => taxi.distance <= (radius || 1000))
        .sort((a, b) => a.distance - b.distance);

      const closestTaxi = nearbyTaxis[0];
      
      return {
        searchLocation: {
          latitude: searchLat,
          longitude: searchLng,
          name: location,
        },
        radius,
        availableTaxis: nearbyTaxis.length,
        closestTaxi: closestTaxi ? {
          distanceMeters: Math.round(closestTaxi.distance),
          estimatedWalkTime: `${Math.ceil(closestTaxi.distance / 80)} minutes`,
          coordinates: closestTaxi.coordinates,
        } : null,
        taxiDensity: this.calculateTaxiDensity(nearbyTaxis.length, radius || 1000),
        recommendations: this.generateTaxiRecommendations(nearbyTaxis.length, location),
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error(`Taxi availability tool failed: ${toolName}`, error);
      return this.formatError(error as Error, toolName);
    }
  }

  private calculateTaxiDensity(count: number, radius: number): string {
    const area = Math.PI * Math.pow(radius / 1000, 2); // km²
    const density = count / area;
    
    if (density > 10) return 'very_high';
    if (density > 5) return 'high';
    if (density > 2) return 'moderate';
    if (density > 0.5) return 'low';
    return 'very_low';
  }

  private generateTaxiRecommendations(taxiCount: number, location?: string): string[] {
    const recommendations: string[] = [];
    
    if (taxiCount === 0) {
      recommendations.push('No taxis available in this area');
      recommendations.push('Consider using ride-hailing apps like Grab or ComfortDelGro');
      recommendations.push('Check nearby MRT stations or bus stops for public transport');
    } else if (taxiCount < 3) {
      recommendations.push('Limited taxi availability - consider booking in advance');
      recommendations.push('Alternative: Use ride-hailing apps for better availability');
    } else if (taxiCount >= 10) {
      recommendations.push('High taxi availability in this area');
      recommendations.push('Good area for finding taxis quickly');
    } else {
      recommendations.push('Moderate taxi availability');
    }

    // Location-specific recommendations
    if (location) {
      const locationLower = location.toLowerCase();
      if (locationLower.includes('airport') || locationLower.includes('changi')) {
        recommendations.push('Airport taxi queue available for departing passengers');
      } else if (locationLower.includes('orchard') || locationLower.includes('cbd')) {
        recommendations.push('Peak hours may have longer wait times in this busy area');
      }
    }

    return recommendations;
  }
}
