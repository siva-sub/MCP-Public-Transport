import NodeCache from 'node-cache';
import { logger } from '../utils/logger.js';

export class CacheService {
  private cache: NodeCache;
  private hitCount = 0;
  private missCount = 0;

  constructor(defaultTtl: number = 300) {
    this.cache = new NodeCache({
      stdTTL: defaultTtl,
      checkperiod: 60,
      useClones: false,
      deleteOnExpire: true,
    });

    this.cache.on('expired', (key) => {
      logger.debug(`Cache key expired: ${key}`);
    });

    this.cache.on('del', (key) => {
      logger.debug(`Cache key deleted: ${key}`);
    });
  }

  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = this.cache.get<T>(key);
    
    if (cached !== undefined) {
      this.hitCount++;
      logger.debug(`Cache hit: ${key}`);
      return cached;
    }

    this.missCount++;
    logger.debug(`Cache miss: ${key}`);
    
    try {
      const data = await fetchFn();
      this.cache.set(key, data, ttl || 300);
      logger.debug(`Cache set: ${key} (TTL: ${ttl || 'default'})`);
      return data;
    } catch (error) {
      logger.error(`Failed to fetch data for cache key: ${key}`, error);
      throw error;
    }
  }

  get<T>(key: string): T | undefined {
    const value = this.cache.get<T>(key);
    if (value !== undefined) {
      this.hitCount++;
    } else {
      this.missCount++;
    }
    return value;
  }

  set<T>(key: string, value: T, ttl?: number): boolean {
    return this.cache.set(key, value, ttl || 300);
  }

  del(key: string): number {
    return this.cache.del(key);
  }

  flush(): void {
    this.cache.flushAll();
    logger.info('Cache flushed');
  }

  getStats(): any {
    const cacheStats = this.cache.getStats();
    return {
      ...cacheStats,
      hitRate: this.hitCount / (this.hitCount + this.missCount) || 0,
      hitCount: this.hitCount,
      missCount: this.missCount,
    };
  }
}
