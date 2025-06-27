import axios, { AxiosInstance } from 'axios';
import { CacheService } from './cache.js';
import { logger } from '../utils/logger.js';
import { APIError } from '../utils/errors.js';

export interface WeatherStation {
  id: string;
  deviceId: string;
  name: string;
  labelLocation: {
    latitude: number;
    longitude: number;
  };
}

export interface WeatherReading {
  timestamp: string;
  data: Array<{
    stationId: string;
    value: number;
  }>;
}

export interface WeatherData {
  stations: WeatherStation[];
  readings: WeatherReading[];
  readingType: string;
  readingUnit: string;
}

export interface WeatherConditions {
  temperature: number;
  rainfall: number;
  humidity: number;
  windSpeed: number;
  windDirection: number;
  location: {
    latitude: number;
    longitude: number;
  };
  timestamp: string;
}

export interface WeatherAdvisory {
  severity: 'low' | 'medium' | 'high';
  type: 'rain' | 'heat' | 'wind' | 'humidity';
  message: string;
  routingImpact: {
    walkingTimeMultiplier: number;
    preferredModes: string[];
    avoidedAreas: string[];
  };
}

export class WeatherService {
  private client: AxiosInstance;
  private readonly baseUrl = 'https://api-open.data.gov.sg/v2/real-time/api';

