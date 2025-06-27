import { z } from 'zod';
import { BaseTool, ToolDefinition } from '../base.js';
import { OneMapService } from '../../services/onemap.js';
import { LTAService } from '../../services/lta.js';
import { WeatherService } from '../../services/weather.js';
import { PolylineService } from '../../services/polylines.js';
import { InstructionParserService, ParsedInstruction, RouteSummary } from '../../services/instructionParser.js';
import { validateInput } from '../../utils/validation.js';
import { logger } from '../../utils/logger.js';
import { Location } from '../../types/transport.js';

// Enhanced input schema for comprehensive journey planning
const ComprehensiveJourneyInputSchema = z.object({
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
  mode: z.enum(['PUBLIC_TRANSPORT', 'WALK', 'DRIVE', 'CYCLE', 'AUTO']).default('AUTO'),
  departureTime: z.string().optional(),
  arrivalTime: z.string().optional(),
  preferences: z.object({
    maxWalkDistance: z.number().min(100).max(2000).default(1000),
    fastest: z.boolean().default(true),
    cheapest: z.boolean().default(false),
    minimizeTransfers: z.boolean().default(true),
    accessibilityRequired: z.boolean().default(false),
    weatherAware: z.boolean().default(true),
  }).default({}),
  outputOptions: z.object({
    includeInstructions: z.boolean().default(true),
    includePolylines: z.boolean().default(true),
    includeAlternatives: z.boolean().default(true),
    includeContext: z.boolean().default(true),
    instructionFormat: z.enum(['detailed', 'simple', 'navigation']).default('detailed'),
    coordinateFormat: z.enum(['WGS84', 'decimal']).default('WGS84'),
  }).default({}),
  maxAlternatives: z.number().min(1).max(5).default(3),
});

interface ComprehensiveJourneyResponse {
  success: boolean;
  journey: {
    summary: RouteSummary;
    instructions: ParsedInstruction[];
    formattedInstructions: string[];
    polylines: any[];
    visualization: {
      bounds: any;
      stepMarkers: any[];
      routeGeometry: any[];
    };
    context: {
      fromLocation: Location;
      toLocation: Location;
      timeContext: string;
      weatherNote: string;
      safetyAlerts: string[];
      startLandmarks?: any[];
      endLandmarks?: any[];
    };
  };
  alternatives?: any[];
  metadata: {
    requestTime: string;
    processingTime: number;
    apiCalls: number;
    cacheHits: number;
  };
}

export class ComprehensiveJourneyTool extends BaseTool {
  private polylineService: PolylineService;
  private instructionParser: InstructionParserService;

  constructor(
    private oneMapService: OneMapService,
    private ltaService: LTAService,
    private weatherService?: WeatherService
  ) {
    super();
    this.polylineService = new PolylineService();
    this.instructionParser = new InstructionParserService();
  }

  getDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'plan_comprehensive_journey',
        description: 'Plan a comprehensive journey with step-by-step instructions, route visualization, and contextual information',
        inputSchema: this.createSchema({
          fromLocation: {
            oneOf: [
              {
                type: 'string',
                description: 'Starting location as address or landmark (e.g., "Marina Bay Sands", "Orchard MRT")',
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
                description: 'Destination location as coordinates',
              },
            ],
            description: 'Destination location - provide as address, postal code, or coordinates',
          },
          mode: {
            type: 'string',
            enum: ['PUBLIC_TRANSPORT', 'WALK', 'DRIVE', 'CYCLE', 'AUTO'],
            default: 'AUTO',
            description: 'Transport mode: AUTO (smart selection), PUBLIC_TRANSPORT (bus/train), WALK, DRIVE (taxi/car), CYCLE',
          },
          departureTime: {
            type: 'string',
            description: 'Departure time in ISO format (optional)',
          },
          arrivalTime: {
            type: 'string',
            description: 'Desired arrival time in ISO format (optional)',
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
                description: 'Adjust recommendations based on weather',
              },
            },
            description: 'Journey planning preferences',
          },
          outputOptions: {
            type: 'object',
            properties: {
              includeInstructions: {
                type: 'boolean',
                default: true,
                description: 'Include step-by-step instructions',
              },
              includePolylines: {
                type: 'boolean',
                default: true,
                description: 'Include route geometry for mapping',
              },
              includeAlternatives: {
                type: 'boolean',
                default: true,
                description: 'Include alternative routes',
              },
              includeContext: {
                type: 'boolean',
                default: true,
                description: 'Include contextual information (landmarks, safety, etc.)',
              },
              instructionFormat: {
                type: 'string',
                enum: ['detailed', 'simple', 'navigation'],
                default: 'detailed',
                description: 'Format for instructions: detailed (full info), simple (basic), navigation (turn-by-turn)',
              },
              coordinateFormat: {
                type: 'string',
                enum: ['WGS84', 'decimal'],
                default: 'WGS84',
                description: 'Coordinate format for output',
              },
            },
            description: 'Output formatting options',
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

  async execute(toolName: string, args: unknown): Promise<ComprehensiveJourneyResponse> {
    const startTime = Date.now();
    let apiCalls = 0;
    let cacheHits = 0;

    try {
      const input = validateInput(ComprehensiveJourneyInputSchema, args);
      
      logger.info('Planning comprehensive journey', {
        from: input.fromLocation,
        to: input.toLocation,
        mode: input.mode,
        preferences: input.preferences
      });

      // Resolve locations
      const [fromLocation, toLocation] = await Promise.all([
        this.resolveLocation(input.fromLocation),
        this.resolveLocation(input.toLocation),
      ]);
      apiCalls += 2;

      if (!fromLocation) {
        return this.createErrorResponse(`Could not find location: ${JSON.stringify(input.fromLocation)}`, startTime, apiCalls, cacheHits);
      }

      if (!toLocation) {
        return this.createErrorResponse(`Could not find location: ${JSON.stringify(input.toLocation)}`, startTime, apiCalls, cacheHits);
      }

      // Determine optimal mode if AUTO is selected
      const resolvedMode: 'PUBLIC_TRANSPORT' | 'WALK' | 'DRIVE' | 'CYCLE' = input.mode === 'AUTO' ? 
        this.selectOptimalMode(fromLocation, toLocation, input.preferences) : 
        input.mode as 'PUBLIC_TRANSPORT' | 'WALK' | 'DRIVE' | 'CYCLE';

      logger.info('Using transport mode', { resolvedMode, distance: this.calculateDistance(fromLocation.latitude, fromLocation.longitude, toLocation.latitude, toLocation.longitude) });

      // Get weather context if weather-aware routing is enabled
      let weatherContext = '';
      if (input.preferences?.weatherAware && this.weatherService) {
        try {
          const weather = await this.weatherService.getWeatherConditionsForLocation(
            fromLocation.latitude,
            fromLocation.longitude
          );
          weatherContext = this.getWeatherRecommendations(weather, resolvedMode);
          apiCalls++;
        } catch (error) {
          logger.warn('Weather service unavailable, continuing without weather data', error);
          weatherContext = 'Weather data temporarily unavailable';
        }
      }

      // Get landmarks near start and end points
      let startLandmarks: any[] = [];
      let endLandmarks: any[] = [];
      if (input.outputOptions?.includeContext) {
        try {
          startLandmarks = await this.getNearbyLandmarks(fromLocation);
          endLandmarks = await this.getNearbyLandmarks(toLocation);
          apiCalls += 2;
        } catch (error) {
          logger.warn('Failed to get landmarks', error);
        }
      }

      // Plan primary route with proper OneMap API integration
      const primaryRoute = await this.planPrimaryRoute(fromLocation, toLocation, resolvedMode, input);
      apiCalls++;

      if (!primaryRoute) {
        return this.createErrorResponse('No route found between the specified locations', startTime, apiCalls, cacheHits);
      }

      // Get alternative routes if requested
      const alternatives = input.outputOptions?.includeAlternatives ? 
        await this.getAlternativeRoutes(fromLocation, toLocation, resolvedMode, input.preferences || {}, input.maxAlternatives || 3) : 
        [];
      apiCalls += alternatives.length;

      // Get traffic and disruption information
      const trafficInfo = await this.getTrafficAndDisruptions();
      apiCalls++;

      // Create comprehensive response
      const processingTime = Date.now() - startTime;

      return {
        success: true,
        journey: {
          summary: primaryRoute.summary,
          instructions: primaryRoute.instructions,
          formattedInstructions: primaryRoute.formattedInstructions,
          polylines: primaryRoute.polylines,
          visualization: primaryRoute.visualization,
          context: {
            fromLocation,
            toLocation,
            timeContext: this.getTimeContext(),
            weatherNote: weatherContext,
            safetyAlerts: trafficInfo.alerts,
            startLandmarks,
            endLandmarks
          }
        },
        alternatives,
        metadata: {
          requestTime: new Date().toISOString(),
          processingTime,
          apiCalls,
          cacheHits
        }
      };

    } catch (error) {
      logger.error(`Comprehensive journey planning failed: ${toolName}`, error);
      return this.createErrorResponse(
        error instanceof Error ? error.message : 'Unknown error occurred',
        startTime,
        apiCalls,
        cacheHits
      );
    }
  }

  private async resolveLocation(locationInput: any): Promise<Location | null> {
    // Reuse the location resolution logic from the existing journey tool
    try {
      let parsedInput = locationInput;
      
      if (typeof locationInput === 'string') {
        try {
          const parsed = JSON.parse(locationInput);
          if (parsed && typeof parsed === 'object') {
            parsedInput = parsed;
          }
        } catch {
          return await this.oneMapService.geocode(locationInput);
        }
      }

      if (parsedInput && typeof parsedInput === 'object' && 'latitude' in parsedInput && 'longitude' in parsedInput) {
        const lat = parseFloat(parsedInput.latitude);
        const lng = parseFloat(parsedInput.longitude);
        
        if (lat < 1.0 || lat > 1.5 || lng < 103.0 || lng > 104.5) {
          return null;
        }
        
        return {
          latitude: lat,
          longitude: lng,
          name: parsedInput.name || 'Custom Location',
          address: parsedInput.name || `${lat.toFixed(6)}, ${lng.toFixed(6)}`,
        };
      }

      if (parsedInput && typeof parsedInput === 'object' && 'postalCode' in parsedInput) {
        const postalCode = parsedInput.postalCode.toString();
        if (!/^\d{6}$/.test(postalCode)) {
          return null;
        }
        return await this.oneMapService.geocode(postalCode);
      }

      if (typeof parsedInput === 'string') {
        return await this.oneMapService.geocode(parsedInput);
      }

      return null;
    } catch (error) {
      logger.error('Location resolution failed', { error, input: locationInput });
      return null;
    }
  }

  private selectOptimalMode(from: Location, to: Location, preferences: any): 'PUBLIC_TRANSPORT' | 'WALK' | 'DRIVE' | 'CYCLE' {
    const distance = this.calculateDistance(from.latitude, from.longitude, to.latitude, to.longitude);
    
    if (distance < 1000) return 'WALK';
    if (distance > 15000) return 'DRIVE';
    return 'PUBLIC_TRANSPORT';
  }

  private buildRouteOptions(input: any, mode: string) {
    const options: any = {
      mode: mode === 'CYCLE' ? 'WALK' : mode, // OneMap doesn't support cycle
    };

    if (input.departureTime) {
      options.departureTime = new Date(input.departureTime);
    }

    if (input.arrivalTime) {
      options.arrivalTime = new Date(input.arrivalTime);
    }

    if (mode === 'PUBLIC_TRANSPORT') {
      options.maxWalkDistance = input.preferences.maxWalkDistance;
      options.numItineraries = input.maxAlternatives;
    }

    return options;
  }

  private formatInstructions(instructions: ParsedInstruction[], format: string): string[] {
    switch (format) {
      case 'simple':
        return instructions.map(inst => inst.instruction);
      case 'navigation':
        return instructions.map(inst => {
          let nav = `${inst.step}. ${inst.instruction}`;
          if (inst.distance) {
            nav += ` (${inst.distance}m)`;
          }
          return nav;
        });
      case 'detailed':
      default:
        return this.instructionParser.formatInstructionsForDisplay(instructions);
    }
  }

  private createVisualizationData(polylines: any[], instructions: ParsedInstruction[]) {
    const stepMarkers = this.polylineService.createStepMarkers(instructions);
    
    let bounds = null;
    if (polylines.length > 0) {
      bounds = polylines[0].decoded?.bounds;
    }

    return {
      bounds,
      stepMarkers,
      routeGeometry: polylines.map(p => p.geojson)
    };
  }

  private async getContextInformation(from: Location, to: Location, preferences: any) {
    // Simple context information without complex LTA integration
    const safetyAlerts: string[] = [];
    
    // Add basic traffic information if available
    try {
      const trafficIncidents = await this.ltaService.getTrafficIncidents();
      if (trafficIncidents.length > 0) {
        safetyAlerts.push(`${trafficIncidents.length} traffic incidents reported in Singapore`);
      }
    } catch (error) {
      logger.warn('Failed to get traffic incidents', error);
    }

    return {
      weatherNote: preferences.weatherAware ? 'Weather conditions considered in recommendations' : 'Weather awareness is off.',
      safetyAlerts
    };
  }

  private async getAlternativeRoutes(from: Location, to: Location, primaryMode: string, preferences: any, maxAlternatives: number): Promise<any[]> {
    // Simplified alternative route logic
    const alternatives: any[] = [];
    
    if (primaryMode !== 'WALK') {
      try {
        const walkRoute = await this.oneMapService.planRoute(from, to, { mode: 'WALK' });
        if (walkRoute) {
          alternatives.push({
            mode: 'WALK',
            summary: 'Walking route',
            // Would include full route data
          });
        }
      } catch (error) {
        logger.warn('Failed to get walking alternative', error);
      }
    }

    return alternatives.slice(0, maxAlternatives);
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3;
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

  private getTimeContext(): string {
    const hour = new Date().getHours();
    if (hour >= 7 && hour <= 9) return 'Morning Peak';
    if (hour >= 17 && hour <= 19) return 'Evening Peak';
    if (hour >= 23 || hour <= 5) return 'Late Night';
    return 'Off Peak';
  }

  private createErrorResponse(message: string, startTime: number, apiCalls: number, cacheHits: number): ComprehensiveJourneyResponse {
    return {
      success: false,
      journey: {
        summary: {
          responseType: 'ERROR',
          instructionCount: 0,
          polylineCount: 0
        },
        instructions: [],
        formattedInstructions: [],
        polylines: [],
        visualization: {
          bounds: null,
          stepMarkers: [],
          routeGeometry: []
        },
        context: {
          fromLocation: { latitude: 0, longitude: 0, name: 'Unknown' },
          toLocation: { latitude: 0, longitude: 0, name: 'Unknown' },
          timeContext: this.getTimeContext(),
          weatherNote: '',
          safetyAlerts: [message]
        }
      },
      metadata: {
        requestTime: new Date().toISOString(),
        processingTime: Date.now() - startTime,
        apiCalls,
        cacheHits
      }
    };
  }

  private getWeatherRecommendations(weather: any, mode: string): string {
    if (!weather) return '';
    
    const conditions = weather.condition?.toLowerCase() || '';
    const temp = weather.temperature || 0;
    
    const recommendations: string[] = [];
    
    if (conditions.includes('rain') || conditions.includes('shower')) {
      if (mode === 'WALK') {
        recommendations.push('Consider covered walkways due to rain');
      } else {
        recommendations.push('Rain detected - public transport recommended');
      }
    }
    
    if (temp > 32) {
      recommendations.push('High temperature - stay hydrated and seek shade');
    }
    
    if (conditions.includes('haze')) {
      recommendations.push('Hazy conditions - consider indoor routes if sensitive');
    }
    
    return recommendations.length > 0 ? recommendations.join('. ') : 'Weather conditions are favorable for travel';
  }

  private async getNearbyLandmarks(location: Location): Promise<any[]> {
    try {
      // Simple landmark search - in a full implementation, this would use ThemesService
      const landmarks = [
        {
          name: `Landmark near ${location.name}`,
          distance: Math.floor(Math.random() * 500) + 100,
          type: 'Point of Interest'
        }
      ];
      return landmarks;
    } catch (error) {
      logger.warn('Failed to get landmarks', error);
      return [];
    }
  }

  private async planPrimaryRoute(from: Location, to: Location, mode: string, input: any): Promise<any> {
    try {
      logger.info('Planning primary route', { mode, from: from.name, to: to.name });
      
      // Build proper OneMap route options
      const routeOptions = this.buildProperRouteOptions(mode, input);
      
      // Call OneMap routing API with correct parameters
      const response = await this.oneMapService.planRoute(from, to, routeOptions);
      
      if (!response) {
        return null;
      }

      // Process the response based on mode
      if (mode === 'PUBLIC_TRANSPORT') {
        return this.processPublicTransportResponse(response, input);
      } else {
        return this.processDirectRouteResponse(response, input);
      }
      
    } catch (error) {
      logger.error('Primary route planning failed', error);
      return null;
    }
  }

  private buildProperRouteOptions(mode: string, input: any): any {
    const now = new Date();
    
    if (mode === 'PUBLIC_TRANSPORT') {
      return {
        mode: 'PUBLIC_TRANSPORT',
        departureTime: input.departureTime ? new Date(input.departureTime) : now,
        maxWalkDistance: input.preferences?.maxWalkDistance || 1000,
        numItineraries: input.maxAlternatives || 3
      };
    } else {
      return {
        mode: mode as 'WALK' | 'DRIVE',
        departureTime: input.departureTime ? new Date(input.departureTime) : now
      };
    }
  }

  private formatDate(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    return `${month}-${day}-${year}`;
  }

  private formatTime(date: Date): string {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}${minutes}${seconds}`;
  }

  private processPublicTransportResponse(response: any, input: any): any {
    try {
      // OneMapService returns a JourneyPlan object, not raw API response
      if (!response || !response.segments || response.segments.length === 0) {
        return null;
      }

      const instructions = this.parseJourneyPlanInstructions(response);
      const polylines = this.extractJourneyPlanPolylines(response);
      
      return {
        summary: {
          responseType: 'PUBLIC_TRANSPORT',
          instructionCount: instructions.length,
          polylineCount: polylines.length,
          totalDuration: response.totalDuration,
          totalDistance: response.totalDistance,
          transfers: response.transfers || 0
        },
        instructions,
        formattedInstructions: this.formatInstructions(instructions, input.outputOptions?.instructionFormat || 'detailed'),
        polylines,
        visualization: this.createVisualizationData(polylines, instructions)
      };
    } catch (error) {
      logger.error('Failed to process public transport response', error);
      return null;
    }
  }

  private processDirectRouteResponse(response: any, input: any): any {
    try {
      // OneMapService returns a JourneyPlan object for direct routes too
      if (!response || !response.segments || response.segments.length === 0) {
        return null;
      }

      const instructions = this.parseJourneyPlanInstructions(response);
      const polylines = this.extractJourneyPlanPolylines(response);
      
      return {
        summary: {
          responseType: 'DIRECT_ROUTING',
          instructionCount: instructions.length,
          polylineCount: polylines.length,
          totalDuration: response.totalDuration || 0,
          totalDistance: response.totalDistance || 0
        },
        instructions,
        formattedInstructions: this.formatInstructions(instructions, input.outputOptions?.instructionFormat || 'detailed'),
        polylines,
        visualization: this.createVisualizationData(polylines, instructions)
      };
    } catch (error) {
      logger.error('Failed to process direct route response', error);
      return null;
    }
  }

  private parsePublicTransportInstructions(itinerary: any): ParsedInstruction[] {
    const instructions: ParsedInstruction[] = [];
    let stepNumber = 1;

    for (const leg of itinerary.legs || []) {
      if (leg.mode === 'WALK') {
        instructions.push({
          step: stepNumber++,
          type: 'transit_walk',
          instruction: `Walk to ${leg.to.name}`,
          distance: Math.round(leg.distance || 0),
          duration: Math.round(leg.duration || 0),
          mode: 'WALK',
          coordinates: { lat: leg.from.lat, lng: leg.from.lon }
        });
      } else {
        const transitMode = this.mapTransitMode(leg.mode);
        instructions.push({
          step: stepNumber++,
          type: 'transit',
          instruction: `Take ${leg.route} ${leg.mode.toLowerCase()} from ${leg.from.name} to ${leg.to.name}`,
          distance: Math.round(leg.distance || 0),
          duration: Math.round(leg.duration || 0),
          mode: transitMode,
          coordinates: { lat: leg.from.lat, lng: leg.from.lon },
          service: leg.route,
          operator: leg.agencyName,
          from: {
            name: leg.from.name,
            stopCode: leg.from.stopCode,
            coordinates: { lat: leg.from.lat, lng: leg.from.lon }
          },
          to: {
            name: leg.to.name,
            stopCode: leg.to.stopCode,
            coordinates: { lat: leg.to.lat, lng: leg.to.lon }
          },
          intermediateStops: leg.intermediateStops?.map((stop: any) => ({
            name: stop.name,
            stopCode: stop.stopCode,
            coordinates: { lat: stop.lat, lng: stop.lon }
          }))
        });
      }
    }

    return instructions;
  }

  private parseDirectRouteInstructions(response: any): ParsedInstruction[] {
    const instructions: ParsedInstruction[] = [];
    
    if (response.route_instructions) {
      response.route_instructions.forEach((instruction: any, index: number) => {
        const coords = instruction[3] ? instruction[3].split(',').map(Number) : [0, 0];
        instructions.push({
          step: index + 1,
          type: 'direct',
          instruction: instruction[9] || instruction[1] || 'Continue',
          distance: instruction[2] || 0,
          coordinates: { lat: coords[0], lng: coords[1] },
          mode: 'WALK',
          direction: instruction[0],
          streetName: instruction[1]
        });
      });
    }

    return instructions;
  }

  private mapTransitMode(apiMode: string): 'WALK' | 'BUS' | 'TRAIN' | 'SUBWAY' | 'TAXI' {
    switch (apiMode.toUpperCase()) {
      case 'WALK':
        return 'WALK';
      case 'BUS':
        return 'BUS';
      case 'RAIL':
      case 'SUBWAY':
        return 'SUBWAY';
      case 'TRAIN':
        return 'TRAIN';
      default:
        return 'WALK';
    }
  }

  private extractPolylines(itinerary: any): any[] {
    const polylines: any[] = [];
    
    for (const leg of itinerary.legs || []) {
      if (leg.legGeometry && leg.legGeometry.points) {
        polylines.push({
          encoded: leg.legGeometry.points,
          mode: leg.mode,
          // Would decode polyline here in full implementation
        });
      }
    }
    
    return polylines;
  }

  private extractDirectPolylines(response: any): any[] {
    const polylines: any[] = [];
    
    if (response.route_geometry) {
      polylines.push({
        encoded: response.route_geometry,
        mode: 'DIRECT'
      });
    }
    
    return polylines;
  }

  private parseJourneyPlanInstructions(journeyPlan: any): ParsedInstruction[] {
    const instructions: ParsedInstruction[] = [];
    let stepNumber = 1;

    for (const segment of journeyPlan.segments || []) {
      if (segment.mode === 'WALK') {
        instructions.push({
          step: stepNumber++,
          type: 'transit_walk',
          instruction: segment.instructions?.[0] || `Walk to ${segment.endLocation.name}`,
          distance: Math.round(segment.distance || 0),
          duration: Math.round(segment.duration || 0),
          mode: 'WALK',
          coordinates: { 
            lat: segment.startLocation.latitude, 
            lng: segment.startLocation.longitude 
          }
        });
      } else {
        const transitMode = this.mapTransitMode(segment.mode);
        instructions.push({
          step: stepNumber++,
          type: 'transit',
          instruction: segment.instructions?.[0] || `Take ${segment.service || segment.mode} from ${segment.startLocation.name} to ${segment.endLocation.name}`,
          distance: Math.round(segment.distance || 0),
          duration: Math.round(segment.duration || 0),
          mode: transitMode,
          coordinates: { 
            lat: segment.startLocation.latitude, 
            lng: segment.startLocation.longitude 
          },
          service: segment.service,
          operator: segment.operator,
          from: {
            name: segment.startLocation.name,
            coordinates: { 
              lat: segment.startLocation.latitude, 
              lng: segment.startLocation.longitude 
            }
          },
          to: {
            name: segment.endLocation.name,
            coordinates: { 
              lat: segment.endLocation.latitude, 
              lng: segment.endLocation.longitude 
            }
          }
        });
      }
    }

    return instructions;
  }

  private extractJourneyPlanPolylines(journeyPlan: any): any[] {
    const polylines: any[] = [];
    
    // For now, return empty array since JourneyPlan doesn't include polyline data
    // In a full implementation, this would extract encoded polylines from the journey plan
    
    return polylines;
  }

  private async getTrafficAndDisruptions(): Promise<{ alerts: string[] }> {
    const alerts: string[] = [];
    
    try {
      // Get traffic incidents
      const incidents = await this.ltaService.getTrafficIncidents();
      if (incidents.length > 0) {
        alerts.push(`${incidents.length} traffic incidents reported`);
        
        // Add specific incident details for major disruptions
        const majorIncidents = incidents.filter((incident: any) => 
          incident.Message?.toLowerCase().includes('expressway') || 
          incident.Message?.toLowerCase().includes('closure')
        );
        
        if (majorIncidents.length > 0) {
          alerts.push(`${majorIncidents.length} major road disruptions detected`);
        }
      }
      
      // Could add MRT service alerts here
      // const mrtAlerts = await this.ltaService.getTrainServiceAlerts();
      
    } catch (error) {
      logger.warn('Failed to get traffic information', error);
    }
    
    return { alerts };
  }
}
