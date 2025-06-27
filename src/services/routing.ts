import axios, { AxiosInstance } from 'axios';
import { OneMapService } from './onemap.js';
import { LTAService } from './lta.js';
import { WeatherService, WeatherConditions, WeatherAdvisory } from './weather.js';
import { CacheService } from './cache.js';
import { logger } from '../utils/logger.js';
import { APIError } from '../utils/errors.js';

export interface RouteInstruction {
  direction: string;
  streetName: string;
  distance: number;
  coordinates: string;
  duration: number;
  distanceText: string;
  bearing: string;
  fromBearing: string;
  mode: 'walking' | 'driving' | 'cycling';
  instruction: string;
}

export interface RouteSegment {
  mode: 'WALK' | 'BUS' | 'MRT' | 'LRT' | 'DRIVE';
  duration: number;
  distance: number;
  instructions: RouteInstruction[];
  startLocation: {
    latitude: number;
    longitude: number;
    name?: string;
  };
  endLocation: {
    latitude: number;
    longitude: number;
    name?: string;
  };
  // Transport-specific fields
  line?: string;
  service?: string;
  operator?: string;
  stations?: string[];
  stops?: string[];
  realTimeInfo?: any;
  platformInfo?: {
    platform?: string;
    direction?: string;
  };
}

export interface JourneyPlan {
  summary: {
    totalTime: number;
    totalDistance: number;
    totalCost: number;
    walkingTime: number;
    walkingDistance: number;
    transfers: number;
    modes: string[];
  };
  segments: RouteSegment[];
  weatherImpact: {
    conditions: WeatherConditions;
    advisories: WeatherAdvisory[];
    adjustedWalkingTime: number;
  };
  disruptions: {
    current: any[];
    warnings: string[];
    alternatives?: string;
  };
  confidence: number;
  timestamp: string;
}

export interface RoutingPreferences {
  minimizeTransfers: boolean;
  minimizeWalkingTime: boolean;
  minimizeTotalTime: boolean;
  allowDriving: boolean;
  accessibilityRequired: boolean;
  maxWalkingDistance: number;
  departureTime?: string;
}

export class EnhancedRoutingService {
  private oneMapClient: AxiosInstance;

  constructor(
    private oneMapService: OneMapService,
    private ltaService: LTAService,
    private weatherService: WeatherService,
    private cache: CacheService,
    private timeout: number = 30000
  ) {
    this.oneMapClient = axios.create({
      baseURL: 'https://developers.onemap.sg/privateapi',
      timeout: this.timeout,
    });
  }

