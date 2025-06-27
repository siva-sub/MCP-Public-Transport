/**
 * Enhanced LTA Service with comprehensive API integration
 * Dynamically integrates all LTA DataMall APIs for intelligent transport planning
 */

import { LTAService } from './lta.js';
import { CacheService } from './cache.js';
import { logger } from '../utils/logger.js';
import { TaxiAvailability } from '../types/transport.js';

export interface TrafficIncident {
  type: string;
  latitude: number;
  longitude: number;
  message: string;
  severity?: 'low' | 'medium' | 'high';
  affectedRoutes?: string[];
}

export interface EstimatedTravelTime {
  name: string;
  direction: number;
  farEndPoint: string;
  startPoint: string;
  endPoint: string;
  estimatedTime: number;
}

export interface BusArrivalInfo {
  busStopCode: string;
  services: Array<{
    serviceNo: string;
    operator: string;
    nextBus: {
      estimatedArrival: string;
      load: 'SEA' | 'SDA' | 'LSD';
      feature: string;
      type: 'SD' | 'DD' | 'BD';
      latitude?: string;
      longitude?: string;
    };
    nextBus2?: any;
    nextBus3?: any;
  }>;
}

export interface PassengerVolume {
  originBusStop?: string;
  destinationBusStop?: string;
  originTrainStation?: string;
  destinationTrainStation?: string;
  totalTrips: number;
  timeOfDay: string;
  dayType: 'weekday' | 'weekend';
}

export interface TrafficFlow {
  roadName: string;
  speedBand: number;
  minimumSpeed: number;
  maximumSpeed: number;
  location: {
    latitude: number;
    longitude: number;
  };
}

export interface FacilityMaintenance {
  stationCode: string;
  stationName: string;
  affectedFacilities: string[];
  startDate: string;
  endDate: string;
  description: string;
}

export interface FaultyTrafficLight {
  latitude: number;
  longitude: number;
  message: string;
}

export interface RoadWork {
  eventID: string;
  startDate: string;
  endDate: string;
  serviceDept: string;
  roadName: string;
  other: string;
}

export interface VMSSign {
  equipmentID: string;
  latitude: number;
  longitude: number;
  message: string;
}

export interface TaxiStand {
  taxiCode: string;
  latitude: number;
  longitude: number;
  bfa: string; // Barrier-Free Access
  ownership: string;
  type: string;
  name: string;
}

export interface RouteIntelligence {
  trafficConditions: TrafficIncident[];
  estimatedTravelTimes: EstimatedTravelTime[];
  busLoadFactors: Map<string, 'low' | 'medium' | 'high'>;
  facilityDisruptions: FacilityMaintenance[];
  passengerVolumeInsights: PassengerVolume[];
  taxiAvailability: TaxiAvailability[];
  faultyTrafficLights: FaultyTrafficLight[];
  roadWorks: RoadWork[];
  vmsSigns: VMSSign[];
  taxiStands: TaxiStand[];
  routeRecommendations: string[];
}

export class LTAEnhancedService extends LTAService {
  private readonly CACHE_DURATION = {
    TRAFFIC_INCIDENTS: 300, // 5 minutes
    TRAVEL_TIMES: 300, // 5 minutes
    BUS_ARRIVALS: 60, // 1 minute
    PASSENGER_VOLUME: 3600, // 1 hour
    TRAFFIC_FLOW: 300, // 5 minutes
    FACILITY_MAINTENANCE: 1800, // 30 minutes
    TAXI_AVAILABILITY: 300, // 5 minutes
  };

  constructor(
    apiKey: string,
    private cacheService: CacheService,
    requestTimeout: number = 10000
  ) {
    super(apiKey, cacheService, requestTimeout);
  }

  /**
   * Make a request to LTA API (protected method access)
   */
  protected async makeRequest(endpoint: string, params?: any): Promise<any> {
    return this.client.get(endpoint, { params });
  }

