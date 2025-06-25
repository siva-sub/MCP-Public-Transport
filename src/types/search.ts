export interface QueryAnalysis {
  type: 'postal_code' | 'mrt_station' | 'landmark' | 'address' | 'mixed';
  confidence: number;
  extractedComponents: {
    postalCode?: string;
    stationName?: string;
    streetName?: string;
    buildingName?: string;
    landmarks?: string[];
  }
  suggestedStrategies: SearchStrategy[];
  modifications: QueryModification[];
}

export interface QueryModification {
  type: 'typo_correction' | 'abbreviation_expansion' | 'partial_match';
  original: string;
  suggested: string;
  confidence: number;
}

export interface LocationResolutionOptions {
  maxResults?: number;
  enableFuzzySearch?: boolean;
  userLocation?: { latitude: number; longitude: number };
  includeNearbyInfo?: boolean;
  skipCache?: boolean;
  searchTimeout?: number;
}

export interface LocationResolutionResult {
  query: string;
  queryAnalysis: QueryAnalysis;
  results: LocationResult[];
  confidence: number;
  suggestions: SearchSuggestion[];
  timestamp: string;
}

export interface SearchSuggestion {
  text: string;
  type: 'correction' | 'expansion' | 'alternative';
  confidence: number;
  reason: string;
}

export interface SearchResult {
  query: string;
  results: LocationResult[];
  suggestions: SearchSuggestion[];
  confidence: number;
  searchStrategiesUsed: SearchStrategy[];
}

export interface SearchOptions {
  maxResults?: number;
  enableFuzzySearch?: boolean;
  userLocation?: { latitude: number; longitude: number };
  timeout?: number;
}

export interface SearchContext {
  userLocation?: { latitude: number; longitude: number };
  timeContext?: {
    isBusinessHours: boolean;
    isRushHour: boolean;
    isWeekend: boolean;
  };
  preferredTransport?: string[];
}

export interface EnhancedQuery {
  original: string;
  expanded: string[];
  corrections: string[];
  abbreviations: string[];
}

export interface ContextualQuery {
  query: string;
  context: SearchContext;
  enhancedQueries: string[];
}

export interface AutoCompleteSuggestion {
  text: string;
  type: 'mrt_station' | 'landmark' | 'postal_code' | 'address';
  confidence: number;
  metadata?: {
    line?: string;
    district?: string;
    category?: string;
  };
}

// Tool input/output types
export interface LocationSearchArgs {
  query: string;
  maxResults?: number;
  enableFuzzySearch?: boolean;
  includeNearbyInfo?: boolean;
  userLocation?: { latitude: number; longitude: number };
}

export interface LocationSearchResponse {
  query: string;
  results: LocationResult[];
  suggestions: SearchSuggestion[];
  confidence: number;
  searchStrategiesUsed: SearchStrategy[];
  contextInfo: {
    singaporeTime: string;
    isBusinessHours: boolean;
    isRushHour: boolean;
  };
  timestamp: string;
}

export interface ReverseGeocodeArgs {
  latitude: number;
  longitude: number;
  radius?: number;
  includeNearbyAmenities?: boolean;
}

export interface PostalCodeArgs {
  postalCode: string;
  includeNearbyInfo?: boolean;
}

// Import from location.ts to avoid circular dependency
import type { LocationResult, SearchStrategy } from './location.js';
