import { logger } from '../utils/logger.js';

export interface FuzzySearchResult<T> {
  item: T;
  score: number;
  matches: string[];
}

export interface SearchPattern {
  pattern: RegExp;
  replacement: string;
  weight: number;
}

export class FuzzySearchService {
  private singaporeAbbreviations: Map<string, string[]> = new Map([
    // Common Singapore abbreviations
    ['blk', ['block', 'building']],
    ['opp', ['opposite', 'across from']],
    ['bef', ['before', 'in front of']],
    ['aft', ['after', 'behind']],
    ['stn', ['station', 'terminal']],
    ['cp', ['car park', 'carpark', 'parking']],
    ['int', ['interchange', 'terminal']],
    ['ctr', ['center', 'centre']],
    ['rd', ['road', 'street']],
    ['ave', ['avenue']],
    ['st', ['street']],
    ['dr', ['drive']],
    ['cres', ['crescent']],
    ['ter', ['terrace']],
    ['pk', ['park']],
    ['gdns', ['gardens']],
    ['hts', ['heights']],
    ['vw', ['view']],
    ['wk', ['walk']],
    ['cl', ['close']],
    ['pl', ['place']],
    ['sq', ['square']],
    ['cir', ['circle']],
    ['ct', ['court']],
    ['ln', ['lane']],
    ['mrt', ['mass rapid transit', 'train station']],
    ['lrt', ['light rail transit', 'light rail']],
    ['sch', ['school']],
    ['pri', ['primary']],
    ['sec', ['secondary']],
    ['jc', ['junior college']],
    ['poly', ['polytechnic']],
    ['univ', ['university']],
    ['hosp', ['hospital']],
    ['clin', ['clinic']],
    ['cc', ['community centre', 'community center']],
    ['rc', ['residents committee', 'residents centre']],
    ['temp', ['temporary']],
    ['perm', ['permanent']],
    ['hdb', ['housing development board', 'public housing']],
    ['condo', ['condominium']],
    ['apt', ['apartment']],
    ['twr', ['tower']],
    ['bldg', ['building']],
    ['shp', ['shop', 'shopping']],
    ['mkt', ['market']],
    ['fc', ['food court']],
    ['hc', ['hawker centre', 'hawker center']],
    ['mall', ['shopping mall', 'shopping centre']],
    ['plz', ['plaza']],
    ['pt', ['point']],
    ['jn', ['junction']],
    ['flyover', ['bridge', 'overpass']],
    ['underpass', ['subway', 'tunnel']],
  ]);

  private commonPatterns: SearchPattern[] = [
    // HDB block patterns
    { pattern: /\bblk\s*(\d+[a-z]?)\b/gi, replacement: 'block $1', weight: 1.2 },
    { pattern: /\bblock\s*(\d+[a-z]?)\b/gi, replacement: 'blk $1', weight: 1.2 },
    
    // Opposite patterns
    { pattern: /\bopp\s+(.+)/gi, replacement: 'opposite $1', weight: 1.1 },
    { pattern: /\bopposite\s+(.+)/gi, replacement: 'opp $1', weight: 1.1 },
    
    // Before/After patterns
    { pattern: /\bbef\s+(.+)/gi, replacement: 'before $1', weight: 1.1 },
    { pattern: /\baft\s+(.+)/gi, replacement: 'after $1', weight: 1.1 },
    
    // Car park patterns
    { pattern: /\bcp\b/gi, replacement: 'car park', weight: 1.1 },
    { pattern: /\bcar\s*park\b/gi, replacement: 'cp', weight: 1.1 },
    
    // Station patterns
    { pattern: /\bstn\b/gi, replacement: 'station', weight: 1.2 },
    { pattern: /\bmrt\s*stn\b/gi, replacement: 'mrt station', weight: 1.3 },
    { pattern: /\blrt\s*stn\b/gi, replacement: 'lrt station', weight: 1.3 },
    
    // Road patterns
    { pattern: /\brd\b/gi, replacement: 'road', weight: 1.0 },
    { pattern: /\bave\b/gi, replacement: 'avenue', weight: 1.0 },
    { pattern: /\bst\b/gi, replacement: 'street', weight: 1.0 },
  ];

  /**
   * Expand abbreviations in a search query
   */
  expandAbbreviations(query: string): string[] {
    const variations = [query.toLowerCase()];
    const words = query.toLowerCase().split(/\s+/);
    
    // Generate variations by expanding abbreviations
    const expandedVariations: string[] = [];
    
    for (const word of words) {
      const expansions = this.singaporeAbbreviations.get(word);
      if (expansions) {
        for (const expansion of expansions) {
          const expandedQuery = query.toLowerCase().replace(
            new RegExp(`\\b${word}\\b`, 'gi'),
            expansion
          );
          expandedVariations.push(expandedQuery);
        }
      }
    }
    
    variations.push(...expandedVariations);
    
    // Apply common patterns
    for (const pattern of this.commonPatterns) {
      const patternVariations = variations.map(v => 
        v.replace(pattern.pattern, pattern.replacement)
      ).filter(v => v !== query.toLowerCase());
      variations.push(...patternVariations);
    }
    
    return [...new Set(variations)]; // Remove duplicates
  }