  /**
   * Get comprehensive route intelligence for journey planning
   */
  async getRouteIntelligence(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number,
    radius: number = 2000
  ): Promise<RouteIntelligence> {
    try {
      const [
        trafficIncidents,
        estimatedTravelTimes,
        busArrivals,
        facilityDisruptions,
        passengerVolume,
        taxiAvailability,
        faultyTrafficLights,
        roadWorks,
        vmsSigns,
        taxiStands
      ] = await Promise.allSettled([
        this.getTrafficIncidentsInArea(startLat, startLng, endLat, endLng, radius),
        this.getEstimatedTravelTimes(),
        this.getBusArrivalsInArea(startLat, startLng, radius),
        this.getFacilityMaintenance(),
        this.getPassengerVolumeInsights(),
        this.getTaxiAvailabilityInArea(startLat, startLng, endLat, endLng),
        this.getFaultyTrafficLights(),
        this.getRoadWorks(),
        this.getVMSSigns(),
        this.getTaxiStands()
      ]);

      const intelligence: RouteIntelligence = {
        trafficConditions: trafficIncidents.status === 'fulfilled' ? trafficIncidents.value : [],
        estimatedTravelTimes: estimatedTravelTimes.status === 'fulfilled' ? estimatedTravelTimes.value : [],
        busLoadFactors: new Map(),
        facilityDisruptions: facilityDisruptions.status === 'fulfilled' ? facilityDisruptions.value : [],
        passengerVolumeInsights: passengerVolume.status === 'fulfilled' ? passengerVolume.value : [],
        taxiAvailability: taxiAvailability.status === 'fulfilled' ? taxiAvailability.value : [],
        faultyTrafficLights: faultyTrafficLights.status === 'fulfilled' ? faultyTrafficLights.value : [],
        roadWorks: roadWorks.status === 'fulfilled' ? roadWorks.value : [],
        vmsSigns: vmsSigns.status === 'fulfilled' ? vmsSigns.value : [],
        taxiStands: taxiStands.status === 'fulfilled' ? taxiStands.value : [],
        routeRecommendations: []
      };

      // Generate intelligent recommendations
      intelligence.routeRecommendations = this.generateRouteRecommendations(intelligence);

      return intelligence;
    } catch (error) {
      logger.error('Failed to get route intelligence', error);
      throw error;
    }
  }

  /**
   * Get traffic incidents in a specific area
   */
  async getTrafficIncidentsInArea(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number,
    radius: number
  ): Promise<TrafficIncident[]> {
    const cacheKey = `traffic_incidents_${startLat}_${startLng}_${endLat}_${endLng}_${radius}`;
    
    const incidentsFromCache = this.cacheService.get<TrafficIncident[]>(cacheKey);
    if (incidentsFromCache) {
      return incidentsFromCache;
    }

    try {
      const response = await this.makeRequest('/TrafficIncidents');
      const fetchedIncidents = (response.value || [])
        .filter((incident: any) => this.isWithinArea(
          incident.Latitude,
          incident.Longitude,
          startLat,
          startLng,
          endLat,
          endLng,
          radius
        ))
        .map((incident: any) => ({
          type: incident.Type,
          latitude: incident.Latitude,
          longitude: incident.Longitude,
          message: incident.Message,
          severity: this.assessIncidentSeverity(incident.Message),
          affectedRoutes: this.extractAffectedRoutes(incident.Message)
        }));

      this.cacheService.set(cacheKey, fetchedIncidents, this.CACHE_DURATION.TRAFFIC_INCIDENTS);
      return fetchedIncidents;
    } catch (error) {
      logger.error('Failed to get traffic incidents', error);
      return [];
    }
  }

  /**
   * Get estimated travel times for expressways
   */
  async getEstimatedTravelTimes(): Promise<EstimatedTravelTime[]> {
    const cacheKey = 'estimated_travel_times';
    
    const travelTimesFromCache = this.cacheService.get<EstimatedTravelTime[]>(cacheKey);
    if (travelTimesFromCache) {
      return travelTimesFromCache;
    }

    try {
      const response = await this.makeRequest('/EstTravelTimes');
      const fetchedTravelTimes = (response.value || []).map((time: any) => ({
        name: time.Name,
        direction: time.Direction,
        farEndPoint: time.FarEndPoint,
        startPoint: time.StartPoint,
        endPoint: time.EndPoint,
        estimatedTime: time.EstTime
      }));

      this.cacheService.set(cacheKey, fetchedTravelTimes, this.CACHE_DURATION.TRAVEL_TIMES);
      return fetchedTravelTimes;
    } catch (error) {
      logger.error('Failed to get estimated travel times', error);
      return [];
    }
  }

