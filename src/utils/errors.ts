export class TransportError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'TransportError';
    
    if (originalError) {
      this.stack = originalError.stack;
    }
  }
}

export class ValidationError extends TransportError {
  constructor(message: string, originalError?: Error) {
    super(message, 'VALIDATION_ERROR', 400, originalError);
    this.name = 'ValidationError';
  }
}

export class APIError extends TransportError {
  constructor(message: string, code: string, statusCode: number = 502, originalError?: Error) {
    super(message, code, statusCode, originalError);
    this.name = 'APIError';
  }
}

export class RateLimitError extends TransportError {
  constructor(message: string = 'Rate limit exceeded') {
    super(message, 'RATE_LIMIT_ERROR', 429);
    this.name = 'RateLimitError';
  }
}