  constructor(
    private cache: CacheService,
    private timeout: number = 10000
  ) {
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: {
        'Accept': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    this.client.interceptors.request.use(
      (config) => {
        logger.debug(`Weather API Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => Promise.reject(error)
    );

    this.client.interceptors.response.use(
      (response) => {
        logger.debug(`Weather API Response: ${response.status} ${response.config.url}`);
        return response;
      },
      (error) => {
        logger.error('Weather API error', {
          status: error.response?.status,
          message: error.response?.data?.errorMsg || error.message,
        });
        throw new APIError(
          `Weather API error: ${error.response?.data?.errorMsg || error.message}`,
          'WEATHER_API_ERROR',
          error.response?.status || 500
        );
      }
    );
  }

  async getRainfall(date?: string): Promise<WeatherData> {
    const cacheKey = `weather_rainfall_${date || 'latest'}`;
    
    return this.cache.getOrSet(cacheKey, async () => {
      const params: any = {};
      if (date) params.date = date;

      const response = await this.client.get('/rainfall', { params });
      return response.data.data;
    }, 300); // 5 minute cache for weather data
  }

  async getAirTemperature(date?: string): Promise<WeatherData> {
    const cacheKey = `weather_temperature_${date || 'latest'}`;
    
    return this.cache.getOrSet(cacheKey, async () => {
      const params: any = {};
      if (date) params.date = date;

      const response = await this.client.get('/air-temperature', { params });
      return response.data.data;
    }, 300);
  }

  async getRelativeHumidity(date?: string): Promise<WeatherData> {
    const cacheKey = `weather_humidity_${date || 'latest'}`;
    
    return this.cache.getOrSet(cacheKey, async () => {
      const params: any = {};
      if (date) params.date = date;

      const response = await this.client.get('/relative-humidity', { params });
      return response.data.data;
    }, 300);
  }

  async getWindSpeed(date?: string): Promise<WeatherData> {
    const cacheKey = `weather_wind_speed_${date || 'latest'}`;
    
    return this.cache.getOrSet(cacheKey, async () => {
      const params: any = {};
      if (date) params.date = date;

      const response = await this.client.get('/wind-speed', { params });
      return response.data.data;
    }, 300);
  }

  async getWindDirection(date?: string): Promise<WeatherData> {
    const cacheKey = `weather_wind_direction_${date || 'latest'}`;
    
    return this.cache.getOrSet(cacheKey, async () => {
      const params: any = {};
      if (date) params.date = date;

      const response = await this.client.get('/wind-direction', { params });
      return response.data.data;
    }, 300);
  }

  async getWeatherConditionsForLocation(
    latitude: number,
    longitude: number
  ): Promise<WeatherConditions> {
    try {
      // Get all weather data in parallel
      const [rainfall, temperature, humidity, windSpeed, windDirection] = await Promise.all([
        this.getRainfall(),
        this.getAirTemperature(),
        this.getRelativeHumidity(),
        this.getWindSpeed(),
        this.getWindDirection(),
      ]);

      // Find nearest weather station for each parameter
      const nearestRainfallStation = this.findNearestStation(latitude, longitude, rainfall.stations);
      const nearestTempStation = this.findNearestStation(latitude, longitude, temperature.stations);
      const nearestHumidityStation = this.findNearestStation(latitude, longitude, humidity.stations);
      const nearestWindSpeedStation = this.findNearestStation(latitude, longitude, windSpeed.stations);
      const nearestWindDirStation = this.findNearestStation(latitude, longitude, windDirection.stations);

      // Get latest readings for each parameter
      const rainfallValue = this.getLatestReading(rainfall, nearestRainfallStation.id);
      const tempValue = this.getLatestReading(temperature, nearestTempStation.id);
      const humidityValue = this.getLatestReading(humidity, nearestHumidityStation.id);
      const windSpeedValue = this.getLatestReading(windSpeed, nearestWindSpeedStation.id);
      const windDirValue = this.getLatestReading(windDirection, nearestWindDirStation.id);

      return {
        temperature: tempValue || 30, // Default to 30°C if no data
        rainfall: rainfallValue || 0,
        humidity: humidityValue || 70,
        windSpeed: windSpeedValue || 5,
        windDirection: windDirValue || 0,
        location: { latitude, longitude },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('Failed to get weather conditions', error);
      // Return default conditions if weather API fails
      return {
        temperature: 30,
        rainfall: 0,
        humidity: 70,
        windSpeed: 5,
        windDirection: 0,
        location: { latitude, longitude },
        timestamp: new Date().toISOString(),
      };
    }
  }

  generateWeatherAdvisory(conditions: WeatherConditions): WeatherAdvisory[] {
    const advisories: WeatherAdvisory[] = [];

    // Heavy rain advisory
    if (conditions.rainfall > 10) {
      advisories.push({
        severity: 'high',
        type: 'rain',
        message: `Heavy rain detected (${conditions.rainfall}mm). Allow extra time for walking and prefer covered routes.`,
        routingImpact: {
          walkingTimeMultiplier: 1.5,
          preferredModes: ['MRT', 'Covered Bus Stops'],
          avoidedAreas: ['Open walkways', 'Uncovered bus stops'],
        },
      });
    } else if (conditions.rainfall > 2.5) {
      advisories.push({
        severity: 'medium',
        type: 'rain',
        message: `Light to moderate rain (${conditions.rainfall}mm). Consider covered walkways.`,
        routingImpact: {
          walkingTimeMultiplier: 1.2,
          preferredModes: ['MRT'],
          avoidedAreas: [],
        },
      });
    }

    // High temperature advisory
    if (conditions.temperature > 32) {
      advisories.push({
        severity: 'high',
        type: 'heat',
        message: `Very hot weather (${conditions.temperature}°C). Minimize walking time and stay hydrated.`,
        routingImpact: {
          walkingTimeMultiplier: 1.3,
          preferredModes: ['Air-conditioned transport'],
          avoidedAreas: ['Long outdoor walks'],
        },
      });
    } else if (conditions.temperature > 30) {
      advisories.push({
        severity: 'medium',
        type: 'heat',
        message: `Hot weather (${conditions.temperature}°C). Consider air-conditioned transport.`,
        routingImpact: {
          walkingTimeMultiplier: 1.1,
          preferredModes: ['MRT', 'Air-conditioned buses'],
          avoidedAreas: [],
        },
      });
    }

    // High humidity advisory
    if (conditions.humidity > 85) {
      advisories.push({
        severity: 'medium',
        type: 'humidity',
        message: `Very humid conditions (${conditions.humidity}%). Consider shorter walking segments.`,
        routingImpact: {
          walkingTimeMultiplier: 1.1,
          preferredModes: ['Air-conditioned transport'],
          avoidedAreas: [],
        },
      });
    }

    // Strong wind advisory
    if (conditions.windSpeed > 20) {
      advisories.push({
        severity: 'medium',
        type: 'wind',
        message: `Strong winds (${conditions.windSpeed} km/h). Be cautious near tall buildings.`,
        routingImpact: {
          walkingTimeMultiplier: 1.1,
          preferredModes: ['Underground passages'],
          avoidedAreas: ['Open areas', 'High-rise corridors'],
        },
      });
    }

    return advisories;
  }

  private findNearestStation(
    latitude: number,
    longitude: number,
    stations: WeatherStation[]
  ): WeatherStation {
    let nearestStation = stations[0];
    let minDistance = this.calculateDistance(
      latitude,
      longitude,
      stations[0].labelLocation.latitude,
      stations[0].labelLocation.longitude
    );

    for (const station of stations.slice(1)) {
      const distance = this.calculateDistance(
        latitude,
        longitude,
        station.labelLocation.latitude,
        station.labelLocation.longitude
      );

      if (distance < minDistance) {
        minDistance = distance;
        nearestStation = station;
      }
    }

    return nearestStation;
  }

  private getLatestReading(weatherData: WeatherData, stationId: string): number | null {
    if (weatherData.readings.length === 0) return null;

    const latestReading = weatherData.readings[weatherData.readings.length - 1];
    const stationData = latestReading.data.find(d => d.stationId === stationId);
    
    return stationData?.value || null;
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
}
