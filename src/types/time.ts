export interface SingaporeTimeResult {
  timezone: string;
  datetime: string;
  timestamp: number;
  formatted: {
    date: string;
    time: string;
    full: string;
  };
  businessContext: {
    isBusinessHours: boolean;
    isRushHour: boolean;
    isWeekend: boolean;
    isPublicHoliday: boolean;
  };
}

export interface SingaporeTimeResponse {
  currentTime: SingaporeTimeResult;
  formatted: {
    display: string;
    iso: string;
    timestamp: number;
  };
  context?: {
    isBusinessHours: boolean;
    isRushHour: boolean;
    isWeekend: boolean;
    nextBusinessHours?: string;
    rushHourInfo?: RushHourInfo;
  };
}

export interface RushHourInfo {
  current: boolean;
  nextRushHour?: {
    start: string;
    end: string;
  };
  type?: 'morning' | 'evening';
}

export interface CurrentTimeArgs {
  includeContext?: boolean;
  format?: 'iso' | 'local' | 'formatted';
}

export interface FormatTimeArgs {
  datetime: string;
}

export interface OneMapTimeFormat {
  date: string; // MM-DD-YYYY
  time: string; // HH:MM:SS
}

export interface TimeConversionResult {
  original: string;
  converted: string;
  timezone: string;
  offset: string;
}

export interface BusinessHoursConfig {
  weekdays: {
    start: number; // 9 (9 AM)
    end: number;   // 18 (6 PM)
  };
  saturday: {
    start: number; // 9 (9 AM)
    end: number;   // 13 (1 PM)
  };
  sunday: {
    closed: boolean;
  };
}

export interface RushHourConfig {
  morning: {
    start: number; // 7 (7 AM)
    end: number;   // 9 (9 AM)
  };
  evening: {
    start: number; // 17 (5 PM)
    end: number;   // 19 (7 PM)
  };
  weekendsOnly: boolean; // false - no rush hour on weekends
}
