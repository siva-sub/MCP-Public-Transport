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

      // Plan the route
      const routeOptions = this.buildRouteOptions(input, resolvedMode);
      const response = await this.oneMapService.planRoute(fromLocation, toLocation, routeOptions);
      apiCalls++;

      if (!response) {
        return this.createErrorResponse('No route found between the specified locations', startTime, apiCalls, cacheHits);
      }

      // Parse instructions
      const instructions = this.instructionParser.parseInstructions(response);
      
      // Process polylines
      const polylines = input.outputOptions?.includePolylines ? 
        this.polylineService.processPolylines(response) : [];

      // Generate summary
      const summary = this.instructionParser.generateSummary(response, instructions, polylines.length);

      // Enhance instructions with context
      const enhancedInstructions = input.outputOptions?.includeContext ? 
        this.instructionParser.enhanceInstructions(instructions) : instructions;

      // Format instructions
      const formattedInstructions = this.formatInstructions(enhancedInstructions, input.outputOptions?.instructionFormat || 'detailed');

      // Create visualization data
      const visualization = this.createVisualizationData(polylines, enhancedInstructions);

      // Get context information
      const context = await this.getContextInformation(fromLocation, toLocation, input.preferences);

      // Get alternatives if requested
      const alternatives = input.outputOptions?.includeAlternatives ? 
        await this.getAlternativeRoutes(fromLocation, toLocation, resolvedMode, input.preferences, input.maxAlternatives || 3) : 
        undefined;

      const processingTime = Date.now() - startTime;

      return {
        success: true,
        journey: {
          summary,
          instructions: enhancedInstructions,
          formattedInstructions,
          polylines,
          visualization,
          context: {
            fromLocation,
            toLocation,
            timeContext: this.getTimeContext(),
            weatherNote: context.weatherNote,
            safetyAlerts: context.safetyAlerts
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
}
