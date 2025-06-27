import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const ConfigSchema = z.object({
  // Existing configs
  ltaAccountKey: z.string().min(1, 'LTA_ACCOUNT_KEY is required'),
  cacheDuration: z.coerce.number().default(300),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  maxWalkDistance: z.coerce.number().default(1000),
  enableCrowdPrediction: z.coerce.boolean().default(true),
  enableCostOptimization: z.coerce.boolean().default(true),
  requestTimeout: z.coerce.number().default(30000), // Increased for OneMap API
  maxConcurrentRequests: z.coerce.number().default(10),
  
  // OneMap authentication configs (required for routing)
  oneMapEmail: z.string().email('ONEMAP_EMAIL must be a valid email address'),
  oneMapPassword: z.string().min(1, 'ONEMAP_PASSWORD is required'),
  enableFuzzySearch: z.coerce.boolean().default(true),
  maxSearchResults: z.coerce.number().default(10),
  searchTimeout: z.coerce.number().default(5000),
  enableAutoComplete: z.coerce.boolean().default(true),
  enableLocationCaching: z.coerce.boolean().default(true),
  locationCacheDuration: z.coerce.number().default(3600),
  
  // Testing and maintenance
  enableApiTesting: z.coerce.boolean().default(false),
  skipTrafficApis: z.coerce.boolean().default(false),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadEnvironment(): Config {
  try {
    const config = ConfigSchema.parse({
      // Existing configs
      ltaAccountKey: process.env.LTA_ACCOUNT_KEY,
      cacheDuration: process.env.CACHE_DURATION,
      logLevel: process.env.LOG_LEVEL,
      maxWalkDistance: process.env.MAX_WALK_DISTANCE,
      enableCrowdPrediction: process.env.ENABLE_CROWD_PREDICTION,
      enableCostOptimization: process.env.ENABLE_COST_OPTIMIZATION,
      requestTimeout: process.env.REQUEST_TIMEOUT,
      maxConcurrentRequests: process.env.MAX_CONCURRENT_REQUESTS,
      
      // New location intelligence configs
      oneMapEmail: process.env.ONEMAP_EMAIL,
      oneMapPassword: process.env.ONEMAP_PASSWORD,
      enableFuzzySearch: process.env.ENABLE_FUZZY_SEARCH,
      maxSearchResults: process.env.MAX_SEARCH_RESULTS,
      searchTimeout: process.env.SEARCH_TIMEOUT,
      enableAutoComplete: process.env.ENABLE_AUTO_COMPLETE,
      enableLocationCaching: process.env.ENABLE_LOCATION_CACHING,
      locationCacheDuration: process.env.LOCATION_CACHE_DURATION,
      
      // Testing and maintenance
      enableApiTesting: process.env.ENABLE_API_TESTING,
      skipTrafficApis: process.env.SKIP_TRAFFIC_APIS,
    });

    return config;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      throw new Error(`Environment configuration error: ${issues}`);
    }
    throw error;
  }
}
