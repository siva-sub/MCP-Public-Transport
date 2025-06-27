import axios, { AxiosInstance } from 'axios';
import { CacheService } from './cache.js';
import { logger } from '../utils/logger.js';
import { APIError } from '../utils/errors.js';

export interface WeatherStation {
  id: string;
  deviceId: string;
  name: string;
  labelLocation?: {  // Optional - used by most APIs
    latitude: number;
    longitude: number;
  };
  location?: {       // Optional - used by Wind Speed API
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
      // Get all weather data with individual error handling
      const weatherData = await this.getAllWeatherData();
      
      // Process each type with fallbacks
      const conditions = this.processWeatherData(weatherData, latitude, longitude);
      
      return conditions;
    } catch (error) {
      logger.error('Failed to get weather conditions', error);
      return this.getDefaultWeatherConditions(latitude, longitude);
    }
  }

  private async getAllWeatherData() {
    const results = await Promise.allSettled([
      this.getRainfall(),
      this.getAirTemperature(),
      this.getRelativeHumidity(),
      this.getWindSpeed(),
      this.getWindDirection(),
    ]);

    return {
      rainfall: results[0].status === 'fulfilled' ? results[0].value : null,
      temperature: results[1].status === 'fulfilled' ? results[1].value : null,
      humidity: results[2].status === 'fulfilled' ? results[2].value : null,
      windSpeed: results[3].status === 'fulfilled' ? results[3].value : null,
      windDirection: results[4].status === 'fulfilled' ? results[4].value : null,
    };
  }

  private processWeatherData(
    weatherData: any,
    latitude: number,
    longitude: number
  ): WeatherConditions {
    let rainfallValue = 0;
    let tempValue = 30;
    let humidityValue = 70;
    let windSpeedValue = 5;
    let windDirValue = 0;

    // Process rainfall data
    if (weatherData.rainfall) {
      try {
        const nearestStation = this.findNearestStation(latitude, longitude, weatherData.rainfall.stations);
        rainfallValue = this.getLatestReading(weatherData.rainfall, nearestStation.id) || 0;
      } catch (error) {
        logger.warn('Failed to process rainfall data', error);
      }
    }

    // Process temperature data
    if (weatherData.temperature) {
      try {
        const nearestStation = this.findNearestStation(latitude, longitude, weatherData.temperature.stations);
        tempValue = this.getLatestReading(weatherData.temperature, nearestStation.id) || 30;
      } catch (error) {
        logger.warn('Failed to process temperature data', error);
      }
    }

    // Process humidity data
    if (weatherData.humidity) {
      try {
        const nearestStation = this.findNearestStation(latitude, longitude, weatherData.humidity.stations);
        humidityValue = this.getLatestReading(weatherData.humidity, nearestStation.id) || 70;
      } catch (error) {
        logger.warn('Failed to process humidity data', error);
      }
    }

    // Process wind speed data
    if (weatherData.windSpeed) {
      try {
        const nearestStation = this.findNearestStation(latitude, longitude, weatherData.windSpeed.stations);
        windSpeedValue = this.getLatestReading(weatherData.windSpeed, nearestStation.id) || 5;
      } catch (error) {
        logger.warn('Failed to process wind speed data', error);
      }
    }

    // Process wind direction data
    if (weatherData.windDirection) {
      try {
        const nearestStation = this.findNearestStation(latitude, longitude, weatherData.windDirection.stations);
        windDirValue = this.getLatestReading(weatherData.windDirection, nearestStation.id) || 0;
      } catch (error) {
        logger.warn('Failed to process wind direction data', error);
      }
    }

    return {
      temperature: tempValue,
      rainfall: rainfallValue,
      humidity: humidityValue,
      windSpeed: windSpeedValue,
      windDirection: windDirValue,
      location: { latitude, longitude },
      timestamp: new Date().toISOString(),
    };
  }

  private getDefaultWeatherConditions(latitude: number, longitude: number): WeatherConditions {
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

  private getStationCoordinates(station: WeatherStation): { latitude: number; longitude: number } {
    // Handle both labelLocation (most APIs) and location (Wind Speed API)
    const coords = station.labelLocation || station.location;
    if (!coords || typeof coords.latitude !== 'number' || typeof coords.longitude !== 'number') {
      throw new Error(`Invalid station coordinates for station ${station.id}`);
    }
    return coords;
  }

  private findNearestStation(
    latitude: number,
    longitude: number,
    stations: WeatherStation[]
  ): WeatherStation {
    // Validate input
    if (!stations || stations.length === 0) {
      throw new Error('No weather stations available');
    }

    let nearestStation = stations[0];
    let minDistance = Infinity;

    for (const station of stations) {
      try {
        const stationCoords = this.getStationCoordinates(station);
        const distance = this.calculateDistance(
          latitude,
          longitude,
          stationCoords.latitude,
          stationCoords.longitude
        );

        if (distance < minDistance) {
          minDistance = distance;
          nearestStation = station;
        }
      } catch (error) {
        logger.warn(`Skipping invalid station ${station.id}:`, error);
        continue;
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
