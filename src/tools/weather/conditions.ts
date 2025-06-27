import { z } from 'zod';
import { BaseTool, ToolDefinition } from '../base.js';
import { WeatherService, WeatherConditions, WeatherAdvisory } from '../../services/weather.js';
import { logger } from '../../utils/logger.js';

const WeatherInputSchema = z.object({
  location: z.object({
    latitude: z.number().min(1.0).max(1.5),
    longitude: z.number().min(103.0).max(104.5),
    name: z.string().optional(),
  }).optional(),
  includeAdvisories: z.boolean().default(true),
  includeForecast: z.boolean().default(false),
  includeHistorical: z.boolean().default(false),
  timeRange: z.enum(['current', 'hourly', 'daily']).default('current'),
});

export interface WeatherResponse {
  location: {
    latitude: number;
    longitude: number;
    name?: string;
    nearestStation?: string;
  };
  current: {
    conditions: WeatherConditions;
    summary: string;
    comfort: {
      level: 'comfortable' | 'warm' | 'hot' | 'humid' | 'uncomfortable';
      description: string;
    };
  };
  advisories: WeatherAdvisory[];
  travelImpact: {
    walkingConditions: 'excellent' | 'good' | 'fair' | 'poor' | 'avoid';
    recommendedActions: string[];
    timeAdjustments: {
      walkingTimeMultiplier: number;
      waitingTimeRecommendation: string;
    };
  };
  timestamp: string;
}

export class WeatherConditionsTool extends BaseTool {
  constructor(
    private weatherService: WeatherService
  ) {
    super();
  }

  getDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'get_weather_conditions',
        description: 'Get comprehensive real-time weather conditions for Singapore with travel impact analysis and advisories.',
        inputSchema: this.createSchema({
          location: {
            type: 'object',
            description: 'Location coordinates (defaults to Singapore center if not provided)',
            properties: {
              latitude: {
                type: 'number',
                minimum: 1.0,
                maximum: 1.5,
                description: 'Latitude coordinate within Singapore bounds',
              },
              longitude: {
                type: 'number',
                minimum: 103.0,
                maximum: 104.5,
                description: 'Longitude coordinate within Singapore bounds',
              },
              name: {
                type: 'string',
                description: 'Location name for reference',
              },
            },
          },
          includeAdvisories: {
            type: 'boolean',
            default: true,
            description: 'Include weather advisories and travel recommendations',
          },
          includeForecast: {
            type: 'boolean',
            default: false,
            description: 'Include short-term forecast (next few hours)',
          },
          includeHistorical: {
            type: 'boolean',
            default: false,
            description: 'Include recent weather trends',
          },
          timeRange: {
            type: 'string',
            enum: ['current', 'hourly', 'daily'],
            default: 'current',
            description: 'Time range for weather data',
          },
        }),
      },
      {
        name: 'get_weather_advisory',
        description: 'Get weather-based travel and activity advisories for Singapore with specific recommendations.',
        inputSchema: this.createSchema({
          location: {
            type: 'object',
            description: 'Location coordinates (defaults to Singapore center if not provided)',
            properties: {
              latitude: {
                type: 'number',
                minimum: 1.0,
                maximum: 1.5,
                description: 'Latitude coordinate within Singapore bounds',
              },
              longitude: {
                type: 'number',
                minimum: 103.0,
                maximum: 104.5,
                description: 'Longitude coordinate within Singapore bounds',
              },
              name: {
                type: 'string',
                description: 'Location name for reference',
              },
            },
          },
          activityType: {
            type: 'string',
            enum: ['walking', 'cycling', 'outdoor_dining', 'sports', 'photography', 'general'],
            default: 'general',
            description: 'Type of activity for specific recommendations',
          },
        }),
      },
    ];
  }

  canHandle(toolName: string): boolean {
    return ['get_weather_conditions', 'get_weather_advisory'].includes(toolName);
  }

  async execute(toolName: string, args: unknown): Promise<any> {
    try {
      switch (toolName) {
        case 'get_weather_conditions':
          return await this.getWeatherConditions(args);
        case 'get_weather_advisory':
          return await this.getWeatherAdvisory(args);
        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }
    } catch (error) {
      logger.error(`Weather tool failed: ${toolName}`, error);
      return this.formatError(error as Error, toolName);
    }
  }

  private async getWeatherConditions(args: unknown): Promise<WeatherResponse> {
    const {
      location = { latitude: 1.3521, longitude: 103.8198, name: 'Singapore' }, // Default to Singapore center
      includeAdvisories,
      includeForecast,
      includeHistorical,
      timeRange,
    } = WeatherInputSchema.parse(args);

    logger.info('Getting weather conditions', {
      location: location.name || `${location.latitude},${location.longitude}`,
      timeRange,
    });

    // Get current weather conditions
    const conditions = await this.weatherService.getWeatherConditionsForLocation(
      location.latitude,
      location.longitude
    );

    // Generate advisories
    const advisories = includeAdvisories 
      ? this.weatherService.generateWeatherAdvisory(conditions)
      : [];

    // Analyze comfort level
    const comfort = this.analyzeComfortLevel(conditions);

    // Assess travel impact
    const travelImpact = this.assessTravelImpact(conditions, advisories);

    // Generate weather summary
    const summary = this.generateWeatherSummary(conditions);

    return {
      location: {
        latitude: location.latitude,
        longitude: location.longitude,
        name: location.name,
        nearestStation: 'Singapore Weather Station', // Would be determined from actual data
      },
      current: {
        conditions,
        summary,
        comfort,
      },
      advisories,
      travelImpact,
      timestamp: new Date().toISOString(),
    };
  }

  private async getWeatherAdvisory(args: unknown): Promise<any> {
    const input = z.object({
      location: z.object({
        latitude: z.number().min(1.0).max(1.5),
        longitude: z.number().min(103.0).max(104.5),
        name: z.string().optional(),
      }).default({ latitude: 1.3521, longitude: 103.8198, name: 'Singapore' }),
      activityType: z.enum(['walking', 'cycling', 'outdoor_dining', 'sports', 'photography', 'general']).default('general'),
    }).parse(args);

    const conditions = await this.weatherService.getWeatherConditionsForLocation(
      input.location.latitude,
      input.location.longitude
    );

    const advisories = this.weatherService.generateWeatherAdvisory(conditions);
    const activityRecommendations = this.generateActivityRecommendations(conditions, input.activityType);

    return {
      location: input.location,
      conditions: {
        temperature: `${conditions.temperature}°C`,
        rainfall: `${conditions.rainfall}mm`,
        humidity: `${conditions.humidity}%`,
        windSpeed: `${conditions.windSpeed} km/h`,
      },
      advisories,
      activityRecommendations,
      timestamp: new Date().toISOString(),
    };
  }

  private analyzeComfortLevel(conditions: WeatherConditions): {
    level: 'comfortable' | 'warm' | 'hot' | 'humid' | 'uncomfortable';
    description: string;
  } {
    const { temperature, humidity, rainfall, windSpeed } = conditions;

    // Heavy rain makes it uncomfortable regardless of other factors
    if (rainfall > 10) {
      return {
        level: 'uncomfortable',
        description: `Heavy rain (${rainfall}mm) making outdoor activities difficult`,
      };
    }

    // Very hot conditions
    if (temperature > 34) {
      return {
        level: 'uncomfortable',
        description: `Very hot (${temperature}°C) with potential heat stress risk`,
      };
    }

    // Hot and humid combination
    if (temperature > 32 && humidity > 80) {
      return {
        level: 'uncomfortable',
        description: `Hot and humid (${temperature}°C, ${humidity}%) - feels much hotter`,
      };
    }

    // Hot conditions
    if (temperature > 30) {
      return {
        level: 'hot',
        description: `Hot weather (${temperature}°C) - stay hydrated and seek shade`,
      };
    }

    // High humidity
    if (humidity > 85) {
      return {
        level: 'humid',
        description: `Very humid (${humidity}%) - may feel sticky and uncomfortable`,
      };
    }

    // Warm but manageable
    if (temperature > 28) {
      return {
        level: 'warm',
        description: `Warm and pleasant (${temperature}°C) - good for most activities`,
      };
    }

    // Comfortable conditions
    return {
      level: 'comfortable',
      description: `Comfortable conditions (${temperature}°C) - ideal for outdoor activities`,
    };
  }

  private assessTravelImpact(conditions: WeatherConditions, advisories: WeatherAdvisory[]): {
    walkingConditions: 'excellent' | 'good' | 'fair' | 'poor' | 'avoid';
    recommendedActions: string[];
    timeAdjustments: {
      walkingTimeMultiplier: number;
      waitingTimeRecommendation: string;
    };
  } {
    const { rainfall, temperature, humidity, windSpeed } = conditions;
    const recommendedActions: string[] = [];
    let walkingConditions: 'excellent' | 'good' | 'fair' | 'poor' | 'avoid' = 'good';
    let walkingTimeMultiplier = 1.0;

    // Heavy rain impact
    if (rainfall > 15) {
      walkingConditions = 'avoid';
      walkingTimeMultiplier = 2.0;
      recommendedActions.push('Avoid outdoor walking - seek shelter');
      recommendedActions.push('Use covered walkways and MRT stations');
      recommendedActions.push('Consider postponing non-essential trips');
    } else if (rainfall > 5) {
      walkingConditions = 'poor';
      walkingTimeMultiplier = 1.5;
      recommendedActions.push('Use umbrella and waterproof clothing');
      recommendedActions.push('Prefer covered routes and MRT connections');
      recommendedActions.push('Allow extra time for travel');
    } else if (rainfall > 0) {
      walkingConditions = 'fair';
      walkingTimeMultiplier = 1.2;
      recommendedActions.push('Light rain - carry umbrella as precaution');
    }

    // Temperature impact
    if (temperature > 34) {
      if (walkingConditions === 'good') walkingConditions = 'poor';
      walkingTimeMultiplier = Math.max(walkingTimeMultiplier, 1.4);
      recommendedActions.push('Very hot - minimize outdoor exposure');
      recommendedActions.push('Seek air-conditioned transport options');
      recommendedActions.push('Stay hydrated and take frequent breaks');
    } else if (temperature > 32) {
      if (walkingConditions === 'good') walkingConditions = 'fair';
      walkingTimeMultiplier = Math.max(walkingTimeMultiplier, 1.2);
      recommendedActions.push('Hot weather - stay hydrated');
      recommendedActions.push('Seek shade when possible');
    }

    // Humidity impact
    if (humidity > 90) {
      walkingTimeMultiplier = Math.max(walkingTimeMultiplier, 1.1);
      recommendedActions.push('Very humid - expect to feel warmer than actual temperature');
    }

    // Wind impact
    if (windSpeed > 25) {
      recommendedActions.push('Strong winds - be cautious near tall buildings');
      recommendedActions.push('Secure loose items and clothing');
    }

    // Excellent conditions
    if (rainfall === 0 && temperature >= 24 && temperature <= 30 && humidity < 75) {
      walkingConditions = 'excellent';
      recommendedActions.push('Excellent weather for outdoor activities');
    }

    const waitingTimeRecommendation = this.generateWaitingTimeRecommendation(conditions);

    return {
      walkingConditions,
      recommendedActions,
      timeAdjustments: {
        walkingTimeMultiplier,
        waitingTimeRecommendation,
      },
    };
  }

  private generateWeatherSummary(conditions: WeatherConditions): string {
    const { temperature, rainfall, humidity, windSpeed } = conditions;

    if (rainfall > 10) {
      return `Heavy rain with ${temperature}°C temperature - indoor activities recommended`;
    }

    if (rainfall > 2.5) {
      return `Light to moderate rain with ${temperature}°C temperature - carry umbrella`;
    }

    if (temperature > 32) {
      return `Hot and ${humidity > 80 ? 'humid' : 'dry'} weather at ${temperature}°C - stay cool and hydrated`;
    }

    if (temperature < 26) {
      return `Pleasant ${temperature}°C weather with ${humidity}% humidity - great for outdoor activities`;
    }

    return `Warm ${temperature}°C weather with ${humidity}% humidity - comfortable for most activities`;
  }

  private generateWaitingTimeRecommendation(conditions: WeatherConditions): string {
    const { rainfall, temperature } = conditions;

    if (rainfall > 10) {
      return 'Seek covered waiting areas - avoid outdoor bus stops';
    }

    if (rainfall > 2.5) {
      return 'Use covered bus stops and MRT stations when possible';
    }

    if (temperature > 32) {
      return 'Seek air-conditioned or shaded waiting areas';
    }

    return 'Standard waiting times apply - conditions are manageable';
  }

  private generateActivityRecommendations(
    conditions: WeatherConditions,
    activityType: string
  ): {
    suitability: 'excellent' | 'good' | 'fair' | 'poor' | 'not_recommended';
    recommendations: string[];
    bestTimes: string[];
  } {
    const { temperature, rainfall, humidity, windSpeed } = conditions;
    const recommendations: string[] = [];
    const bestTimes: string[] = [];
    let suitability: 'excellent' | 'good' | 'fair' | 'poor' | 'not_recommended' = 'good';

    switch (activityType) {
      case 'walking':
        if (rainfall > 5) {
          suitability = 'poor';
          recommendations.push('Heavy rain - postpone if possible');
        } else if (temperature > 32) {
          suitability = 'fair';
          recommendations.push('Hot weather - walk in shade, stay hydrated');
          bestTimes.push('Early morning (6-8 AM)', 'Evening (6-8 PM)');
        } else {
          suitability = 'excellent';
          recommendations.push('Great conditions for walking');
        }
        break;

      case 'cycling':
        if (rainfall > 2.5) {
          suitability = 'not_recommended';
          recommendations.push('Rain makes cycling dangerous');
        } else if (windSpeed > 20) {
          suitability = 'poor';
          recommendations.push('Strong winds - be extra cautious');
        } else if (temperature > 30) {
          suitability = 'fair';
          recommendations.push('Hot - cycle early morning or evening');
          bestTimes.push('Early morning (6-8 AM)', 'Evening (6-8 PM)');
        } else {
          suitability = 'excellent';
          recommendations.push('Perfect cycling weather');
        }
        break;

      case 'outdoor_dining':
        if (rainfall > 0) {
          suitability = 'poor';
          recommendations.push('Rain - choose covered outdoor areas');
        } else if (temperature > 32) {
          suitability = 'fair';
          recommendations.push('Hot - seek shaded areas with fans');
          bestTimes.push('Evening (6-9 PM)');
        } else {
          suitability = 'excellent';
          recommendations.push('Perfect for outdoor dining');
        }
        break;

      case 'sports':
        if (rainfall > 2.5) {
          suitability = 'not_recommended';
          recommendations.push('Rain - move to indoor facilities');
        } else if (temperature > 34) {
          suitability = 'not_recommended';
          recommendations.push('Too hot for outdoor sports - risk of heat exhaustion');
        } else if (temperature > 30) {
          suitability = 'poor';
          recommendations.push('Very hot - take frequent breaks, stay hydrated');
          bestTimes.push('Early morning (6-8 AM)', 'Evening (6-8 PM)');
        } else {
          suitability = 'good';
          recommendations.push('Good conditions for sports');
        }
        break;

      case 'photography':
        if (rainfall > 5) {
          suitability = 'poor';
          recommendations.push('Heavy rain - protect equipment');
        } else if (rainfall > 0) {
          suitability = 'fair';
          recommendations.push('Light rain can create interesting effects');
        } else {
          suitability = 'excellent';
          recommendations.push('Clear conditions great for photography');
          bestTimes.push('Golden hour (6-7 AM, 6-7 PM)');
        }
        break;

      default:
        if (rainfall > 5) {
          suitability = 'poor';
          recommendations.push('Heavy rain - indoor activities recommended');
        } else if (temperature > 32) {
          suitability = 'fair';
          recommendations.push('Hot weather - seek air-conditioned spaces');
        } else {
          suitability = 'good';
          recommendations.push('Pleasant conditions for most activities');
        }
    }

    return {
      suitability,
      recommendations,
      bestTimes,
    };
  }
}
