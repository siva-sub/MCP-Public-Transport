import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const ConfigSchema = z.object({
  ltaAccountKey: z.string().min(1, 'LTA_ACCOUNT_KEY is required'),
  oneMapToken: z.string().optional(),
  cacheDuration: z.coerce.number().default(300),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  maxWalkDistance: z.coerce.number().default(1000),
  enableCrowdPrediction: z.coerce.boolean().default(true),
  enableCostOptimization: z.coerce.boolean().default(true),
  requestTimeout: z.coerce.number().default(30000),
  maxConcurrentRequests: z.coerce.number().default(10),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadEnvironment(): Config {
  try {
    const config = ConfigSchema.parse({
      ltaAccountKey: process.env.LTA_ACCOUNT_KEY,
      oneMapToken: process.env.ONEMAP_TOKEN,
      cacheDuration: process.env.CACHE_DURATION,
      logLevel: process.env.LOG_LEVEL,
      maxWalkDistance: process.env.MAX_WALK_DISTANCE,
      enableCrowdPrediction: process.env.ENABLE_CROWD_PREDICTION,
      enableCostOptimization: process.env.ENABLE_COST_OPTIMIZATION,
      requestTimeout: process.env.REQUEST_TIMEOUT,
      maxConcurrentRequests: process.env.MAX_CONCURRENT_REQUESTS,
    });

    return config;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingFields = error.errors.map(e => e.path.join('.')).join(', ');
      throw new Error(`Environment configuration error: ${missingFields}`);
    }
    throw error;
  }
}