  /**
   * Get bus arrivals in a specific area
   */
  async getBusArrivalsInArea(
    lat: number,
    lng: number,
    radius: number
  ): Promise<BusArrivalInfo[]> {
    try {
      // Get bus stops in the area first
      const busStops = await this.getAllBusStops();
      const nearbyStops = busStops.filter(stop => 
        this.calculateDistance(lat, lng, stop.latitude, stop.longitude) <= radius
      );

      // Get arrivals for nearby stops (limit to prevent API overload)
      const arrivalPromises = nearbyStops.slice(0, 10).map(stop => 
        this.getBusArrival(stop.busStopCode).catch(e => {
          logger.warn(`Failed to get bus arrival for ${stop.busStopCode}: ${e.message}`);
          return null;
        })
      );

      const fetchedArrivals = await Promise.all(arrivalPromises);
      return fetchedArrivals.filter(arrival => arrival !== null).map((busServices: any, index: number) => {
        const busStopCode = nearbyStops[index]?.busStopCode || 'N/A';
        return {
          busStopCode: busStopCode,
          services: busServices
        };
      }) as BusArrivalInfo[];
    } catch (error) {
      logger.error('Failed to get bus arrivals in area', error);
      return [];
    }
  }

  /**
   * Get facility maintenance information
   */
  async getFacilityMaintenance(): Promise<FacilityMaintenance[]> {
    const cacheKey = 'facility_maintenance';
    
    const maintenanceFromCache = this.cacheService.get<FacilityMaintenance[]>(cacheKey);
    if (maintenanceFromCache) {
      return maintenanceFromCache;
    }

    try {
      const response = await this.makeRequest('/FacilitiesMaintenance');
      const fetchedMaintenance = (response.value || []).map((facility: any) => ({
        stationCode: facility.StationCode,
        stationName: facility.StationName,
        affectedFacilities: facility.AffectedFacilities?.split(',') || [],
        startDate: facility.StartDate,
        endDate: facility.EndDate,
        description: facility.Description
      }));

      this.cacheService.set(cacheKey, fetchedMaintenance, this.CACHE_DURATION.FACILITY_MAINTENANCE);
      return fetchedMaintenance;
    } catch (error) {
      logger.error('Failed to get facility maintenance', error);
      return [];
    }
  }

  /**
   * Get passenger volume insights
   */
  async getPassengerVolumeInsights(): Promise<PassengerVolume[]> {
    const cacheKey = 'passenger_volume_insights';
    
    let insights = this.cacheService.get<PassengerVolume[]>(cacheKey);
    if (insights) {
      return insights;
    }

    try {
      // This would typically fetch from historical data APIs
      // For now, return mock insights based on common patterns
      const generatedInsights = this.generatePassengerVolumeInsights();
      
      this.cacheService.set(cacheKey, generatedInsights, this.CACHE_DURATION.PASSENGER_VOLUME);
      return generatedInsights;
    } catch (error) {
      logger.error('Failed to get passenger volume insights', error);
      return [];
    }
  }

  /**
   * Get taxi availability in area
   */
  async getTaxiAvailabilityInArea(
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number
  ): Promise<TaxiAvailability[]> {
    const cacheKey = `taxi_availability_${startLat}_${startLng}_${endLat}_${endLng}`;
    
    const availabilityFromCache = this.cacheService.get<TaxiAvailability[]>(cacheKey);
    if (availabilityFromCache) {
      return availabilityFromCache;
    }

    try {
      const response = await this.makeRequest('/TaxiAvailability');
      const fetchedAvailability = (response.value || []).map((taxi: any) => ({
        timestamp: taxi.Timestamp,
        taxiCount: taxi.NoOfTaxis,
        coordinates: [taxi.Latitude, taxi.Longitude] as [number, number]
      }));

      this.cacheService.set(cacheKey, fetchedAvailability, this.CACHE_DURATION.TAXI_AVAILABILITY);
      return fetchedAvailability;
    } catch (error) {
      logger.error('Failed to get taxi availability', error);
      return [];
    }
  }

