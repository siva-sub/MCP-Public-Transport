import axios, { AxiosInstance } from 'axios';
import { CacheService } from './cache';
import { APIError } from '../utils/errors';
import { logger } from '../utils/logger';
import { Location, JourneyPlan, RouteSegment } from '../types/transport';

interface OneMapSearchResult {
  SEARCHVAL: string;
  BLK_NO: string;
  ROAD_NAME: string;
  BUILDING: string;
  ADDRESS: string;
  POSTAL: string;
  X: string;
  Y: string;
  LATITUDE: string;
  LONGITUDE: string;
}

interface OneMapRouteResponse {
  plan: {
    date: number;
    from: {
      name: string;
      lat: number;
      lon: number;
    };
    to: {
      name: string;
      lat: number;
      lon: number;
    };
    itineraries: Array<{
      duration: number;
      startTime: number;
      endTime: number;
      walkTime: number;
      transitTime: number;
      waitingTime: number;
      walkDistance: number;
      transfers: number;
      fare: string;
      legs: Array<{
        startTime: number;
        endTime: number;
        duration: number;
        distance: number;
        mode: string;
        route: string;
        agencyName: string;
        routeShortName: string;
        from: {
          name: string;
          lat: number;
          lon: number;
          stopCode?: string;
        };
        to: {
          name: string;
          lat: number;
          lon: number;
          stopCode?: string;
        };
        legGeometry: {
          points: string;
        };
        steps?: Array<{
          distance: number;
          relativeDirection: string;
          streetName: string;
          absoluteDirection: string;
        }>;
        intermediateStops?: Array<{
          name: string;
          lat: number;
          lon: number;
          stopCode: string;
        }>;
      }>;
    }>;
  };
}

export class OneMapService {
  private client: AxiosInstance;
  private readonly baseUrl = 'https://www.onemap.gov.sg/api';

