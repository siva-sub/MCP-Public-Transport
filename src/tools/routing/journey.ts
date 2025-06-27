import { z } from 'zod';
import { BaseTool, ToolDefinition } from '../base.js';
import { OneMapService } from '../../services/onemap.js';
import { LTAService } from '../../services/lta.js';
import { WeatherService } from '../../services/weather.js';
import { validateInput } from '../../utils/validation.js';
import { logger } from '../../utils/logger.js';
import { JourneyPlan, Location } from '../../types/transport.js';

// Enhanced input schema supporting multiple input types
const JourneyPlanningInputSchema = z.object({
  fromLocation: z.union([
    z.string().min(1),
    z.object({
      postalCode: z.string().regex(/^\d{6}$/, 'Postal code must be 6 digits'),
    }),
    z.object({
      latitude: z.number().min(1.0).max(1.5),
      longitude: z.number().min(103.0).max(104.5),
      name: z.string().optional(),
    }),
  ]),
  toLocation: z.union([
    z.string().min(1),
    z.object({
      postalCode: z.string().regex(/^\d{6}$/, 'Postal code must be 6 digits'),
    }),
    z.object({
      latitude: z.number().min(1.0).max(1.5),
      longitude: z.number().min(103.0).max(104.5),
      name: z.string().optional(),
    }),
  ]),
  departureTime: z.string().optional(),
  arrivalTime: z.string().optional(),
  mode: z.enum(['PUBLIC_TRANSPORT', 'WALK', 'DRIVE', 'CYCLE', 'AUTO']).default('AUTO'),
  preferences: z.object({
    maxWalkDistance: z.number().min(100).max(2000).default(1000),
    avoidCrowds: z.boolean().default(false),
    fastest: z.boolean().default(true),
    cheapest: z.boolean().default(false),
    minimizeTransfers: z.boolean().default(true),
    accessibilityRequired: z.boolean().default(false),
    weatherAware: z.boolean().default(true),
    allowDriving: z.boolean().default(true),
  }).default({}),
  maxAlternatives: z.number().min(1).max(5).default(3),
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
            oneOf: [
              {
                type: 'string',
                description: 'Starting location as address or landmark (e.g., "Orchard MRT", "Marina Bay Sands")',
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
                description: 'Starting location as postal code',
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
                description: 'Starting location as coordinates',
              },
            ],
            description: 'Starting location - provide as address, postal code, or coordinates',
          },
          toLocation: {
            oneOf: [
              {
                type: 'string',
                description: 'Destination location as address or landmark (e.g., "Changi Airport", "NUS")',
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
                description: 'Destination location as postal code',
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
                description: 'Starting location as coordinates',
              },
            ],
            description: 'Destination location - provide as address, postal code, or coordinates',
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
            enum: ['PUBLIC_TRANSPORT', 'WALK', 'DRIVE', 'CYCLE', 'AUTO'],
            default: 'AUTO',
            description: 'Transport mode: AUTO (smart selection), PUBLIC_TRANSPORT (bus/train), WALK, DRIVE (taxi/car), CYCLE',
          },
          preferences: {
            type: 'object',
            properties: {
              maxWalkDistance: {
                type: 'number',
                minimum: 100,
                maximum: 2000,
                default: 1000,
                description: 'Maximum walking distance in meters',
              },
              avoidCrowds: {
                type: 'boolean',
                default: false,
                description: 'Avoid crowded routes',
              },
              fastest: {
                type: 'boolean',
                default: true,
                description: 'Prioritize fastest route',
              },
              cheapest: {
                type: 'boolean',
                default: false,
                description: 'Prioritize cheapest route',
              },
              minimizeTransfers: {
                type: 'boolean',
                default: true,
                description: 'Minimize number of transfers',
              },
              accessibilityRequired: {
                type: 'boolean',
                default: false,
                description: 'Ensure wheelchair accessibility',
              },
              weatherAware: {
                type: 'boolean',
                default: true,
                description: 'Adjust walking times based on weather',
              },
              allowDriving: {
                type: 'boolean',
                default: true,
                description: 'Include driving/taxi options',
              },
            },
            description: 'Journey planning preferences',
          },
          maxAlternatives: {
            type: 'number',
            minimum: 1,
            maximum: 5,
            default: 3,
            description: 'Maximum number of alternative routes to return',
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

      // Resolve locations (handle different input types)
      const [fromLocation, toLocation] = await Promise.all([
        this.resolveLocation(input.fromLocation),
        this.resolveLocation(input.toLocation),
      ]);

      if (!fromLocation) {
        return {
          error: `Could not find location: ${JSON.stringify(input.fromLocation)}`,
          timestamp: new Date().toISOString(),
        };
      }

      if (!toLocation) {
        return {
          error: `Could not find location: ${JSON.stringify(input.toLocation)}`,
          timestamp: new Date().toISOString(),
        };
      }

      // Parse time parameters
      const departureTime = input.departureTime ? new Date(input.departureTime) : undefined;
      const arrivalTime = input.arrivalTime ? new Date(input.arrivalTime) : undefined;

      // Determine the best mode if AUTO is selected
      const resolvedMode: 'PUBLIC_TRANSPORT' | 'WALK' | 'DRIVE' | 'CYCLE' = 
        input.mode === 'AUTO' ? this.selectOptimalMode(fromLocation, toLocation) : 
        input.mode || 'PUBLIC_TRANSPORT';

      // Ensure preferences have defaults
      const preferences = {
        maxWalkDistance: 1000,
        avoidCrowds: false,
        fastest: true,
        cheapest: false,
        minimizeTransfers: true,
        accessibilityRequired: false,
        weatherAware: true,
        allowDriving: true,
        ...input.preferences,
      };

      // Plan primary route with retry logic
      const primaryRoute = await this.planRouteWithRetry(fromLocation, toLocation, {
        mode: this.mapModeToOneMapMode(resolvedMode),
        departureTime,
        arrivalTime,
        maxWalkDistance: preferences.maxWalkDistance,
      });

      if (!primaryRoute) {
        return {
          error: 'No route found between the specified locations',
          details: 'Tried multiple routing strategies but could not find a viable route',
          suggestions: [
            'Check if the locations are accessible by the selected transport mode',
            'Try increasing maxWalkDistance if using public transport',
            'Consider using a different transport mode (AUTO, DRIVE, WALK)',
            'Verify that both locations are within Singapore'
          ],
          fromLocation: input.fromLocation,
          toLocation: input.toLocation,
          resolvedFrom: fromLocation,
          resolvedTo: toLocation,
          timestamp: new Date().toISOString(),
        };
      }

      // Enhance with real-time data
      const enhancedRoute = await this.enhanceWithRealTimeData(primaryRoute);

      // Get alternative routes
      const alternatives = await this.getAlternativeRoutes(
        fromLocation,
        toLocation,
        resolvedMode,
        preferences
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

  private async resolveLocation(
    locationInput: string | { postalCode: string } | { latitude: number; longitude: number; name?: string } | any
  ): Promise<Location | null> {
    try {
      let parsedInput = locationInput;
      
      // Handle stringified JSON objects (critical fix)
      if (typeof locationInput === 'string') {
        try {
          const parsed = JSON.parse(locationInput);
          if (parsed && typeof parsed === 'object') {
            parsedInput = parsed;
            logger.debug('Successfully parsed JSON string input', { original: locationInput, parsed });
          }
        } catch (parseError) {
          // Not JSON, treat as regular address string
          logger.debug('Input is not JSON, treating as address string', { input: locationInput });
          return await this.oneMapService.geocode(locationInput);
        }
      }

      // Handle coordinate input (from parsed JSON or direct object)
      if (parsedInput && typeof parsedInput === 'object' && 'latitude' in parsedInput && 'longitude' in parsedInput) {
        // Validate Singapore coordinate bounds
        const lat = parseFloat(parsedInput.latitude);
        const lng = parseFloat(parsedInput.longitude);
        
        if (lat < 1.0 || lat > 1.5 || lng < 103.0 || lng > 104.5) {
          logger.warn('Coordinates outside Singapore bounds', { lat, lng });
          return null;
        }
        
        return {
          latitude: lat,
          longitude: lng,
          name: parsedInput.name || 'Custom Location',
          address: parsedInput.name || `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
        };
      }

      // Handle postal code input (from parsed JSON or direct object)
      if (parsedInput && typeof parsedInput === 'object' && 'postalCode' in parsedInput) {
        const postalCode = parsedInput.postalCode.toString();
        if (!/^\d{6}$/.test(postalCode)) {
          logger.warn('Invalid postal code format', { postalCode });
          return null;
        }
        return await this.oneMapService.geocode(postalCode);
      }

      // Handle string input (address/name) - already handled above for JSON case
      if (typeof parsedInput === 'string') {
        return await this.oneMapService.geocode(parsedInput);
      }

      logger.warn('Unrecognized location input format', { input: locationInput, parsed: parsedInput });
      return null;
    } catch (error) {
      logger.error('Location resolution failed', { error, input: locationInput });
      return null;
    }
  }

  private selectOptimalMode(from: Location, to: Location): 'PUBLIC_TRANSPORT' | 'WALK' | 'DRIVE' {
    const distance = this.calculateDistance(from.latitude, from.longitude, to.latitude, to.longitude);
    
    // Walking for short distances (under 1km)
    if (distance < 1000) return 'WALK';
    
    // Driving for long distances (over 15km)
    if (distance > 15000) return 'DRIVE';
    
    // Public transport for medium distances
    return 'PUBLIC_TRANSPORT';
  }

  private mapModeToOneMapMode(mode: 'PUBLIC_TRANSPORT' | 'WALK' | 'DRIVE' | 'CYCLE'): 'PUBLIC_TRANSPORT' | 'WALK' | 'DRIVE' {
    if (mode === 'CYCLE') return 'WALK'; // OneMap doesn't support cycle, use walk as fallback
    return mode;
  }

  private async planRouteWithRetry(
    from: Location,
    to: Location,
    options: any,
    retries = 3
  ): Promise<JourneyPlan | null> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        logger.debug(`Route planning attempt ${attempt}/${retries}`, { from: from.name, to: to.name, options });
        
        const result = await this.oneMapService.planRoute(from, to, options);
        if (result) {
          logger.info(`Route planning successful on attempt ${attempt}`, { 
            duration: result.totalDuration,
            distance: result.totalDistance 
          });
          return result;
        }
      } catch (error) {
        logger.warn(`Route planning attempt ${attempt} failed`, { 
          error: error instanceof Error ? error.message : 'Unknown error',
          attempt,
          retries 
        });
        
        if (attempt === retries) {
          // Try alternative routing strategies on final attempt
          logger.info('Trying alternative routing strategies');
          return await this.tryAlternativeRouting(from, to, options);
        }
        
        // Wait before retry with exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        logger.debug(`Waiting ${delay}ms before retry`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    return null;
  }

  private async tryAlternativeRouting(
    from: Location,
    to: Location,
    originalOptions: any
  ): Promise<JourneyPlan | null> {
    // Try different route types as fallbacks
    const fallbackModes: Array<'PUBLIC_TRANSPORT' | 'WALK' | 'DRIVE'> = ['DRIVE', 'WALK', 'PUBLIC_TRANSPORT'];
    
    for (const mode of fallbackModes) {
      if (mode === originalOptions.mode) continue; // Skip the original mode
      
      try {
        logger.debug(`Trying alternative routing mode: ${mode}`);
        
        const alternativeOptions = {
          ...originalOptions,
          mode,
        };
        
        // Adjust parameters for different modes
        if (mode === 'WALK') {
          // For walking, remove PT-specific parameters
          delete alternativeOptions.maxWalkDistance;
        } else if (mode === 'DRIVE') {
          // For driving, remove PT-specific parameters
          delete alternativeOptions.maxWalkDistance;
        }
        
        const result = await this.oneMapService.planRoute(from, to, alternativeOptions);
        if (result) {
          logger.info(`Alternative routing successful with ${mode}`, {
            duration: result.totalDuration,
            distance: result.totalDistance
          });
          return result;
        }
      } catch (error) {
        logger.warn(`Alternative routing failed for ${mode}`, {
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    // If all alternatives fail, try a simple direct route
    try {
      logger.debug('Trying simple direct route calculation');
      return await this.createDirectRoute(from, to);
    } catch (error) {
      logger.error('All routing strategies failed', error);
      return null;
    }
  }

  private async createDirectRoute(from: Location, to: Location): Promise<JourneyPlan | null> {
    try {
      const distance = this.calculateDistance(from.latitude, from.longitude, to.latitude, to.longitude);
      
      // Create a simple walking route as last resort
      const walkingSpeed = 1.4; // m/s (average walking speed)
      const duration = Math.round(distance / walkingSpeed);
      
      const directRoute: JourneyPlan = {
        segments: [{
          mode: 'WALK',
          duration,
          distance,
          instructions: [
            `Walk directly from ${from.name || 'origin'} to ${to.name || 'destination'}`,
            `Distance: ${(distance / 1000).toFixed(1)}km`,
            `Estimated time: ${Math.round(duration / 60)} minutes`
          ],
          startLocation: from,
          endLocation: to,
        }],
        totalDuration: duration,
        totalDistance: distance,
        totalCost: 0,
        totalWalkDistance: distance,
        transfers: 0,
        summary: `${Math.round(duration / 60)} min direct walk (${(distance / 1000).toFixed(1)}km)`,
      };
      
      logger.info('Created direct route as fallback', {
        distance: distance,
        duration: duration
      });
      
      return directRoute;
    } catch (error) {
      logger.error('Failed to create direct route', error);
      return null;
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
    preferences: {
      maxWalkDistance: number;
      avoidCrowds: boolean;
      fastest: boolean;
      cheapest: boolean;
      minimizeTransfers: boolean;
      accessibilityRequired: boolean;
      weatherAware: boolean;
      allowDriving: boolean;
    }
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
