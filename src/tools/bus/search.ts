import { z } from 'zod';
import { BaseTool, ToolDefinition } from '../base.js';
import { LTAService } from '../../services/lta.js';
import { OneMapService } from '../../services/onemap.js';
import { FuzzySearchService, FuzzySearchResult } from '../../services/fuzzySearch.js';
import { BusStop } from '../../types/transport.js';
import { logger } from '../../utils/logger.js';
import haversineDistance from 'haversine-distance';

const BusStopSearchInputSchema = z.object({
  query: z.string().min(1, 'Search query cannot be empty'),
  maxResults: z.number().min(1).max(50).default(10),
  enableFuzzySearch: z.boolean().default(true),
  minScore: z.number().min(0).max(1).default(0.3),
  includeDistance: z.boolean().default(true),
  userLocation: z.object({
    latitude: z.number(),
    longitude: z.number(),
  }).optional(),
});

export interface EnhancedBusStopResult {
  busStopCode: string;
  description: string;
  roadName: string;
  latitude: number;
  longitude: number;
  matchScore: number;
  matchedFields: string[];
  distanceMeters?: number;
  walkingTimeMinutes?: number;
  locationPatterns: {
    blockNumber?: string;
    direction?: string;
    amenityType?: string;
  };
  searchContext: {
    queryVariations: string[];
    bestMatch: string;
  };
}

export class BusStopSearchTool extends BaseTool {
  constructor(
    private ltaService: LTAService,
    private oneMapService: OneMapService,
    private fuzzySearchService: FuzzySearchService
  ) {
    super();
  }

  getDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'search_bus_stops',
        description: 'Advanced search for bus stops using fuzzy matching, Singapore abbreviations, and intelligent pattern recognition. Supports queries like "Opp Blk 910", "Bef Jurong East MRT", "CP near Orchard".',
        inputSchema: this.createSchema({
          query: {
            type: 'string',
            description: 'Search query - supports Singapore abbreviations (Blk, Opp, Bef, Aft, CP, Stn), HDB block numbers, landmarks, and partial descriptions',
            minLength: 1,
          },
          maxResults: {
            type: 'number',
            minimum: 1,
            maximum: 50,
            default: 10,
            description: 'Maximum number of results to return',
          },
          enableFuzzySearch: {
            type: 'boolean',
            default: true,
            description: 'Enable fuzzy matching for typos and variations',
          },
          minScore: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            default: 0.3,
            description: 'Minimum similarity score for results (0.0 to 1.0)',
          },
          includeDistance: {
            type: 'boolean',
            default: true,
            description: 'Include distance calculations if user location provided',
          },
          userLocation: {
            type: 'object',
            description: 'User location for distance-based ranking',
            properties: {
              latitude: { type: 'number' },
              longitude: { type: 'number' },
            },
          },
        }, ['query']),
      },
    ];
  }

  canHandle(toolName: string): boolean {
    return toolName === 'search_bus_stops';
  }

  async execute(toolName: string, args: unknown): Promise<any> {
    try {
      const {
        query,
        maxResults,
        enableFuzzySearch,
        minScore,
        includeDistance,
        userLocation,
      } = BusStopSearchInputSchema.parse(args);

      logger.info(`Searching bus stops with query: "${query}"`, {
        fuzzyEnabled: enableFuzzySearch,
        minScore,
        maxResults,
      });

      // Get all bus stops
      const allBusStops = await this.ltaService.getAllBusStops();
      
      let searchResults: FuzzySearchResult<BusStop>[];

      if (enableFuzzySearch) {
        // Use fuzzy search
        searchResults = this.fuzzySearchService.search(
          query,
          allBusStops,
          (busStop) => [
            busStop.description,
            busStop.roadName,
            `${busStop.description} ${busStop.roadName}`,
            `${busStop.roadName} ${busStop.description}`,
          ],
          minScore,
          maxResults * 2 // Get more results for distance sorting
        );
      } else {
        // Use simple substring search
        searchResults = this.simpleSearch(query, allBusStops, maxResults * 2);
      }

      // Enhance results with additional information
      const enhancedResults = searchResults.map((result): EnhancedBusStopResult => {
        const busStop = result.item;
        const locationPatterns = this.fuzzySearchService.extractLocationPatterns(
          `${busStop.description} ${busStop.roadName}`
        );

        const queryVariations = enableFuzzySearch 
          ? this.fuzzySearchService.expandAbbreviations(query)
          : [query];

        let distanceMeters: number | undefined;
        let walkingTimeMinutes: number | undefined;

        if (includeDistance && userLocation) {
          distanceMeters = haversineDistance(
            { latitude: userLocation.latitude, longitude: userLocation.longitude },
            { latitude: busStop.latitude, longitude: busStop.longitude }
          );
          walkingTimeMinutes = Math.ceil(distanceMeters / 80); // 80m/min walking speed
        }

        return {
          busStopCode: busStop.busStopCode,
          description: busStop.description,
          roadName: busStop.roadName,
          latitude: busStop.latitude,
          longitude: busStop.longitude,
          matchScore: result.score,
          matchedFields: result.matches,
          distanceMeters,
          walkingTimeMinutes,
          locationPatterns,
          searchContext: {
            queryVariations,
            bestMatch: result.matches[0] || busStop.description,
          },
        };
      });

      // Sort results by relevance and distance
      const sortedResults = this.sortResults(enhancedResults, userLocation);
      const finalResults = sortedResults.slice(0, maxResults);

      // Generate search suggestions
      const suggestions = this.generateSearchSuggestions(query, finalResults);

      return {
        query,
        searchType: enableFuzzySearch ? 'fuzzy' : 'simple',
        totalFound: searchResults.length,
        results: finalResults,
        suggestions,
        searchMetadata: {
          fuzzySearchEnabled: enableFuzzySearch,
          minScore,
          queryVariations: enableFuzzySearch 
            ? this.fuzzySearchService.expandAbbreviations(query)
            : [query],
          userLocationProvided: !!userLocation,
          distanceCalculated: includeDistance && !!userLocation,
        },
        timestamp: new Date().toISOString(),
      };

    } catch (error) {
      logger.error(`Bus stop search failed: ${toolName}`, error);
      return this.formatError(error as Error, toolName);
    }
  }

  private simpleSearch(
    query: string,
    busStops: BusStop[],
    maxResults: number
  ): FuzzySearchResult<BusStop>[] {
    const queryLower = query.toLowerCase();
    const results: FuzzySearchResult<BusStop>[] = [];

    for (const busStop of busStops) {
      const description = busStop.description.toLowerCase();
      const roadName = busStop.roadName.toLowerCase();
      
      let score = 0;
      const matches: string[] = [];

      // Check exact matches first
      if (description.includes(queryLower)) {
        score = Math.max(score, 0.8);
        matches.push(busStop.description);
      }
      if (roadName.includes(queryLower)) {
        score = Math.max(score, 0.7);
        matches.push(busStop.roadName);
      }

      if (score > 0) {
        results.push({
          item: busStop,
          score,
          matches,
        });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  }

  private sortResults(
    results: EnhancedBusStopResult[],
    userLocation?: { latitude: number; longitude: number }
  ): EnhancedBusStopResult[] {
    return results.sort((a, b) => {
      // Primary sort: match score (higher is better)
      const scoreDiff = b.matchScore - a.matchScore;
      if (Math.abs(scoreDiff) > 0.1) return scoreDiff;

      // Secondary sort: distance (if available, closer is better)
      if (userLocation && a.distanceMeters !== undefined && b.distanceMeters !== undefined) {
        return a.distanceMeters - b.distanceMeters;
      }

      // Tertiary sort: alphabetical by description
      return a.description.localeCompare(b.description);
    });
  }

  private generateSearchSuggestions(
    query: string,
    results: EnhancedBusStopResult[]
  ): Array<{
    text: string;
    type: 'expansion' | 'alternative' | 'tip';
    confidence: number;
    reason: string;
  }> {
    const suggestions: Array<{
      text: string;
      type: 'expansion' | 'alternative' | 'tip';
      confidence: number;
      reason: string;
    }> = [];

    if (results.length === 0) {
      suggestions.push({
        text: 'Try using Singapore abbreviations like "Blk" for Block, "Opp" for Opposite',
        type: 'tip',
        confidence: 0.9,
        reason: 'No results found, abbreviations might help',
      });

      suggestions.push({
        text: 'Include road name or nearby landmarks in your search',
        type: 'expansion',
        confidence: 0.8,
        reason: 'Broader search terms often yield better results',
      });

      // Check if query contains numbers (might be looking for HDB blocks)
      if (/\d+/.test(query)) {
        suggestions.push({
          text: 'For HDB blocks, try "Blk [number]" format (e.g., "Blk 123")',
          type: 'alternative',
          confidence: 0.7,
          reason: 'Query contains numbers, might be HDB block search',
        });
      }
    } else if (results.length < 3) {
      suggestions.push({
        text: 'Try shorter or more general terms for more results',
        type: 'expansion',
        confidence: 0.6,
        reason: 'Few results found, broader search might help',
      });
    }

    // Analyze common patterns in results for suggestions
    const commonRoads = this.findCommonPatterns(results, 'roadName');
    if (commonRoads.length > 0) {
      suggestions.push({
        text: `Related areas: ${commonRoads.slice(0, 3).join(', ')}`,
        type: 'alternative',
        confidence: 0.5,
        reason: 'Found stops on related roads',
      });
    }

    return suggestions;
  }

  private findCommonPatterns(
    results: EnhancedBusStopResult[],
    field: keyof EnhancedBusStopResult
  ): string[] {
    const patterns = new Map<string, number>();
    
    for (const result of results) {
      const value = result[field] as string;
      if (typeof value === 'string') {
        const words = value.toLowerCase().split(/\s+/);
        for (const word of words) {
          if (word.length > 3) { // Only consider meaningful words
            patterns.set(word, (patterns.get(word) || 0) + 1);
          }
        }
      }
    }

    return Array.from(patterns.entries())
      .filter(([_, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .map(([word]) => word);
  }
}
