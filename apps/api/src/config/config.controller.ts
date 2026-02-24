import { Controller, Get, Post, Body } from '@nestjs/common';
import { ConfigService } from '../../../../src/config/config.service.js';
import type { CouncilConfig } from '../../../../src/config/config.types.js';

const SENSITIVE_FLAGS = new Set([
  '--api-key', '--token', '--secret', '--password', '--auth',
  '--bearer-token', '--client-secret', '--access-token',
  '--refresh-token', '--credentials', '-k', '-p',
]);

function maskCliArgs(args: string[]): string[] {
  return args.map((arg, i) => {
    if (i > 0 && SENSITIVE_FLAGS.has(args[i - 1])) return '[REDACTED]';
    for (const flag of SENSITIVE_FLAGS) {
      if (arg.startsWith(`${flag}=`)) return `${flag}=[REDACTED]`;
    }
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
