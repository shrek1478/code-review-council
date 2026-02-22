import { Controller, Get, Post, Query, Body, ConsoleLogger, Inject } from '@nestjs/common';
import { readdir, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { ConfigService } from '../../../../src/config/config.service.js';

interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface AgentDefinition {
  name: string;
  cliPath: string;
  cliArgs: string[];
  protocol?: 'acp' | 'copilot';
  description: string;
}

interface AgentDetectionResult extends AgentDefinition {
  installed: boolean;
}

const KNOWN_AGENTS: AgentDefinition[] = [
  {
    name: 'Gemini',
    cliPath: 'gemini',
    cliArgs: ['--experimental-acp'],
    description: 'Google Gemini CLI',
  },
  {
    name: 'Copilot',
    cliPath: 'copilot',
    cliArgs: [],
    protocol: 'copilot',
    description: 'GitHub Copilot CLI (supports model selection)',
  },
  {
    name: 'Codex',
    cliPath: 'codex-acp',
    cliArgs: [],
    description: 'OpenAI Codex CLI',
  },
  {
    name: 'Claude',
    cliPath: 'claude-code-acp',
    cliArgs: [],
    description: 'Anthropic Claude Code CLI',
  },
];

@Controller('filesystem')
export class FilesystemController {
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {}

  private get defaultRoot(): string {
    return process.env.HOST_HOME || homedir();
  }

  @Get('list')
  async listDirectory(
    @Query('path') dirPath?: string,
  ): Promise<DirectoryEntry[]> {
    const targetPath = resolve(dirPath || this.defaultRoot);
    const entries = await readdir(targetPath, { withFileTypes: true });

    const directories: DirectoryEntry[] = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => ({
        name: entry.name,
        path: join(targetPath, entry.name),
        isDirectory: true,
      }));

    return directories;
  }

  @Get('agents')
  async detectAgents(): Promise<AgentDetectionResult[]> {
    const results = await Promise.all(
      KNOWN_AGENTS.map(async (agent) => {
        const result: AgentDetectionResult = {
          ...agent,
          installed: false,
        };
        try {
          const found = await this.whichCommand(agent.cliPath);
          result.installed = found;
        } catch {
          result.installed = false;
        }
        return result;
      }),
    );
    return results;
  }

  private whichCommand(cmd: string): Promise<boolean> {
    const lookup = process.platform === 'win32' ? 'where' : 'which';
    return new Promise((resolve) => {
      execFile(lookup, [cmd], { timeout: 5_000 }, (err) => {
        resolve(!err);
      });
    });
  }

  @Post('config/save')
  async saveConfig(
    @Body() config: Record<string, unknown>,
  ): Promise<{ success: boolean }> {
    const configPath = resolve(process.cwd(), 'review-council.config.json');
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
    await this.configService.loadConfig(configPath);
    return { success: true };
  }
}
