import axios, { AxiosInstance, AxiosError } from 'axios';
import { CacheService } from './cache';
import { APIError, RateLimitError } from '../utils/errors';
import { logger } from '../utils/logger';
import { 
  BusStop, 
  BusService, 
  TrainServiceAlert,
  TaxiAvailability,
  TrafficIncident
} from '../types/transport';
import {
  LTABusArrivalResponse,
  LTABusStopsResponse,
  LTATrainServiceAlertsResponse
} from '../types/api';

export class LTAService {
  private client: AxiosInstance;
  private readonly baseUrl = 'https://datamall2.mytransport.sg/ltaodataservice';

  constructor(
    private accountKey: string,
    private cache: CacheService,
    private timeout: number = 30000
  ) {
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: {
        'AccountKey': this.accountKey,
        'Accept': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    // Request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        logger.debug(`LTA API Request: ${config.method?.toUpperCase()} ${config.url}`, {
          params: config.params,
        });
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => {
        logger.debug(`LTA API Response: ${response.status} ${response.config.url}`, {
          dataLength: JSON.stringify(response.data).length,
        });
        return response;
      },
      (error: AxiosError) => {
        const status = error.response?.status;
        const message = error.response?.data || error.message;
        
        logger.error(`LTA API error: ${status}`, {
          url: error.config?.url,
          status,
          message,
        });

        if (status === 429) {
          throw new RateLimitError(`LTA API rate limit exceeded: ${message}`);
        }

        if (status === 401) {
          throw new APIError('Invalid LTA API key', 'LTA_AUTH_ERROR', status);
        }

        if (status && status >= 500) {
          throw new APIError(
            `LTA API server error: ${message}`,
            'LTA_SERVER_ERROR',
            status
          );
        }

        throw new APIError(
          `LTA API error: ${message}`,
          'LTA_API_ERROR',
          status || 500
        );
      }
    );
  }

  async getBusArrival(busStopCode: string, serviceNo?: string): Promise<BusService[]> {
    const cacheKey = `bus_arrival_${busStopCode}_${serviceNo || 'all'}`;
    
    return this.cache.getOrSet(cacheKey, async () => {
      const params: any = { BusStopCode: busStopCode };
      if (serviceNo) {
        params.ServiceNo = serviceNo;
      }

      const response = await this.client.get<LTABusArrivalResponse>('/v3/BusArrival', { params });
      return this.formatBusArrival(response.data);
    }, 30); // 30 second cache for real-time data
  }

  async getBusStops(skip = 0, limit = 500): Promise<BusStop[]> {
    const cacheKey = `bus_stops_${skip}_${limit}`;
    
    return this.cache.getOrSet(cacheKey, async () => {
      const response = await this.client.get<LTABusStopsResponse>('/BusStops', {
        params: { $skip: skip, $top: limit }
      });
      
      return response.data.value.map((stop): BusStop => ({
        busStopCode: stop.BusStopCode,
        roadName: stop.RoadName,
        description: stop.Description,
        latitude: stop.Latitude,
        longitude: stop.Longitude,
      }));
    }, 3600); // 1 hour cache for static data
  }

  async getAllBusStops(): Promise<BusStop[]> {
    const cacheKey = 'all_bus_stops';
    
    return this.cache.getOrSet(cacheKey, async () => {
      const allStops: BusStop[] = [];
      let skip = 0;
      const limit = 500;
      
      while (true) {
        const stops = await this.getBusStops(skip, limit);
        allStops.push(...stops);
        
        if (stops.length < limit) {
          break;
        }
        
        skip += limit;
      }
      
      logger.info(`Loaded ${allStops.length} bus stops`);
      return allStops;
    }, 86400); // 24 hour cache
  }

  async getTrainServiceAlerts(): Promise<TrainServiceAlert[]> {
    const cacheKey = 'train_service_alerts';
    
    return this.cache.getOrSet(cacheKey, async () => {
      const response = await this.client.get<LTATrainServiceAlertsResponse>('/TrainServiceAlerts');
      return this.formatTrainAlerts(response.data);
    }, 60); // 1 minute cache
  }

  async getTaxiAvailability(): Promise<TaxiAvailability[]> {
    const cacheKey = 'taxi_availability';
    
    return this.cache.getOrSet(cacheKey, async () => {
      const response = await this.client.get('/Taxi-Availability');
      
      return response.data.value.map((taxi: any): TaxiAvailability => ({
        coordinates: [taxi.Latitude, taxi.Longitude],
        timestamp: taxi.Timestamp,
      }));
    }, 30); // 30 second cache
  }

  async getTrafficIncidents(): Promise<TrafficIncident[]> {
    const cacheKey = 'traffic_incidents';
    
    return this.cache.getOrSet(cacheKey, async () => {
      const response = await this.client.get('/TrafficIncidents');
      
      return response.data.value.map((incident: any): TrafficIncident => ({
        type: incident.Type,
        message: incident.Message,
        coordinates: incident.Latitude && incident.Longitude 
          ? [incident.Latitude, incident.Longitude]
          : undefined,
      }));
    }, 120); // 2 minute cache
  }

  private formatBusArrival(data: LTABusArrivalResponse): BusService[] {
    if (!data.Services) {
      return [];
    }

    return data.Services.map((service): BusService => ({
      serviceNo: service.ServiceNo,
      operator: this.getOperatorName(service.Operator),
      nextBuses: [service.NextBus, service.NextBus2, service.NextBus3]
        .filter(bus => bus?.EstimatedArrival)
        .map(bus => ({
          estimatedArrival: bus.EstimatedArrival,
          minutesAway: this.calculateMinutesAway(bus.EstimatedArrival),
          loadStatus: bus.Load,
          loadDescription: this.formatLoadStatus(bus.Load),
          wheelchairAccessible: bus.Feature === 'WAB',
          busType: bus.Type,
          busTypeDescription: this.formatBusType(bus.Type),
          latitude: bus.Latitude,
          longitude: bus.Longitude,
          visitNumber: bus.VisitNumber,
        })),
    })).filter(service => service.nextBuses.length > 0);
  }

  private formatTrainAlerts(data: LTATrainServiceAlertsResponse): TrainServiceAlert[] {
    if (data.Status === 1) {
      return []; // No alerts
    }

    const alerts: TrainServiceAlert[] = [];

    if (data.AffectedSegments) {
      alerts.push(...data.AffectedSegments.map((segment): TrainServiceAlert => ({
        line: segment.Line,
        lineName: this.getLineName(segment.Line),
        status: 'Disrupted',
        direction: segment.Direction,
        affectedStations: segment.Stations?.split(',').map(s => s.trim()) || [],
        alternativeTransport: segment.FreePublicBus === 'Y',
        shuttleService: segment.FreeMRTShuttle === 'Y',
      })));
    }

    return alerts;
  }

  private getOperatorName(code: string): string {
    const operators: Record<string, string> = {
      'SBST': 'SBS Transit',
      'SMRT': 'SMRT Buses',
      'TTS': 'Tower Transit Singapore',
      'GAS': 'Go-Ahead Singapore',
    };
    return operators[code] || code;
  }

  private getLineName(code: string): string {
    const lines: Record<string, string> = {
      'EWL': 'East West Line',
      'NSL': 'North South Line',
      'CCL': 'Circle Line',
      'DTL': 'Downtown Line',
      'NEL': 'North East Line',
      'BPL': 'Bukit Panjang LRT',
      'SLRT': 'Sengkang LRT',
      'PLRT': 'Punggol LRT',
      'TEL': 'Thomson-East Coast Line',
    };
    return lines[code] || code;
  }

  private formatLoadStatus(load: string): string {
    const loads: Record<string, string> = {
      'SEA': 'Seats Available',
      'SDA': 'Standing Available',
      'LSD': 'Limited Standing',
    };
    return loads[load] || load || 'Unknown';
  }

  private formatBusType(busType: string): string {
    const types: Record<string, string> = {
      'SD': 'Single Deck',
      'DD': 'Double Deck',
      'BD': 'Bendy Bus',
    };
    return types[busType] || busType || 'Unknown';
  }

  private calculateMinutesAway(arrivalTime: string): number {
    const arrival = new Date(arrivalTime);
    const now = new Date();
    return Math.max(0, Math.floor((arrival.getTime() - now.getTime()) / 60000));
  }
}
