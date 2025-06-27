import axios, { AxiosInstance } from 'axios';
import { CacheService } from './cache.js';
import { APIError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { Location, JourneyPlan, RouteSegment } from '../types/transport.js';
import { OneMapSearchResult } from '../types/location.js';

interface OneMapRouteResponse {
  plan?: {
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
  // Direct routing response (drive/walk/cycle)
  status_message?: string;
  route_geometry?: string;
  status?: number;
  route_instructions?: Array<[
    string, // direction (e.g., "Left", "Right", "Straight")
    string, // street name
    number, // distance in meters
    string, // coordinates
    number, // time in seconds
    string, // distance formatted (e.g., "145m")
    string, // compass direction from
    string, // compass direction to
    string, // mode (driving/walking)
    string  // instruction text
  ]>;
  route_name?: string[];
  route_summary?: {
    start_point: string;
    end_point: string;
    total_time: number;
    total_distance: number;
  };
  viaRoute?: string;
  subtitle?: string;
}

export class OneMapService {
  public client: AxiosInstance;
  private readonly baseUrl = 'https://www.onemap.gov.sg/api';
  private tokenCache: { token: string; expiry: number } | null = null;

  constructor(
    private staticToken?: string,
    private email?: string,
    private password?: string,
    private cache?: CacheService,
    private timeout: number = 30000 // Increased from 5000 to 30000 (30 seconds)
  ) {
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
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

  async ensureValidToken(): Promise<string> {
    // Use static token if provided
    if (this.staticToken) return this.staticToken;

    // Check cached token
    if (this.tokenCache && this.tokenCache.expiry > Date.now()) {
      return this.tokenCache.token;
    }

    // Refresh token
    if (!this.email || !this.password) {
      throw new APIError('OneMap credentials not configured', 'AUTH_MISSING', 401);
    }

    return this.refreshToken();
  }

  private async refreshToken(): Promise<string> {
    try {
      logger.info('Refreshing OneMap authentication token');
      
      // Use the correct authentication endpoint
      const response = await axios.post('https://developers.onemap.sg/privateapi/auth/post/getToken', {
        email: this.email,
        password: this.password,
      }, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: this.timeout,
      });

      const { access_token, expiry_timestamp } = response.data;
      
      this.tokenCache = {
        token: access_token,
        expiry: parseInt(expiry_timestamp) * 1000, // Convert to milliseconds
      };

      logger.info('OneMap token refreshed successfully', {
        expiry: new Date(this.tokenCache.expiry).toISOString()
      });
      return access_token;
    } catch (error) {
      logger.error('Failed to refresh OneMap token', error);
      throw new APIError('OneMap authentication failed', 'AUTH_FAILED', 401);
    }
  }

  // Enhanced geocoding with authentication
  async geocodeWithAuth(query: string): Promise<OneMapSearchResult[]> {
    try {
      const response = await this.client.get('/common/elastic/search', {
        params: {
          searchVal: query,
          returnGeom: 'Y',
          getAddrDetails: 'Y',
        },
        headers: this.staticToken ? {
          'Authorization': this.staticToken,
        } : undefined,
      });

      const data = response.data;
      
      if (data.found === 0 || !data.results || data.results.length === 0) {
        logger.debug(`No geocoding results found for: ${query}`);
        return [];
      }

      return data.results;
    } catch (error) {
      logger.error(`Geocoding with auth failed for: ${query}`, error);
      throw error;
    }
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
    options: {
      mode?: 'PUBLIC_TRANSPORT' | 'WALK' | 'DRIVE';
      departureTime?: Date;
      arrivalTime?: Date;
      maxWalkDistance?: number;
      numItineraries?: number;
    }
  ): Promise<JourneyPlan | null> {
    try {
      // Get authentication token for routing
      const token = await this.ensureValidToken();

      const routeType = this.mapModeToRouteType(options.mode || 'PUBLIC_TRANSPORT');
      
      const params: any = {
        start: `${from.latitude},${from.longitude}`,
        end: `${to.latitude},${to.longitude}`,
        routeType,
        token,
      };

      // Add mode-specific parameters
      if (options.mode === 'PUBLIC_TRANSPORT') {
        params.mode = 'TRANSIT';
        params.maxWalkDistance = options.maxWalkDistance || 1000;
        
        // Add time parameters for PT
        const now = new Date();
        if (options.departureTime) {
          params.date = this.formatDateForOneMap(options.departureTime);
          params.time = this.formatTimeForOneMap(options.departureTime);
          params.arriveBy = 'false';
        } else {
          params.date = this.formatDateForOneMap(now);
          params.time = this.formatTimeForOneMap(now);
          params.arriveBy = 'false';
        }
      }

      // Use the correct endpoint based on the API documentation
      const routingUrl = 'https://developers.onemap.sg/privateapi/routingsvc/route';
      
      // Make request with token as parameter (not header) using direct axios call
      const response = await axios.get<OneMapRouteResponse>(routingUrl, { 
        params,
        timeout: this.timeout,
      });
      
      // Check response status
      if (response.data.status !== undefined && response.data.status !== 0) {
        logger.warn('OneMap routing failed', { 
          status: response.data.status, 
          message: response.data.status_message,
          params 
        });
        return null;
      }

      // Check if we have a valid response
      if (!response.data.plan?.itineraries?.length && !response.data.route_instructions) {
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

  private formatDateForOneMap(date: Date): string {
    // OneMap expects MM-DD-YYYY format
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    return `${month}-${day}-${year}`;
  }

  private formatTimeForOneMap(date: Date): string {
    // OneMap expects HH:MM:SS format
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }

  private formatRouteResponse(data: OneMapRouteResponse): JourneyPlan {
    // Handle public transport response (with plan.itineraries)
    if (data.plan?.itineraries?.length) {
      return this.formatPublicTransportResponse(data);
    }
    
    // Handle direct routing response (walk/drive/cycle with route_instructions)
    if (data.route_instructions?.length) {
      return this.formatDirectRoutingResponse(data);
    }
    
    throw new APIError('Invalid route response format', 'INVALID_ROUTE_RESPONSE', 422);
  }

  private formatPublicTransportResponse(data: OneMapRouteResponse): JourneyPlan {
    const itinerary = data.plan!.itineraries[0]; // Use first/best itinerary
    
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

  private formatDirectRoutingResponse(data: OneMapRouteResponse): JourneyPlan {
    const instructions: string[] = [];
    let startCoords = { latitude: 0, longitude: 0 };
    let endCoords = { latitude: 0, longitude: 0 };
    
    // Process detailed turn-by-turn instructions
    if (data.route_instructions) {
      for (let i = 0; i < data.route_instructions.length; i++) {
        const instruction = data.route_instructions[i];
        const [direction, streetName, distance, coordinates, timeSeconds, distanceFormatted, fromDirection, toDirection, mode, instructionText] = instruction;
        
        // Parse coordinates from the first and last instructions
        if (i === 0 && coordinates) {
          const coords = coordinates.split(',');
          if (coords.length >= 2) {
            startCoords = {
              latitude: parseFloat(coords[0]),
              longitude: parseFloat(coords[1])
            };
          }
        }
        
        if (i === data.route_instructions.length - 1 && coordinates) {
          const coords = coordinates.split(',');
          if (coords.length >= 2) {
            endCoords = {
              latitude: parseFloat(coords[0]),
              longitude: parseFloat(coords[1])
            };
          }
        }
        
        // Use the detailed instruction text from OneMap
        if (instructionText && instructionText.trim()) {
          instructions.push(instructionText);
        } else {
          // Fallback to constructing instruction from components
          if (streetName && streetName.trim()) {
            instructions.push(`${direction} on ${streetName} for ${distanceFormatted || distance + 'm'}`);
          } else {
            instructions.push(`${direction} for ${distanceFormatted || distance + 'm'}`);
          }
        }
      }
    }

    const mode = this.determineDirectRouteMode(data.route_instructions?.[0]?.[8] || 'walking');
    const totalTime = data.route_summary?.total_time || 0;
    const totalDistance = data.route_summary?.total_distance || 0;

    const segments: RouteSegment[] = [{
      mode,
      duration: totalTime,
      distance: totalDistance,
      instructions,
      startLocation: {
        latitude: startCoords.latitude,
        longitude: startCoords.longitude,
        name: data.route_summary?.start_point || 'Origin',
      },
      endLocation: {
        latitude: endCoords.latitude,
        longitude: endCoords.longitude,
        name: data.route_summary?.end_point || 'Destination',
      },
    }];

    return {
      segments,
      totalDuration: totalTime,
      totalDistance: totalDistance,
      totalCost: 0, // No cost for walking/driving
      totalWalkDistance: mode === 'WALK' ? totalDistance : 0,
      transfers: 0,
      summary: this.createDirectRouteSummary(mode, totalTime, totalDistance),
    };
  }

  private determineDirectRouteMode(apiMode: string): 'WALK' | 'BUS' | 'TRAIN' | 'TAXI' {
    switch (apiMode?.toLowerCase()) {
      case 'walking':
        return 'WALK';
      case 'driving':
        return 'TAXI'; // Use TAXI for driving mode
      case 'cycling':
        return 'WALK'; // Use WALK for cycling (closest equivalent)
      default:
        return 'WALK';
    }
  }

  private createDirectRouteSummary(mode: 'WALK' | 'BUS' | 'TRAIN' | 'TAXI', timeSeconds: number, distanceMeters: number): string {
    const minutes = Math.round(timeSeconds / 60);
    const modeText = mode === 'TAXI' ? 'driving' : mode.toLowerCase();
    
    if (distanceMeters < 1000) {
      return `${minutes} min ${modeText} (${distanceMeters}m)`;
    } else {
      const km = (distanceMeters / 1000).toFixed(1);
      return `${minutes} min ${modeText} (${km}km)`;
    }
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