  async planOptimalJourney(
    origin: { latitude: number; longitude: number; name?: string },
    destination: { latitude: number; longitude: number; name?: string },
    preferences: RoutingPreferences = {
      minimizeTransfers: true,
      minimizeWalkingTime: false,
      minimizeTotalTime: true,
      allowDriving: false,
      accessibilityRequired: false,
      maxWalkingDistance: 1000,
    }
  ): Promise<JourneyPlan[]> {
    logger.info('Planning optimal journey', {
      origin: `${origin.latitude},${origin.longitude}`,
      destination: `${destination.latitude},${destination.longitude}`,
      preferences,
    });

    try {
      // Get weather conditions for the route
      const weatherConditions = await this.weatherService.getWeatherConditionsForLocation(
        (origin.latitude + destination.latitude) / 2,
        (origin.longitude + destination.longitude) / 2
      );

      const weatherAdvisories = this.weatherService.generateWeatherAdvisory(weatherConditions);

      // Get current disruptions
      const disruptions = await this.getCurrentDisruptions();

      // Generate multiple route options
      const routeOptions: JourneyPlan[] = [];

      // Option 1: Public Transport (Primary)
      if (!preferences.allowDriving) {
        const ptRoute = await this.generatePublicTransportRoute(
          origin,
          destination,
          preferences,
          weatherConditions,
          disruptions
        );
        if (ptRoute) routeOptions.push(ptRoute);
      }

      // Option 2: Driving (if allowed)
      if (preferences.allowDriving) {
        const drivingRoute = await this.generateDrivingRoute(
          origin,
          destination,
          weatherConditions
        );
        if (drivingRoute) routeOptions.push(drivingRoute);
      }

      // Option 3: Walking + Public Transport Hybrid
      const hybridRoute = await this.generateHybridRoute(
        origin,
        destination,
        preferences,
        weatherConditions,
        disruptions
      );
      if (hybridRoute) routeOptions.push(hybridRoute);

      // Sort routes by preference criteria
      const sortedRoutes = this.sortRoutesByPreferences(routeOptions, preferences);

      return sortedRoutes.slice(0, 3); // Return top 3 options
    } catch (error) {
      logger.error('Journey planning failed', error);
      throw new APIError(
        `Journey planning failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'ROUTING_ERROR'
      );
    }
  }

  private async generatePublicTransportRoute(
    origin: { latitude: number; longitude: number; name?: string },
    destination: { latitude: number; longitude: number; name?: string },
    preferences: RoutingPreferences,
    weather: WeatherConditions,
    disruptions: any[]
  ): Promise<JourneyPlan | null> {
    try {
      // Use OneMap public transport routing
      const token = await this.oneMapService.ensureValidToken();
      
      const response = await this.oneMapClient.get('/routingsvc/route', {
        params: {
          start: `${origin.latitude},${origin.longitude}`,
          end: `${destination.latitude},${destination.longitude}`,
          routeType: 'pt',
          maxWalkDistance: preferences.maxWalkingDistance,
          mode: 'TRANSIT',
          token,
        },
      });

      if (response.data.status !== 0) {
        logger.warn('OneMap PT routing failed', response.data);
        return null;
      }

      // Parse OneMap response and enhance with real-time data
      const segments = await this.parseOneMapRoute(response.data, weather);
      
      // Calculate totals
      const summary = this.calculateRouteSummary(segments);
      
      // Apply weather adjustments
      const weatherImpact = this.calculateWeatherImpact(segments, weather);

      return {
        summary: {
          ...summary,
          walkingTime: weatherImpact.adjustedWalkingTime,
        },
        segments,
        weatherImpact: {
          conditions: weather,
          advisories: this.weatherService.generateWeatherAdvisory(weather),
          adjustedWalkingTime: weatherImpact.adjustedWalkingTime,
        },
        disruptions: {
          current: disruptions,
          warnings: this.generateDisruptionWarnings(disruptions),
        },
        confidence: this.calculateRouteConfidence(segments, disruptions),
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Public transport routing failed', error);
      return null;
    }
  }

  private async generateDrivingRoute(
    origin: { latitude: number; longitude: number; name?: string },
    destination: { latitude: number; longitude: number; name?: string },
    weather: WeatherConditions
  ): Promise<JourneyPlan | null> {
    try {
      const token = await this.oneMapService.ensureValidToken();
      
      const response = await this.oneMapClient.get('/routingsvc/route', {
        params: {
          start: `${origin.latitude},${origin.longitude}`,
          end: `${destination.latitude},${destination.longitude}`,
          routeType: 'drive',
          token,
        },
      });

      if (response.data.status !== 0) {
        logger.warn('OneMap driving routing failed', response.data);
        return null;
      }

      // Parse driving instructions
      const instructions = this.parseRouteInstructions(response.data.route_instructions, 'driving');
      
      const segment: RouteSegment = {
        mode: 'DRIVE',
        duration: response.data.route_summary.total_time,
        distance: response.data.route_summary.total_distance,
        instructions,
        startLocation: {
          latitude: origin.latitude,
          longitude: origin.longitude,
          name: origin.name || response.data.route_summary.start_point,
        },
        endLocation: {
          latitude: destination.latitude,
          longitude: destination.longitude,
          name: destination.name || response.data.route_summary.end_point,
        },
      };

      const summary = {
        totalTime: segment.duration,
        totalDistance: segment.distance,
        totalCost: this.estimateDrivingCost(segment.distance),
        walkingTime: 0,
        walkingDistance: 0,
        transfers: 0,
        modes: ['DRIVE'],
      };

      return {
        summary,
        segments: [segment],
        weatherImpact: {
          conditions: weather,
          advisories: this.weatherService.generateWeatherAdvisory(weather),
          adjustedWalkingTime: 0,
        },
        disruptions: {
          current: [],
          warnings: [],
        },
        confidence: 0.9,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Driving routing failed', error);
      return null;
    }
  }

  private async generateHybridRoute(
    origin: { latitude: number; longitude: number; name?: string },
    destination: { latitude: number; longitude: number; name?: string },
    preferences: RoutingPreferences,
    weather: WeatherConditions,
    disruptions: any[]
  ): Promise<JourneyPlan | null> {
    // This would implement a more complex hybrid routing strategy
    // For now, return null to focus on the main PT and driving routes
    return null;
  }

  private parseRouteInstructions(
    instructions: any[],
    mode: 'walking' | 'driving' | 'cycling'
  ): RouteInstruction[] {
    return instructions.map((instruction) => ({
      direction: instruction[0],
      streetName: instruction[1],
      distance: instruction[2],
      coordinates: instruction[3],
      duration: instruction[4],
      distanceText: instruction[5],
      bearing: instruction[6],
      fromBearing: instruction[7],
      mode,
      instruction: instruction[9],
    }));
  }

  private async parseOneMapRoute(oneMapResponse: any, weather: WeatherConditions): Promise<RouteSegment[]> {
    // This is a simplified parser - in reality, OneMap PT responses are more complex
    // and would need detailed parsing to extract walking segments, transit segments, etc.
    
    const segments: RouteSegment[] = [];
    
    // For now, create a basic walking segment as an example
    if (oneMapResponse.route_instructions) {
      const walkingInstructions = this.parseRouteInstructions(
        oneMapResponse.route_instructions,
        'walking'
      );

      segments.push({
        mode: 'WALK',
        duration: oneMapResponse.route_summary.total_time,
        distance: oneMapResponse.route_summary.total_distance,
        instructions: walkingInstructions,
        startLocation: {
          latitude: 0, // Would be parsed from actual response
          longitude: 0,
          name: oneMapResponse.route_summary.start_point,
        },
        endLocation: {
          latitude: 0, // Would be parsed from actual response
          longitude: 0,
          name: oneMapResponse.route_summary.end_point,
        },
      });
    }

    return segments;
  }

  private calculateRouteSummary(segments: RouteSegment[]) {
    const totalTime = segments.reduce((sum, seg) => sum + seg.duration, 0);
    const totalDistance = segments.reduce((sum, seg) => sum + seg.distance, 0);
    const walkingSegments = segments.filter(seg => seg.mode === 'WALK');
    const walkingTime = walkingSegments.reduce((sum, seg) => sum + seg.duration, 0);
    const walkingDistance = walkingSegments.reduce((sum, seg) => sum + seg.distance, 0);
    const transfers = Math.max(0, segments.filter(seg => seg.mode !== 'WALK').length - 1);
    const modes = [...new Set(segments.map(seg => seg.mode))];

    return {
      totalTime,
      totalDistance,
      totalCost: this.estimateTransportCost(segments),
      walkingTime,
      walkingDistance,
      transfers,
      modes,
    };
  }

  private calculateWeatherImpact(segments: RouteSegment[], weather: WeatherConditions) {
    const walkingSegments = segments.filter(seg => seg.mode === 'WALK');
    const baseWalkingTime = walkingSegments.reduce((sum, seg) => sum + seg.duration, 0);
    
    let multiplier = 1.0;
    
    // Apply weather multipliers
    if (weather.rainfall > 10) multiplier *= 1.5;
    else if (weather.rainfall > 2.5) multiplier *= 1.2;
    
    if (weather.temperature > 32) multiplier *= 1.3;
    else if (weather.temperature > 30) multiplier *= 1.1;
    
    if (weather.humidity > 85) multiplier *= 1.1;
    if (weather.windSpeed > 20) multiplier *= 1.1;

    return {
      adjustedWalkingTime: Math.round(baseWalkingTime * multiplier),
    };
  }

  private async getCurrentDisruptions(): Promise<any[]> {
    try {
      const trainAlerts = await this.ltaService.getTrainServiceAlerts();
      const trafficIncidents = await this.ltaService.getTrafficIncidents();
      
      return [...trainAlerts, ...trafficIncidents];
    } catch (error) {
      logger.warn('Failed to get current disruptions', error);
      return [];
    }
  }

  private generateDisruptionWarnings(disruptions: any[]): string[] {
    return disruptions.map(disruption => {
      if (disruption.line) {
        return `${disruption.lineName || disruption.line} service disruption`;
      }
      if (disruption.message) {
        return disruption.message;
      }
      return 'Service disruption detected';
    });
  }

  private calculateRouteConfidence(segments: RouteSegment[], disruptions: any[]): number {
    let confidence = 0.9;
    
    // Reduce confidence for each disruption
    confidence -= disruptions.length * 0.1;
    
    // Reduce confidence for complex routes with many transfers
    const transfers = Math.max(0, segments.filter(seg => seg.mode !== 'WALK').length - 1);
    confidence -= transfers * 0.05;
    
    return Math.max(0.3, Math.min(1.0, confidence));
  }

  private sortRoutesByPreferences(routes: JourneyPlan[], preferences: RoutingPreferences): JourneyPlan[] {
    return routes.sort((a, b) => {
      if (preferences.minimizeTransfers) {
        const transferDiff = a.summary.transfers - b.summary.transfers;
        if (transferDiff !== 0) return transferDiff;
      }
      
      if (preferences.minimizeTotalTime) {
        return a.summary.totalTime - b.summary.totalTime;
      }
      
      if (preferences.minimizeWalkingTime) {
        return a.summary.walkingTime - b.summary.walkingTime;
      }
      
      return a.summary.totalTime - b.summary.totalTime;
    });
  }

  private estimateTransportCost(segments: RouteSegment[]): number {
    // Simplified cost estimation
    let cost = 0;
    
    for (const segment of segments) {
      if (segment.mode === 'BUS') cost += 1.0;
      if (segment.mode === 'MRT' || segment.mode === 'LRT') cost += 1.5;
    }
    
    return Math.max(0.8, cost); // Minimum fare
  }

  private estimateDrivingCost(distance: number): number {
    // Rough estimate: fuel + parking + ERP
    const fuelCost = (distance / 1000) * 0.15; // $0.15 per km
    const parkingCost = 5.0; // Average parking
    const erpCost = 2.0; // Average ERP
    
    return fuelCost + parkingCost + erpCost;
  }
}