  /**
   * Get faulty traffic lights information
   */
  async getFaultyTrafficLights(): Promise<FaultyTrafficLight[]> {
    const cacheKey = 'faulty_traffic_lights';
    const lightsFromCache = this.cacheService.get<FaultyTrafficLight[]>(cacheKey);
    if (lightsFromCache) {
      return lightsFromCache;
    }
    try {
      const response = await this.makeRequest('/FaultyTrafficLights');
      const fetchedLights = (response.value || []).map((light: any) => ({
        latitude: light.Latitude,
        longitude: light.Longitude,
        message: light.Message,
      }));
      this.cacheService.set(cacheKey, fetchedLights, this.CACHE_DURATION.TRAFFIC_INCIDENTS);
      return fetchedLights;
    } catch (error) {
      logger.error('Failed to get faulty traffic lights', error);
      return [];
    }
  }

  /**
   * Get road works information
   */
  async getRoadWorks(): Promise<RoadWork[]> {
    const cacheKey = 'road_works';
    const worksFromCache = this.cacheService.get<RoadWork[]>(cacheKey);
    if (worksFromCache) {
      return worksFromCache;
    }
    try {
      const response = await this.makeRequest('/RoadWorks');
      const fetchedWorks = (response.value || []).map((work: any) => ({
        eventID: work.EventID,
        startDate: work.StartDate,
        endDate: work.EndDate,
        serviceDept: work.SvcDept,
        roadName: work.RoadName,
        other: work.Other,
      }));
      this.cacheService.set(cacheKey, fetchedWorks, this.CACHE_DURATION.TRAFFIC_INCIDENTS);
      return fetchedWorks;
    } catch (error) {
      logger.error('Failed to get road works', error);
      return [];
    }
  }

  /**
   * Get VMS (Variable Message Signs) information
   */
  async getVMSSigns(): Promise<VMSSign[]> {
    const cacheKey = 'vms_signs';
    const signsFromCache = this.cacheService.get<VMSSign[]>(cacheKey);
    if (signsFromCache) {
      return signsFromCache;
    }
    try {
      const response = await this.makeRequest('/VMS');
      const fetchedSigns = (response.value || []).map((sign: any) => ({
        equipmentID: sign.EquipmentID,
        latitude: sign.Latitude,
        longitude: sign.Longitude,
        message: sign.Message,
      }));
      this.cacheService.set(cacheKey, fetchedSigns, this.CACHE_DURATION.TRAFFIC_INCIDENTS);
      return fetchedSigns;
    } catch (error) {
      logger.error('Failed to get VMS signs', error);
      return [];
    }
  }

  /**
   * Get Taxi Stands information
   */
  async getTaxiStands(): Promise<TaxiStand[]> {
    const cacheKey = 'taxi_stands';
    const standsFromCache = this.cacheService.get<TaxiStand[]>(cacheKey);
    if (standsFromCache) {
      return standsFromCache;
    }
    try {
      const response = await this.makeRequest('/TaxiStands');
      const fetchedStands = (response.value || []).map((stand: any) => ({
        taxiCode: stand.TaxiCode,
        latitude: stand.Latitude,
        longitude: stand.Longitude,
        bfa: stand.Bfa,
        ownership: stand.Ownership,
        type: stand.Type,
        name: stand.Name,
      }));
      this.cacheService.set(cacheKey, fetchedStands, this.CACHE_DURATION.TRAFFIC_INCIDENTS);
      return fetchedStands;
    } catch (error) {
      logger.error('Failed to get taxi stands', error);
      return [];
    }
  }

