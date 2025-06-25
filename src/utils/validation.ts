import { z } from 'zod';
import { ValidationError } from './errors';

export const BusStopCodeSchema = z.string()
  .regex(/^\d{5}$/, 'Bus stop code must be 5 digits')
  .describe('5-digit bus stop code');

export const CoordinateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const LocationSchema = z.object({
  location: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
}).refine(
  (data) => data.location || (data.lat !== undefined && data.lng !== undefined),
  'Either location name or coordinates (lat, lng) must be provided'
);

export function validateInput<T>(schema: z.ZodSchema<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      throw new ValidationError(`Validation failed: ${issues}`);
    }
    throw error;
  }
}
