import { z } from 'zod';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export abstract class BaseTool {
  abstract getDefinitions(): ToolDefinition[];
  abstract canHandle(toolName: string): boolean;
  abstract execute(toolName: string, args: unknown): Promise<any>;

  protected createSchema(properties: Record<string, any>, required?: string[]): any {
    return {
      type: 'object',
      properties,
      required: required || [],
    };
  }

  protected formatError(error: Error, toolName: string): any {
    return {
      error: `Tool '${toolName}' failed: ${error.message}`,
      timestamp: new Date().toISOString(),
    };
  }
}
