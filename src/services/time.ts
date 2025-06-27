import { logger } from '../utils/logger.js';
import { 
  SingaporeTimeResult, 
  OneMapTimeFormat, 
  BusinessHoursConfig, 
  RushHourConfig,
  RushHourInfo 
} from '../types/time.js';

export class SingaporeTimeService {
  private readonly timezone = 'Asia/Singapore';
  
  private readonly businessHours: BusinessHoursConfig = {
    weekdays: { start: 9, end: 18 },
    saturday: { start: 9, end: 13 },
    sunday: { closed: true }
  };
  
  private readonly rushHours: RushHourConfig = {
    morning: { start: 7, end: 9 },
    evening: { start: 17, end: 19 },
    weekendsOnly: false
  };

  getCurrentTime(): SingaporeTimeResult {
    try {
      const now = new Date();
      
      // Create a proper Singapore time Date object
      const singaporeTime = new Date(now.toLocaleString("en-US", { timeZone: this.timezone }));
      
      return {
        timezone: this.timezone,
        datetime: now.toISOString(), // Keep original UTC ISO string
        timestamp: now.getTime(),
        formatted: {
          date: now.toLocaleDateString('en-SG', { timeZone: this.timezone }),
          time: now.toLocaleTimeString('en-SG', { timeZone: this.timezone }),
          full: now.toLocaleString('en-SG', { timeZone: this.timezone }),
        },
        businessContext: {
          isBusinessHours: this.isBusinessHours(singaporeTime),
          isRushHour: this.isRushHour(singaporeTime),
          isWeekend: this.isWeekend(singaporeTime),
          isPublicHoliday: false, // TODO: Implement holiday detection
        }
      };
    } catch (error) {
      logger.error('Failed to get Singapore time', error);
      throw new Error('Failed to get Singapore time');
    }
  }

  formatForOneMap(date: Date): OneMapTimeFormat {
    try {
      const singaporeDate = new Date(date.toLocaleString("en-US", { timeZone: this.timezone }));
      
      return {
        date: this.formatDateForOneMap(singaporeDate),
        time: this.formatTimeForOneMap(singaporeDate),
      };
    } catch (error) {
      logger.error('Failed to format time for OneMap', error);
      throw new Error('Failed to format time for OneMap');
    }
  }

  private formatDateForOneMap(date: Date): string {
    // OneMap expects MM-DD-YYYY format
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = date.getFullYear();
    return `${month}-${day}-${year}`;
  }

  private formatTimeForOneMap(date: Date): string {
    // OneMap expects HH:MM:SS format
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }

  private isBusinessHours(date: Date): boolean {
    const hour = date.getHours();
    const day = date.getDay(); // 0 = Sunday, 1 = Monday, etc.
    
    if (day === 0) { // Sunday
      return !this.businessHours.sunday.closed;
    } else if (day === 6) { // Saturday
      return hour >= this.businessHours.saturday.start && hour < this.businessHours.saturday.end;
    } else { // Weekdays (Monday to Friday)
      return hour >= this.businessHours.weekdays.start && hour < this.businessHours.weekdays.end;
    }
  }

  private isRushHour(date: Date): boolean {
    const hour = date.getHours();
    const day = date.getDay();
    
    if (this.rushHours.weekendsOnly && (day === 0 || day === 6)) {
      return false; // No rush hour on weekends
    }
    
    return (hour >= this.rushHours.morning.start && hour < this.rushHours.morning.end) ||
           (hour >= this.rushHours.evening.start && hour < this.rushHours.evening.end);
  }

  private isWeekend(date: Date): boolean {
    const day = date.getDay();
    return day === 0 || day === 6; // Sunday or Saturday
  }

  getRushHourInfo(date?: Date): RushHourInfo {
    const targetDate = date || new Date();
    const singaporeTime = new Date(targetDate.toLocaleString("en-US", { timeZone: this.timezone }));
    const hour = singaporeTime.getHours();
    const day = singaporeTime.getDay();
    
    const current = this.isRushHour(singaporeTime);
    
    let type: 'morning' | 'evening' | undefined;
    if (current) {
      if (hour >= this.rushHours.morning.start && hour < this.rushHours.morning.end) {
        type = 'morning';
      } else if (hour >= this.rushHours.evening.start && hour < this.rushHours.evening.end) {
        type = 'evening';
      }
    }
    
    let nextRushHour: { start: string; end: string } | undefined;
    if (!current && day >= 1 && day <= 5) { // Weekdays only
      if (hour < this.rushHours.morning.start) {
        // Next rush hour is morning rush today
        nextRushHour = {
          start: `${this.rushHours.morning.start}:00`,
          end: `${this.rushHours.morning.end}:00`
        };
      } else if (hour < this.rushHours.evening.start) {
        // Next rush hour is evening rush today
        nextRushHour = {
          start: `${this.rushHours.evening.start}:00`,
          end: `${this.rushHours.evening.end}:00`
        };
      } else {
        // Next rush hour is tomorrow morning (if it's a weekday)
        const tomorrow = new Date(singaporeTime);
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (tomorrow.getDay() >= 1 && tomorrow.getDay() <= 5) {
          nextRushHour = {
            start: `${this.rushHours.morning.start}:00 (tomorrow)`,
            end: `${this.rushHours.morning.end}:00 (tomorrow)`
          };
        }
      }
    }
    
    return {
      current,
      nextRushHour,
      type
    };
  }

  getNextBusinessHours(date?: Date): string {
    const targetDate = date || new Date();
    const singaporeTime = new Date(targetDate.toLocaleString("en-US", { timeZone: this.timezone }));
    const hour = singaporeTime.getHours();
    const day = singaporeTime.getDay();
    
    if (this.isBusinessHours(singaporeTime)) {
      return 'Currently business hours';
    }
    
    if (day >= 1 && day <= 5) { // Weekdays
      if (hour < this.businessHours.weekdays.start) {
        return `${this.businessHours.weekdays.start}:00 today`;
      } else {
        return `${this.businessHours.weekdays.start}:00 tomorrow`;
      }
    } else if (day === 6) { // Saturday
      if (hour < this.businessHours.saturday.start) {
        return `${this.businessHours.saturday.start}:00 today`;
      } else {
        return `${this.businessHours.weekdays.start}:00 Monday`;
      }
    } else { // Sunday
      return `${this.businessHours.weekdays.start}:00 Monday`;
    }
  }

  // Utility method to create a Singapore time from UTC
  fromUTC(utcDate: Date): Date {
    return new Date(utcDate.toLocaleString("en-US", { timeZone: this.timezone }));
  }

  // Utility method to get Singapore offset from UTC
  getSingaporeOffset(): string {
    return '+08:00'; // Singapore is always UTC+8
  }
}
