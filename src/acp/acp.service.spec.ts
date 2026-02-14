import { Test } from '@nestjs/testing';
import { AcpService } from './acp.service.js';
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@github/copilot-sdk', () => {
  const MockCopilotClient = vi.fn().mockImplementation(function (this: any) {
    this.start = vi.fn().mockResolvedValue(undefined);
    this.stop = vi.fn().mockResolvedValue(undefined);
    this.createSession = vi.fn().mockResolvedValue({
      on: vi.fn(),
      send: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
    });
  });
  return { CopilotClient: MockCopilotClient };
});

describe('AcpService', () => {
  let service: AcpService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [AcpService],
    }).compile();
    service = module.get(AcpService);
  });

  it('should create a client for a reviewer config', async () => {
    const client = await service.createClient({
      name: 'TestReviewer',
      cliPath: 'test-cli',
      cliArgs: ['--test'],
    });
    expect(client).toBeDefined();
    expect(client.name).toBe('TestReviewer');
  });

  it('should track created clients', async () => {
    await service.createClient({ name: 'R1', cliPath: 'cli1', cliArgs: [] });
    await service.createClient({ name: 'R2', cliPath: 'cli2', cliArgs: [] });
    // stopAll should stop all clients
    await service.stopAll();
  });
});
