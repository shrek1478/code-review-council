import { Controller, Get, Post, Query, Body, ConsoleLogger, Inject, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { readdir, writeFile, access, realpath } from 'node:fs/promises';
import { join, resolve, sep, basename } from 'node:path';
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
    cliPath: 'claude-agent-acp',
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
    const root = this.defaultRoot;
    const resolved = resolve(dirPath || root);
    // 展開 symlink 後再做邊界檢查，防止 symlink 繞過
    let targetPath: string;
    try {
      targetPath = await realpath(resolved);
    } catch {
      throw new NotFoundException('Directory not found');
    }
    // 限制只允許 home 目錄以下（含 home 本身）
    if (targetPath !== root && !targetPath.startsWith(root + sep)) {
      throw new ForbiddenException('Access outside home directory is not allowed');
    }
    let entries: import('node:fs').Dirent[];
    try {
      entries = await readdir(targetPath, { withFileTypes: true });
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') throw new NotFoundException('Directory not found');
      if (err.code === 'EACCES') throw new ForbiddenException('Permission denied');
      throw error;
    }

    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => ({
        name: entry.name,
        path: join(targetPath, entry.name).replace(/\\/g, '/'),
        isDirectory: true,
      }));
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
    // 防禦性斷言：確保最終路徑的檔名是預期的設定檔名（深層防禦）
    if (basename(configPath) !== 'review-council.config.json') {
      throw new ForbiddenException('Invalid config path');
    }
    // 先驗證，再寫入
    const validation = this.configService.validateConfigData(config);
    if (!validation.valid) {
      throw new BadRequestException(
        `Invalid configuration: ${validation.error}`,
      );
    }
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
    await this.configService.loadConfig(configPath);
    return { success: true };
  }
}
