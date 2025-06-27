import { z } from 'zod';
import { BaseTool, ToolDefinition } from '../base.js';
import { EnhancedRoutingService, RoutingPreferences } from '../../services/routing.js';
import { logger } from '../../utils/logger.js';

const EnhancedJourneyInputSchema = z.object({
  origin: z.object({
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    name: z.string().optional(),
    postalCode: z.string().optional(),
  }),
  destination: z.object({
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    name: z.string().optional(),
    postalCode: z.string().optional(),
  }),
  preferences: z.object({
    minimizeTransfers: z.boolean().default(true),
    minimizeWalkingTime: z.boolean().default(false),
    minimizeTotalTime: z.boolean().default(true),
    allowDriving: z.boolean().default(false),
    accessibilityRequired: z.boolean().default(false),
    maxWalkingDistance: z.number().min(100).max(2000).default(1000),
    departureTime: z.string().optional(),
  }).default({}),
  includeWeatherImpact: z.boolean().default(true),
  includeRealTimeDisruptions: z.boolean().default(true),
  maxAlternatives: z.number().min(1).max(5).default(3),
});

export class EnhancedJourneyPlanningTool extends BaseTool {
  constructor(
    private routingService: EnhancedRoutingService
  ) {
    super();
  }

  getDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'plan_optimal_journey',
        description: 'Plan an optimal journey with minimal transfers, real-time disruptions, weather impact, and detailed turn-by-turn instructions. Supports public transport, walking, and driving options.',
        inputSchema: this.createSchema({
          origin: {
            type: 'object',
            description: 'Starting location - provide coordinates, name, or postal code',
            properties: {
              latitude: { type: 'number', description: 'Latitude coordinate' },
              longitude: { type: 'number', description: 'Longitude coordinate' },
              name: { type: 'string', description: 'Location name (e.g., "Orchard MRT", "Marina Bay Sands")' },
              postalCode: { type: 'string', description: 'Singapore postal code (6 digits)' },
            },
          },
          destination: {
            type: 'object',
            description: 'Destination location - provide coordinates, name, or postal code',
            properties: {
              latitude: { type: 'number', description: 'Latitude coordinate' },
              longitude: { type: 'number', description: 'Longitude coordinate' },
              name: { type: 'string', description: 'Location name (e.g., "Changi Airport", "NUS")' },
              postalCode: { type: 'string', description: 'Singapore postal code (6 digits)' },
            },
          },
          preferences: {
            type: 'object',
            description: 'Journey planning preferences',
            properties: {
              minimizeTransfers: {
                type: 'boolean',
                default: true,
                description: 'Prioritize routes with fewer transfers',
              },
              minimizeWalkingTime: {
                type: 'boolean',
                default: false,
                description: 'Minimize walking time over total time',
              },
              minimizeTotalTime: {
                type: 'boolean',
                default: true,
                description: 'Prioritize fastest overall journey',
              },
              allowDriving: {
                type: 'boolean',
                default: false,
                description: 'Include driving directions as an option',
              },
              accessibilityRequired: {
                type: 'boolean',
                default: false,
                description: 'Ensure wheelchair accessibility',
              },
              maxWalkingDistance: {
                type: 'number',
                minimum: 100,
                maximum: 2000,
                default: 1000,
                description: 'Maximum walking distance in meters',
              },
              departureTime: {
                type: 'string',
                description: 'Departure time (ISO format) - defaults to now',
              },
            },
          },
          includeWeatherImpact: {
            type: 'boolean',
            default: true,
            description: 'Include real-time weather impact on walking times',
          },
          includeRealTimeDisruptions: {
            type: 'boolean',
            default: true,
            description: 'Include current service disruptions and alternatives',
          },
          maxAlternatives: {
            type: 'number',
            minimum: 1,
            maximum: 5,
            default: 3,
            description: 'Maximum number of alternative routes to return',
          },
        }, ['origin', 'destination']),
      },
    ];
  }

  canHandle(toolName: string): boolean {
    return toolName === 'plan_optimal_journey';
  }

  async execute(toolName: string, args: unknown): Promise<any> {
    try {
      const {
        origin,
        destination,
        preferences,
        includeWeatherImpact,
        includeRealTimeDisruptions,
        maxAlternatives,
      } = EnhancedJourneyInputSchema.parse(args);

      logger.info('Planning enhanced journey', {
        origin: origin.name || `${origin.latitude},${origin.longitude}`,
        destination: destination.name || `${destination.latitude},${destination.longitude}`,
        preferences,
      });

      // Resolve origin and destination coordinates if needed
      const resolvedOrigin = await this.resolveLocation(origin);
      const resolvedDestination = await this.resolveLocation(destination);

      if (!resolvedOrigin || !resolvedDestination) {
        return {
          error: 'Could not resolve origin or destination coordinates',
          suggestions: [
            'Provide valid coordinates (latitude, longitude)',
            'Use a recognizable location name',
            'Provide a valid Singapore postal code',
          ],
          timestamp: new Date().toISOString(),
        };
      }

      // Plan the journey
      const journeyPlans = await this.routingService.planOptimalJourney(
        resolvedOrigin,
        resolvedDestination,
        preferences as RoutingPreferences
      );

      if (journeyPlans.length === 0) {
        return {
          error: 'No viable routes found',
          suggestions: [
            'Try increasing maxWalkingDistance',
            'Consider allowing driving if destinations are far apart',
            'Check if locations are accessible by public transport',
          ],
          timestamp: new Date().toISOString(),
        };
      }

      // Format the response
      const primaryRoute = journeyPlans[0];
      const alternativeRoutes = journeyPlans.slice(1, maxAlternatives);

      return {
        success: true,
        primaryRoute: {
          summary: primaryRoute.summary,
          segments: primaryRoute.segments.map(segment => ({
            mode: segment.mode,
            duration: `${Math.round(segment.duration / 60)} minutes`,
            distance: segment.distance > 1000 
              ? `${(segment.distance / 1000).toFixed(1)} km`
              : `${Math.round(segment.distance)} m`,
            instructions: segment.instructions,
            startLocation: segment.startLocation,
            endLocation: segment.endLocation,
            line: segment.line,
            service: segment.service,
            stations: segment.stations,
            stops: segment.stops,
            realTimeInfo: segment.realTimeInfo,
            platformInfo: segment.platformInfo,
          })),
          weatherImpact: includeWeatherImpact ? primaryRoute.weatherImpact : undefined,
          disruptions: includeRealTimeDisruptions ? primaryRoute.disruptions : undefined,
          confidence: primaryRoute.confidence,
        },
        alternativeRoutes: alternativeRoutes.map(route => ({
          summary: route.summary,
          confidence: route.confidence,
          reason: this.generateAlternativeReason(route, primaryRoute),
        })),
        metadata: {
          totalRoutesFound: journeyPlans.length,
          searchPreferences: preferences,
          weatherImpactIncluded: includeWeatherImpact,
          realTimeDataIncluded: includeRealTimeDisruptions,
          planningTime: new Date().toISOString(),
        },
        timestamp: new Date().toISOString(),
      };

    } catch (error) {
      logger.error(`Enhanced journey planning failed: ${toolName}`, error);
      return this.formatError(error as Error, toolName);
    }
  }

  private async resolveLocation(location: {
    latitude?: number;
    longitude?: number;
    name?: string;
    postalCode?: string;
  }): Promise<{ latitude: number; longitude: number; name?: string } | null> {
    // If coordinates are provided, use them directly
    if (location.latitude && location.longitude) {
      return {
        latitude: location.latitude,
        longitude: location.longitude,
        name: location.name,
      };
    }

    // TODO: Implement location resolution using existing services
    // This would use the OneMapService and PostalCodeService to resolve
    // names and postal codes to coordinates
    
    // For now, return null if coordinates aren't provided
    logger.warn('Location resolution not yet implemented for names/postal codes');
    return null;
  }

  private generateAlternativeReason(
    alternative: any,
    primary: any
  ): string {
    if (alternative.summary.transfers < primary.summary.transfers) {
      return `Fewer transfers (${alternative.summary.transfers} vs ${primary.summary.transfers})`;
    }
    
    if (alternative.summary.walkingTime < primary.summary.walkingTime) {
      return `Less walking time (${Math.round(alternative.summary.walkingTime / 60)} vs ${Math.round(primary.summary.walkingTime / 60)} minutes)`;
    }
    
    if (alternative.summary.modes.includes('DRIVE')) {
      return 'Driving option';
    }
    
    if (alternative.summary.totalCost < primary.summary.totalCost) {
      return `Lower cost ($${alternative.summary.totalCost.toFixed(2)} vs $${primary.summary.totalCost.toFixed(2)})`;
    }
    
    return 'Alternative route option';
  }
}
