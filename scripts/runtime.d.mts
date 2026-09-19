export declare const SUPPORTED_APP_RUNTIMES: readonly ['fastify', 'docker'];
export declare const DEFAULT_APP_RUNTIME: 'fastify';

export declare function readRuntime(
  source?: NodeJS.ProcessEnv,
): 'fastify' | 'docker';

export declare function composeArgs(
  action: string,
  ...rest: string[]
): string[];

export interface StartPlan {
  runtime: 'fastify' | 'docker';
  kind: 'app' | 'docker';
  command: string;
  args: string[];
}

export declare function requireDockerDatabaseConfig(
  source?: NodeJS.ProcessEnv,
): void;

export declare function planStart(source?: NodeJS.ProcessEnv): StartPlan;