  /**
   * Generate intelligent route recommendations
   */
  private generateRouteRecommendations(intelligence: RouteIntelligence): string[] {
    const recommendations: string[] = [];

    // Traffic-based recommendations
    if (intelligence.trafficConditions.length > 0) {
      const highSeverityIncidents = intelligence.trafficConditions.filter(i => i.severity === 'high');
      if (highSeverityIncidents.length > 0) {
        recommendations.push('Consider alternative routes due to major traffic incidents');
      }
    }

    // Travel time recommendations
    const slowRoutes = intelligence.estimatedTravelTimes.filter(t => t.estimatedTime > 10);
    if (slowRoutes.length > 0) {
      recommendations.push('Some expressway segments experiencing delays - consider public transport');
    }

    // Facility disruption recommendations
    if (intelligence.facilityDisruptions.length > 0) {
      recommendations.push('Some MRT facilities under maintenance - check alternative stations');
    }

    // Passenger volume recommendations
    const currentHour = new Date().getHours();
    if (currentHour >= 7 && currentHour <= 9) {
      recommendations.push('Peak hour - expect crowded public transport, consider earlier/later travel');
    }

    // Taxi availability recommendations
    const totalTaxis = intelligence.taxiAvailability.reduce((sum, t) => sum + t.taxiCount, 0);
    if (totalTaxis < 50) {
      recommendations.push('Low taxi availability - consider booking in advance or using public transport');
    }

    return recommendations;
  }

  /**
   * Assess incident severity based on message content
   */
  private assessIncidentSeverity(message: string): 'low' | 'medium' | 'high' {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('accident') || lowerMessage.includes('breakdown') || lowerMessage.includes('closure')) {
      return 'high';
    }
    if (lowerMessage.includes('slow') || lowerMessage.includes('heavy') || lowerMessage.includes('congestion')) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Extract affected routes from incident message
   */
  private extractAffectedRoutes(message: string): string[] {
    const routes: string[] = [];
    const routePatterns = [
      /\b(AYE|PIE|CTE|ECP|KJE|SLE|TPE|BKE|MCE)\b/gi,
      /\b(\d+[A-Z]*)\b/g // Bus route numbers
    ];

    routePatterns.forEach(pattern => {
      const matches = message.match(pattern);
      if (matches) {
        routes.push(...matches);
      }
    });

    return [...new Set(routes)]; // Remove duplicates
  }

  /**
   * Check if coordinates are within specified area
   */
  private isWithinArea(
    lat: number,
    lng: number,
    startLat: number,
    startLng: number,
    endLat: number,
    endLng: number,
    radius: number
  ): boolean {
    const centerLat = (startLat + endLat) / 2;
    const centerLng = (startLng + endLng) / 2;
    const distance = this.calculateDistance(lat, lng, centerLat, centerLng);
    return distance <= radius;
  }

  /**
   * Calculate distance between two coordinates
   */
  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // Earth's radius in meters
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

  /**
   * Generate passenger volume insights based on common patterns
   */
  private generatePassengerVolumeInsights(): PassengerVolume[] {
    const currentHour = new Date().getHours();
    const isWeekend = [0, 6].includes(new Date().getDay());
    
    // Mock insights based on typical Singapore transport patterns
    return [
      {
        originBusStop: 'CBD Area',
        destinationBusStop: 'Residential Areas',
        totalTrips: currentHour >= 17 && currentHour <= 19 ? 5000 : 2000,
        timeOfDay: currentHour >= 17 && currentHour <= 19 ? 'evening_peak' : 'off_peak',
        dayType: isWeekend ? 'weekend' : 'weekday'
      },
      {
        originTrainStation: 'Jurong East',
        destinationTrainStation: 'City Hall',
        totalTrips: currentHour >= 7 && currentHour <= 9 ? 8000 : 3000,
        timeOfDay: currentHour >= 7 && currentHour <= 9 ? 'morning_peak' : 'off_peak',
        dayType: isWeekend ? 'weekend' : 'weekday'
      }
    ];
  }
}
