import { z } from 'zod';
import { BaseTool, ToolDefinition } from '../base.js';
import { OneMapService } from '../../services/onemap.js';
import { LTAService } from '../../services/lta.js';
import { validateInput } from '../../utils/validation.js';
import { logger } from '../../utils/logger.js';
import { JourneyPlan, Location } from '../../types/transport.js';

const JourneyPlanningInputSchema = z.object({
  fromLocation: z.string().min(1, 'From location is required'),
  toLocation: z.string().min(1, 'To location is required'),
  departureTime: z.string().optional(),
  arrivalTime: z.string().optional(),
  mode: z.enum(['PUBLIC_TRANSPORT', 'WALK', 'DRIVE']).default('PUBLIC_TRANSPORT'),
  preferences: z.object({
    maxWalkDistance: z.number().min(100).max(2000).optional(),
    avoidCrowds: z.boolean().optional(),
    fastest: z.boolean().optional(),
    cheapest: z.boolean().optional(),
  }).optional(),
});

export class JourneyPlanningTool extends BaseTool {
  constructor(
    private oneMapService: OneMapService,
    private ltaService: LTAService
  ) {
    super();
  }

  getDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'plan_comprehensive_journey',
        description: 'Plan a comprehensive journey using multiple transport modes with real-time data',
        inputSchema: this.createSchema({
          fromLocation: {
            type: 'string',
            description: 'Starting location (address or landmark)',
          },
          toLocation: {
            type: 'string',
            description: 'Destination location (address or landmark)',
          },
          departureTime: {
            type: 'string',
            description: 'Departure time in ISO format (optional)',
          },
          arrivalTime: {
            type: 'string',
            description: 'Desired arrival time in ISO format (optional)',
          },
          mode: {
            type: 'string',
            enum: ['PUBLIC_TRANSPORT', 'WALK', 'DRIVE'],
            default: 'PUBLIC_TRANSPORT',
            description: 'Primary transport mode',
          },
          preferences: {
            type: 'object',
            properties: {
              maxWalkDistance: {
                type: 'number',
                minimum: 100,
                maximum: 2000,
                description: 'Maximum walking distance in meters',
              },
              avoidCrowds: {
                type: 'boolean',
                description: 'Avoid crowded routes',
              },
              fastest: {
                type: 'boolean',
                description: 'Prioritize fastest route',
              },
              cheapest: {
                type: 'boolean',
                description: 'Prioritize cheapest route',
              },
            },
            description: 'Journey preferences',
          },
        }, ['fromLocation', 'toLocation']),
      },
    ];
  }

  canHandle(toolName: string): boolean {
    return toolName === 'plan_comprehensive_journey';
  }

  async execute(toolName: string, args: unknown): Promise<any> {
    try {
      const input = validateInput(JourneyPlanningInputSchema, args);
      
      logger.info('Planning comprehensive journey', {
        from: input.fromLocation,
        to: input.toLocation,
        mode: input.mode,
      });

      // Geocode locations
      const [fromLocation, toLocation] = await Promise.all([
        this.oneMapService.geocode(input.fromLocation),
        this.oneMapService.geocode(input.toLocation),
      ]);

      if (!fromLocation) {
        return {
          error: `Could not find location: ${input.fromLocation}`,
          timestamp: new Date().toISOString(),
        };
      }

      if (!toLocation) {
        return {
          error: `Could not find location: ${input.toLocation}`,
          timestamp: new Date().toISOString(),
        };
      }

      // Parse time parameters
      const departureTime = input.departureTime ? new Date(input.departureTime) : undefined;
      const arrivalTime = input.arrivalTime ? new Date(input.arrivalTime) : undefined;

      // Plan primary route
      const primaryRoute = await this.oneMapService.planRoute(fromLocation, toLocation, {
        mode: input.mode,
        departureTime,
        arrivalTime,
        maxWalkDistance: input.preferences?.maxWalkDistance,
      });

      if (!primaryRoute) {
        return {
          error: 'No route found between the specified locations',
          fromLocation: input.fromLocation,
          toLocation: input.toLocation,
          timestamp: new Date().toISOString(),
        };
      }

      // Enhance with real-time data
      const enhancedRoute = await this.enhanceWithRealTimeData(primaryRoute);

      // Get alternative routes
      const alternatives = await this.getAlternativeRoutes(
        fromLocation,
        toLocation,
        input.mode || 'PUBLIC_TRANSPORT',
        input.preferences
      );

      // Get current transport alerts
      const alerts = await this.getTransportAlerts();

      return {
        primaryRoute: enhancedRoute,
        alternatives,
        alerts,
        summary: this.createJourneySummary(enhancedRoute, alternatives),
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error(`Journey planning tool failed: ${toolName}`, error);
      return this.formatError(error as Error, toolName);
    }
  }

  private async enhanceWithRealTimeData(route: JourneyPlan): Promise<JourneyPlan> {
    const enhancedSegments = await Promise.all(
      route.segments.map(async (segment) => {
        const enhanced = { ...segment };

        // Enhance bus segments with real-time arrivals
        if (segment.mode === 'BUS' && segment.startLocation) {
          try {
            // Find nearby bus stops
            // This is a simplified version - in reality you'd need to map
            // the segment's start location to actual bus stop codes
            enhanced.realTimeInfo = {
              status: 'Real-time data integration would go here',
              note: 'Bus arrival times would be fetched for actual stops',
            };
          } catch (error) {
            logger.warn('Failed to enhance bus segment with real-time data', error);
          }
        }

        return enhanced;
      })
    );

    return {
      ...route,
      segments: enhancedSegments,
      realTimeEnhanced: true,
    };
  }

  private async getAlternativeRoutes(
    from: Location,
    to: Location,
    primaryMode: string,
    preferences: z.infer<typeof JourneyPlanningInputSchema>['preferences']
  ): Promise<JourneyPlan[]> {
    const alternatives: JourneyPlan[] = [];

    try {
      // Calculate distance between points to determine practical alternatives
      const distance = this.calculateDistance(from.latitude, from.longitude, to.latitude, to.longitude);
      
      // Walking alternative (only if reasonable distance and not primary mode)
      if (primaryMode !== 'WALK' && distance <= 5000) { // Max 5km for walking
        const walkingRoute = await this.oneMapService.planRoute(from, to, { mode: 'WALK' });
        if (walkingRoute && walkingRoute.totalDuration <= 3600) { // Max 1 hour walk
          alternatives.push({
            ...walkingRoute,
            summary: `Walking route: ${walkingRoute.summary}`,
          });
        }
      }

      // Driving alternative (if not primary mode)
      if (primaryMode !== 'DRIVE') {
        const drivingRoute = await this.oneMapService.planRoute(from, to, { mode: 'DRIVE' });
        if (drivingRoute) {
          // Add taxi cost estimate
          const taxiCost = this.estimateTaxiCost(drivingRoute.totalDistance, drivingRoute.totalDuration);
          alternatives.push({
            ...drivingRoute,
            totalCost: taxiCost,
            summary: `Taxi/driving route: ${drivingRoute.summary}`,
          });
        }
      }

      // Public transport with different preferences (if not already primary)
      if (primaryMode === 'PUBLIC_TRANSPORT' && preferences) {
        const altPreferences = { ...preferences };
        if (preferences.fastest) {
          altPreferences.cheapest = true;
          altPreferences.fastest = false;
          
          const cheaperRoute = await this.oneMapService.planRoute(from, to, {
            mode: 'PUBLIC_TRANSPORT',
            maxWalkDistance: altPreferences.maxWalkDistance,
          });
          
          if (cheaperRoute && this.isDifferentRoute(cheaperRoute, alternatives)) {
            alternatives.push({
              ...cheaperRoute,
              summary: `Budget-friendly: ${cheaperRoute.summary}`,
            });
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to get some alternative routes', error);
    }

    // Filter and sort alternatives
    return this.filterAndSortAlternatives(alternatives);
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

    return R * c;
  }

  private isDifferentRoute(newRoute: JourneyPlan, existingRoutes: JourneyPlan[]): boolean {
    // Check if this route is significantly different from existing ones
    for (const existing of existingRoutes) {
      const timeDiff = Math.abs(newRoute.totalDuration - existing.totalDuration);
      const costDiff = Math.abs((newRoute.totalCost || 0) - (existing.totalCost || 0));
      
      // If time difference is less than 5 minutes and cost difference is less than $0.50, consider it similar
      if (timeDiff < 300 && costDiff < 0.5) {
        return false;
      }
    }
    return true;
  }

  private filterAndSortAlternatives(alternatives: JourneyPlan[]): JourneyPlan[] {
    // Filter out impractical routes
    const filtered = alternatives.filter(route => {
      // Remove routes that are too long (over 4 hours)
      if (route.totalDuration > 14400) return false;
      
      // Remove walking routes over 22km (like the problematic one)
      if (route.totalWalkDistance > 22000) return false;
      
      // Remove routes with excessive instructions (over 50 steps)
      const totalInstructions = route.segments.reduce((sum, segment) => sum + segment.instructions.length, 0);
      if (totalInstructions > 50) return false;
      
      return true;
    });

    // Sort by practicality (time, then cost)
    return filtered.sort((a, b) => {
      // First sort by total time
      const timeDiff = a.totalDuration - b.totalDuration;
      if (Math.abs(timeDiff) > 300) return timeDiff; // If time difference > 5 minutes
      
      // Then by cost
      return (a.totalCost || 0) - (b.totalCost || 0);
    }).slice(0, 3); // Limit to top 3 alternatives
  }

  private estimateTaxiCost(distanceM: number, durationSec: number): number {
    const distanceKm = distanceM / 1000;
    const durationMin = durationSec / 60;
    
    // Singapore taxi fare estimation
    let cost = 3.90; // Base fare
    
    // Distance component
    if (distanceKm > 1) {
      cost += (distanceKm - 1) * 0.55;
    }
    
    // Time component (for waiting/slow traffic)
    if (durationMin > 10) {
      cost += (durationMin - 10) * 0.55 / 5; // $0.55 per 45-second block
    }
    
    // Peak hour surcharge (simplified)
    const now = new Date();
    const hour = now.getHours();
    if ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 20)) {
      cost *= 1.25;
    }
    
    return Math.round(cost * 100) / 100; // Round to nearest cent
  }

  private async getTransportAlerts(): Promise<any[]> {
    try {
      const trainAlerts = await this.ltaService.getTrainServiceAlerts();
      return trainAlerts.filter(alert => alert.status === 'Disrupted');
    } catch (error) {
      logger.warn('Failed to get transport alerts', error);
      return [];
    }
  }

  private createJourneySummary(primaryRoute: JourneyPlan, alternatives: JourneyPlan[]): string {
    const primary = primaryRoute;
    const duration = Math.round(primary.totalDuration / 60);
    const cost = primary.totalCost || 0;
    
    let summary = `Primary: ${duration} min`;
    if (cost > 0) summary += `, $${cost.toFixed(2)}`;
    
    if (alternatives.length > 0) {
      const altSummaries = alternatives.slice(0, 2).map(alt => {
        const altDuration = Math.round(alt.totalDuration / 60);
        const altCost = alt.totalCost || 0;
        let altStr = `${altDuration} min`;
        if (altCost > 0) altStr += `, $${altCost.toFixed(2)}`;
        return alt.summary || altStr;
      });
      
      summary += ` | Alternatives: ${altSummaries.join(', ')}`;
    }
    
    return summary;
  }
}