  constructor(
    private token?: string,
    private cache?: CacheService,
    private timeout: number = 30000
  ) {
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
        ...(this.token && { 'Authorization': this.token }),
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    this.client.interceptors.request.use(
      (config) => {
        logger.debug(`OneMap API Request: ${config.method?.toUpperCase()} ${config.url}`, {
          params: config.params,
        });
        return config;
      },
      (error) => Promise.reject(error)
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.debug(`OneMap API Response: ${response.status} ${response.config.url}`);
        return response;
      },
      (error) => {
        const status = error.response?.status;
        const message = error.response?.data?.error || error.message;
        
        logger.error(`OneMap API error: ${status}`, {
          url: error.config?.url,
          status,
          message,
        });

        throw new APIError(
          `OneMap API error: ${message}`,
          'ONEMAP_API_ERROR',
          status || 500
        );
      }
    );
  }

  async geocode(query: string): Promise<Location | null> {
    const cacheKey = `geocode_${query.toLowerCase()}`;
    
    if (this.cache) {
      return this.cache.getOrSet(cacheKey, async () => {
        return this._geocode(query);
      }, 3600); // 1 hour cache
    }
    
    return this._geocode(query);
  }

  private async _geocode(query: string): Promise<Location | null> {
    try {
      const response = await this.client.get('/common/elastic/search', {
        params: {
          searchVal: query,
          returnGeom: 'Y',
          getAddrDetails: 'Y',
        },
      });

      const data = response.data;
      
      if (data.found === 0 || !data.results || data.results.length === 0) {
        logger.warn(`No geocoding results found for: ${query}`);
        return null;
      }

      const result = data.results[0] as OneMapSearchResult;
      
      return {
        latitude: parseFloat(result.LATITUDE),
        longitude: parseFloat(result.LONGITUDE),
        name: result.BUILDING || result.ROAD_NAME,
        address: result.ADDRESS,
      };
    } catch (error) {
      logger.error(`Geocoding failed for: ${query}`, error);
      return null;
    }
  }

  async planRoute(
    from: Location,
    to: Location,
    options: {
      mode?: 'PUBLIC_TRANSPORT' | 'WALK' | 'DRIVE';
      departureTime?: Date;
      arrivalTime?: Date;
      maxWalkDistance?: number;
      numItineraries?: number;
    } = {}
  ): Promise<JourneyPlan | null> {
    const {
      mode = 'PUBLIC_TRANSPORT',
      departureTime,
      arrivalTime,
      maxWalkDistance = 1000,
      numItineraries = 3,
    } = options;

    const cacheKey = `route_${from.latitude}_${from.longitude}_${to.latitude}_${to.longitude}_${mode}`;
    
    if (this.cache) {
      return this.cache.getOrSet(cacheKey, async () => {
        return this._planRoute(from, to, {
          mode,
          departureTime,
          arrivalTime,
          maxWalkDistance,
          numItineraries,
        });
      }, 300); // 5 minute cache
    }
    
    return this._planRoute(from, to, options);
  }

  private async _planRoute(
    from: Location,
    to: Location,
    options: any
  ): Promise<JourneyPlan | null> {
    try {
      const now = new Date();
      const routeType = this.mapModeToRouteType(options.mode);
      
      const params: any = {
        start: `${from.latitude},${from.longitude}`,
        end: `${to.latitude},${to.longitude}`,
        routeType,
        numItineraries: options.numItineraries,
      };

      // Set time parameters
      if (options.departureTime) {
        params.date = this.formatDate(options.departureTime);
        params.time = this.formatTime(options.departureTime);
        params.arriveBy = 'false';
      } else if (options.arrivalTime) {
        params.date = this.formatDate(options.arrivalTime);
        params.time = this.formatTime(options.arrivalTime);
        params.arriveBy = 'true';
      } else {
        params.date = this.formatDate(now);
        params.time = this.formatTime(now);
        params.arriveBy = 'false';
      }

      // Add mode-specific parameters
      if (options.mode === 'PUBLIC_TRANSPORT') {
        params.mode = 'TRANSIT';
        params.maxWalkDistance = options.maxWalkDistance;
        params.showIntermediateStops = 'true';
      }

      const response = await this.client.get<OneMapRouteResponse>('/public/routingsvc/route', { params });
      
      if (!response.data.plan?.itineraries?.length) {
        logger.warn('No route found', { from, to, params });
        return null;
      }

      return this.formatRouteResponse(response.data);
    } catch (error) {
      logger.error('Route planning failed', error);
      return null;
    }
  }

  private mapModeToRouteType(mode: string): string {
    switch (mode) {
      case 'PUBLIC_TRANSPORT':
        return 'pt';
      case 'WALK':
        return 'walk';
      case 'DRIVE':
        return 'drive';
      default:
        return 'pt';
    }
  }

  private formatDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
      month: '2-digit',
      day: '2-digit',
      year: 'numeric',
    });
  }

  private formatTime(date: Date): string {
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  private formatRouteResponse(data: OneMapRouteResponse): JourneyPlan {
    const itinerary = data.plan.itineraries[0]; // Use first/best itinerary
    
    const segments: RouteSegment[] = itinerary.legs.map((leg): RouteSegment => {
      const instructions: string[] = [];
      
      if (leg.mode === 'WALK') {
        if (leg.steps) {
          instructions.push(...leg.steps.map(step => 
            `${step.relativeDirection} on ${step.streetName} for ${step.distance}m`
          ));
        } else {
          instructions.push(`Walk ${leg.distance}m to ${leg.to.name}`);
        }
      } else {
        instructions.push(`Take ${leg.routeShortName || leg.route} from ${leg.from.name} to ${leg.to.name}`);
        if (leg.agencyName) {
          instructions.push(`Operated by ${leg.agencyName}`);
        }
      }

      return {
        mode: this.mapApiModeToMode(leg.mode),
        duration: leg.duration,
        distance: leg.distance,
        instructions,
        startLocation: {
          latitude: leg.from.lat,
          longitude: leg.from.lon,
          name: leg.from.name,
        },
        endLocation: {
          latitude: leg.to.lat,
          longitude: leg.to.lon,
          name: leg.to.name,
        },
        service: leg.routeShortName,
        operator: leg.agencyName,
      };
    });

    const totalCost = parseFloat(itinerary.fare) || 0;
    
    return {
      segments,
      totalDuration: itinerary.duration,
      totalDistance: itinerary.walkDistance,
      totalCost,
      totalWalkDistance: itinerary.walkDistance,
      transfers: itinerary.transfers,
      summary: this.createJourneySummary(segments, itinerary),
    };
  }

  private mapApiModeToMode(apiMode: string): 'WALK' | 'BUS' | 'TRAIN' | 'TAXI' {
    switch (apiMode.toUpperCase()) {
      case 'WALK':
        return 'WALK';
      case 'BUS':
        return 'BUS';
      case 'RAIL':
      case 'SUBWAY':
        return 'TRAIN';
      default:
        return 'WALK';
    }
  }

  private createJourneySummary(segments: RouteSegment[], itinerary: any): string {
    const duration = Math.round(itinerary.duration / 60);
    const cost = parseFloat(itinerary.fare) || 0;
    const transfers = itinerary.transfers;
    
    const modeCount = segments.reduce((acc, segment) => {
      acc[segment.mode] = (acc[segment.mode] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const modeDescriptions: string[] = [];
    if (modeCount.BUS) modeDescriptions.push(`${modeCount.BUS} bus${modeCount.BUS > 1 ? 'es' : ''}`);
    if (modeCount.TRAIN) modeDescriptions.push(`${modeCount.TRAIN} train${modeCount.TRAIN > 1 ? 's' : ''}`);
    if (modeCount.WALK) modeDescriptions.push('walking');

    let summary = `${duration} min via ${modeDescriptions.join(' + ')}`;
    if (cost > 0) summary += `, $${cost.toFixed(2)}`;
    if (transfers > 0) summary += `, ${transfers} transfer${transfers > 1 ? 's' : ''}`;

    return summary;
  }
}
