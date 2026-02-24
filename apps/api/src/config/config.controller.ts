import { Controller, Get, Post, Body } from '@nestjs/common';
import { ConfigService } from '../../../../src/config/config.service.js';
import type { CouncilConfig } from '../../../../src/config/config.types.js';

const SENSITIVE_FLAGS = new Set([
  '--api-key',
  '--token',
  '--secret',
  '--password',
  '--auth',
  '--bearer-token',
  '--client-secret',
  '--access-token',
  '--refresh-token',
  '--credentials',
  '-k',
  '-p',
]);

const SECRET_PATTERN =
  /^(sk-|ghp_|gho_|ghu_|ghs_|ghr_|glpat-|xox[bsrap]-|key_|token_)/i;

function looksLikeSecret(value: string): boolean {
  if (value.length < 8) return false;
  if (SECRET_PATTERN.test(value)) return true;
  // Base64-like long strings (32+ chars)
  if (value.length >= 32 && /^[A-Za-z0-9+/=_-]+$/.test(value)) return true;
  return false;
}

function maskCliArgs(args: string[]): string[] {
  return args.map((arg, i) => {
    if (i > 0 && SENSITIVE_FLAGS.has(args[i - 1])) return '[REDACTED]';
    for (const flag of SENSITIVE_FLAGS) {
      if (arg.startsWith(`${flag}=`)) return `${flag}=[REDACTED]`;
    }
    // Mask positional args that look like secrets
    if (!arg.startsWith('-') && looksLikeSecret(arg)) return '[REDACTED]';
    return arg;
  });
}

@Controller('config')
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  getConfig() {
    const config = this.configService.getConfig();
    return this.maskConfig(config);
  }

  @Post('validate')
  validateConfig(@Body() body: Record<string, unknown>) {
    return this.configService.validateConfigData(body);
  }

  private maskConfig(config: CouncilConfig): CouncilConfig {
    return {
      ...config,
      reviewers: config.reviewers.map((r) => ({
        ...r,
        cliArgs: maskCliArgs(r.cliArgs),
      })),
      decisionMaker: {
        ...config.decisionMaker,
        cliArgs: maskCliArgs(config.decisionMaker.cliArgs),
      },
    };
  }
}