  /**
   * Calculate Levenshtein distance between two strings
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => 
      Array(str1.length + 1).fill(null)
    );
    
    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
    
    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,     // deletion
          matrix[j - 1][i] + 1,     // insertion
          matrix[j - 1][i - 1] + indicator // substitution
        );
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  /**
   * Calculate similarity score between query and target string
   */
  calculateSimilarity(query: string, target: string): number {
    const queryLower = query.toLowerCase().trim();
    const targetLower = target.toLowerCase().trim();
    
    // Exact match gets highest score
    if (queryLower === targetLower) return 1.0;
    
    // Check if target contains query (substring match)
    if (targetLower.includes(queryLower)) {
      const ratio = queryLower.length / targetLower.length;
      return 0.8 + (ratio * 0.2); // 0.8 to 1.0 based on length ratio
    }
    
    // Check if query contains target
    if (queryLower.includes(targetLower)) {
      const ratio = targetLower.length / queryLower.length;
      return 0.7 + (ratio * 0.2); // 0.7 to 0.9 based on length ratio
    }
    
    // Word-based matching
    const queryWords = queryLower.split(/\s+/);
    const targetWords = targetLower.split(/\s+/);
    
    let matchingWords = 0;
    for (const qWord of queryWords) {
      for (const tWord of targetWords) {
        if (qWord === tWord || qWord.includes(tWord) || tWord.includes(qWord)) {
          matchingWords++;
          break;
        }
      }
    }
    
    const wordMatchRatio = matchingWords / Math.max(queryWords.length, targetWords.length);
    if (wordMatchRatio > 0.5) {
      return 0.5 + (wordMatchRatio * 0.3); // 0.5 to 0.8 based on word matches
    }
    
    // Levenshtein distance for fuzzy matching
    const maxLength = Math.max(queryLower.length, targetLower.length);
    if (maxLength === 0) return 0;
    
    const distance = this.levenshteinDistance(queryLower, targetLower);
    const similarity = 1 - (distance / maxLength);
    
    // Only return meaningful similarities
    return similarity > 0.3 ? similarity * 0.6 : 0; // Scale down fuzzy matches
  }

  /**
   * Search through items with fuzzy matching
   */
  search<T>(
    query: string,
    items: T[],
    extractText: (item: T) => string[],
    minScore: number = 0.3,
    maxResults: number = 10
  ): FuzzySearchResult<T>[] {
    if (!query.trim()) return [];
    
    logger.debug(`Fuzzy search for: "${query}"`);
    
    const queryVariations = this.expandAbbreviations(query);
    const results: FuzzySearchResult<T>[] = [];
    
    for (const item of items) {
      const textFields = extractText(item);
      let bestScore = 0;
      const matches: string[] = [];
      
      // Test each text field against each query variation
      for (const text of textFields) {
        for (const queryVar of queryVariations) {
          const score = this.calculateSimilarity(queryVar, text);
          if (score > bestScore) {
            bestScore = score;
            matches.length = 0; // Clear previous matches
            matches.push(text);
          } else if (score === bestScore && score > minScore) {
            matches.push(text);
          }
        }
      }
      
      if (bestScore >= minScore) {
        results.push({
          item,
          score: bestScore,
          matches: [...new Set(matches)] // Remove duplicates
        });
      }
    }
    
    // Sort by score (descending) and limit results
    results.sort((a, b) => b.score - a.score);
    const limitedResults = results.slice(0, maxResults);
    
    logger.debug(`Fuzzy search found ${limitedResults.length} results (${results.length} total)`);
    
    return limitedResults;
  }

  /**
   * Extract common Singapore location patterns from text
   */
  extractLocationPatterns(text: string): {
    blockNumber?: string;
    roadName?: string;
    landmark?: string;
    direction?: string;
    amenityType?: string;
  } {
    const patterns = {
      blockNumber: /(?:blk|block)\s*(\d+[a-z]?)/i.exec(text)?.[1],
      direction: /\b(opp|opposite|bef|before|aft|after|nr|near)\s+/i.exec(text)?.[1],
      amenityType: /\b(cp|car\s*park|stn|station|mrt|lrt|sch|school|hosp|hospital|cc|community\s*centre?|mall|market|hawker)\b/i.exec(text)?.[0],
    };
    
    return Object.fromEntries(
      Object.entries(patterns).filter(([_, value]) => value !== undefined)
    );
  }
}
