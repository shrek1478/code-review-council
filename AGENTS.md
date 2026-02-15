---
applyTo: '**'
---

# NestJS 專案開發準則（# AGENTS.md, # CLAUDE.md, # GEMINI.md）

## 架構規則

三層式架構：**Controller → Service → Store**，職責嚴格分離。

| 層級           | 職責                                                 | 禁止事項                     |
| -------------- | ---------------------------------------------------- | ---------------------------- |
| **Controller** | HTTP 請求/回應、DTO 驗證、`HpcResponse` 包裝         | 不放業務邏輯、不做 try-catch |
| **Service**    | 業務邏輯、協調多個 Store、交易管理                   | -                            |
| **Store**      | 資料存取、TypeORM Repository、`DatabaseErrorHandler` | 不放業務邏輯                 |

## 錯誤處理

- **Controller**：不做 try-catch，異常由 `HpcGlobalExceptionFilter` 統一處理
- **Service**：業務異常拋 `HttpException`（`NotFoundException`、`BadRequestException` 等）
- **Store**：用 `DatabaseErrorHandler.toHttpException(error, messageMap)` 包裝資料庫錯誤
- **HpcGlobalExceptionFilter**：統一回傳 `HpcResponse(null, { code, message })`

## 日誌規範

**注入 `ConsoleLogger`，禁止使用 `new Logger()`**

```typescript
import { Injectable, ConsoleLogger } from '@nestjs/common';

@Injectable()
export class MyService {
  constructor(private readonly logger: ConsoleLogger) {
    this.logger.setContext(MyService.name);
  }
}
```

`HpcNestCommonModule` 以 `Scope.TRANSIENT` 提供 `HpcPinoConsoleLogger` 實例，自動整合 traceId。

## Controller 回傳格式

使用 `HpcResponse`（`@his/backend-types`）手動包裝，結構：`{ code, payload, message }`

```typescript
import { HpcResponse, Pageable } from '@his/backend-types';

// 一般回傳
@Get(':id')
async findOne(@Param('id') id: string): Promise<HpcResponse<ExampleResponseDto>> {
  const result = await this.service.findById(id);
  return new HpcResponse(result);
}

// 分頁回傳
@Get()
async findList(@Query() query: PaginationQueryDto): Promise<HpcResponse<Pageable<ExampleResponseDto>>> {
  const { data, total } = await this.service.findList(query);
  return new HpcResponse<Pageable<ExampleResponseDto>>({
    data,
    allPage: Math.ceil(total / query.pageLimit),
    currentPage: query.currentPage,
    pageLimit: query.pageLimit,
  });
}
```

`Pageable<T>` 結構：`{ data: T[], allPage: number, currentPage: number, pageLimit: number }`

## Entity 稽核欄位

所有實體必須包含稽核欄位。關鍵規則：

- `*_ms` 欄位：`type: 'bigint'`，TypeScript 型別為 `string`（避免精度問題）
- `*_datetime` 欄位：`GENERATED ALWAYS` 欄位，必須設 `insert: false, update: false`
- 停用欄位（`deactivation_ms`、`deactivated_by`）為 `nullable: true`

```typescript
@Entity('example_record')
export class ExampleRecord {
  @PrimaryGeneratedColumn('uuid', { name: 'record_id' })
  recordId: string;

  @Column({ name: 'is_active', default: true })
  isActive: boolean;

  // --- 業務欄位 ---

  @Column({ length: 50 })
  code: string;

  // --- Audit Fields ---

  @Column({ name: 'creation_ms', type: 'bigint' })
  creationMs: string;

  @Column({ name: 'creation_datetime', type: 'timestamptz', insert: false, update: false })
  creationDatetime: Date;

  @Column({ name: 'created_by', length: 255 })
  createdBy: string;

  @Column({ name: 'last_update_ms', type: 'bigint' })
  lastUpdateMs: string;

  @Column({ name: 'last_update_datetime', type: 'timestamptz', insert: false, update: false })
  lastUpdateDatetime: Date;

  @Column({ name: 'last_updated_by', length: 255 })
  lastUpdatedBy: string;

  @Column({ name: 'deactivation_ms', type: 'bigint', nullable: true })
  deactivationMs: string;

  @Column({ name: 'deactivation_datetime', type: 'timestamptz', nullable: true, insert: false, update: false })
  deactivationDatetime: Date;

  @Column({ name: 'deactivated_by', length: 255, nullable: true })
  deactivatedBy: string;
}
```

## 停用（Soft Delete）

**不使用物理刪除**。停用操作：設 `isActive = false` + 填入 `deactivationMs` / `deactivatedBy`。
查詢時一律加 `where: { isActive: true }`。

```typescript
async deactivate(id: string, deactivatedBy: string, manager: EntityManager = this.repo.manager): Promise<void> {
  const record = await manager.findOne(ExampleRecord, { where: { recordId: id } });
  if (!record) throw new NotFoundException(`Record ${id} not found`);
  record.isActive = false;
  record.deactivatedBy = deactivatedBy;
  record.deactivationMs = Date.now().toString();
  record.lastUpdatedBy = deactivatedBy;
  record.lastUpdateMs = Date.now().toString();
  await manager.save(record);
}
```

## Store 層骨架

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryRunner, DataSource, EntityManager } from 'typeorm';
import { DatabaseErrorHandler } from '@his/hpc-nest-common';

@Injectable()
export class ExampleStore {
  constructor(
    @InjectRepository(ExampleRecord)
    private readonly repo: Repository<ExampleRecord>,
    private readonly dataSource: DataSource,
  ) {}

  createQueryRunner(): QueryRunner {
    return this.dataSource.createQueryRunner();
  }

  async findById(id: string): Promise<ExampleRecord | null> {
    try {
      return await this.repo.findOne({ where: { recordId: id, isActive: true } });
    } catch (error) {
      throw DatabaseErrorHandler.toHttpException(error);
    }
  }

  async create(data: Partial<ExampleRecord>, manager: EntityManager = this.repo.manager): Promise<ExampleRecord> {
    try {
      const now = Date.now().toString();
      const entity = manager.create(ExampleRecord, {
        ...data,
        creationMs: now,
        lastUpdateMs: now,
      });
      return await manager.save(entity);
    } catch (error) {
      throw DatabaseErrorHandler.toHttpException(error, {
        UNIQUE_VIOLATION: '資料已存在',
        FOREIGN_KEY_VIOLATION: '關聯資源不存在',
      });
    }
  }

  async update(
    recordId: string,
    data: Partial<ExampleRecord>,
    lastUpdatedBy: string,
    manager: EntityManager = this.repo.manager,
  ): Promise<ExampleRecord> {
    try {
      const record = await manager.findOne(ExampleRecord, { where: { recordId, isActive: true } });
      if (!record) throw new NotFoundException(`Record ${recordId} not found`);
      Object.assign(record, data);
      record.lastUpdateMs = Date.now().toString();
      record.lastUpdatedBy = lastUpdatedBy;
      return await manager.save(record);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw DatabaseErrorHandler.toHttpException(error);
    }
  }

  async createWithQueryRunner(qr: QueryRunner, data: Partial<ExampleRecord>): Promise<ExampleRecord> {
    return this.create(data, qr.manager);
  }
}
```

## DTO 範例

**Request DTO**（class-validator）：

```typescript
import { IsNotEmpty, IsString, IsOptional, MaxLength } from 'class-validator';

export class CreateExampleDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  code: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
```

**Response DTO**（class-transformer `@Expose()`）：

```typescript
import { Expose } from 'class-transformer';

export class ExampleResponseDto {
  @Expose() recordId: string;
  @Expose() code: string;
  @Expose() name: string;
  @Expose() isActive: boolean;
}
```

## 交易管理

Service 層使用 QueryRunner 管理交易：

```typescript
const qr = this.store.createQueryRunner();
await qr.connect();
await qr.startTransaction();
try {
  await this.store.createWithQueryRunner(qr, data);
  await qr.commitTransaction();
} catch (error) {
  await qr.rollbackTransaction();
  throw error;
} finally {
  await qr.release();
}
```

## 命名規範

| 類型           | 規則                         | 範例                       |
| -------------- | ---------------------------- | -------------------------- |
| 檔案           | `kebab-case` + 類型後綴      | `jwt-token.service.ts`     |
| 類別           | `PascalCase`                 | `JwtTokenService`          |
| 介面           | `I` 前綴 + `PascalCase`      | `IJwtPayload`              |
| 變數/屬性/方法 | `camelCase`                  | `accessToken`              |
| 常數           | `UPPER_SNAKE_CASE`           | `JWT_SECRET`               |
| Store 檔案     | `<feature>.store.ts`         | `example.store.ts`         |
| DTO 檔案       | `<action>-<resource>.dto.ts` | `create-example.dto.ts`    |
| Entity 檔案    | `<table-name>.entity.ts`     | `example-record.entity.ts` |

## 檔案放置慣例

| 檔案類型           | 放置位置                     | 說明                                |
| ------------------ | ---------------------------- | ----------------------------------- |
| Entity（共用）     | `src/shared/entities/`       | 所有 TypeORM 實體集中於此           |
| Store（共用）      | `src/shared/store/`          | 跨模組共用的 Store                  |
| Entity（模組專用） | `src/<module>/entities/`     | 僅該模組使用的實體                  |
| Controller         | `src/<module>/`              | 一個模組一個 controller             |
| Service            | `src/<module>/service/`      | 業務邏輯                            |
| Store              | `src/<module>/store/`        | 資料存取                            |
| Request DTO        | `src/<module>/dto/request/`  | 請求驗證 DTO                        |
| Response DTO       | `src/<module>/dto/response/` | 回應格式 DTO                        |
| 型別定義           | `src/<module>/type/`         | TypeScript interface / type         |
| 常數               | `src/<module>/constants/`    | 常數定義                            |
| 分頁 DTO           | `src/common/dto/`            | 共用 DTO（如 `PaginationQueryDto`） |
| 資料庫配置         | `src/datasource/`            | `datasource.module.ts`              |

## Commit Message 規範

使用 Conventional Commits 1.0：`<type>: <description>`

| Type       | 說明                     |
| ---------- | ------------------------ |
| `feat`     | 新功能                   |
| `fix`      | 錯誤修復                 |
| `docs`     | 文件變更                 |
| `style`    | 程式碼格式（不影響功能） |
| `refactor` | 重構                     |
| `test`     | 測試相關                 |
| `chore`    | 建置或輔助工具變更       |

範例：`feat: add authentication guard`、`fix: resolve token expiration issue`

## 共用模組

優先使用以下套件提供的功能，避免重複實作。

### `@his/hpc-nest-common` 常用 exports

| 分類           | Export                 | 用途                                                                     |
| -------------- | ---------------------- | ------------------------------------------------------------------------ |
| **核心模組**   | `HpcNestCommonModule`  | 必備，提供 Logger / Filter / Interceptor / Trace                         |
| **認證模組**   | `AuthModule`           | JWT 認證 + CSRF 防護                                                     |
| **認證守衛**   | `JwtTokenGuard`        | `@UseGuards(JwtTokenGuard)` 驗證 Bearer Token                            |
| **認證守衛**   | `CsrfHeaderGuard`      | `@UseGuards(CsrfHeaderGuard)` CSRF 防護                                  |
| **認證裝飾器** | `@RemoteUser()`        | Controller 參數裝飾器，注入 `RemoteUserInfo`                             |
| **認證裝飾器** | `@Public()`            | 標記公開路由，跳過 JWT 驗證                                              |
| **認證裝飾器** | `@SkipCsrf()`          | 跳過 CSRF 驗證                                                           |
| **認證型別**   | `RemoteUserInfo`       | JWT payload 型別（含 `sub`, `accountId`, `principal` 等）                |
| **快取模組**   | `CacheModule`          | Redis 連接管理                                                           |
| **快取服務**   | `RedisService`         | Redis Set / Sorted Set 操作，`RedisClient` 屬性可取得原始 ioredis 客戶端 |
| **追蹤**       | `TraceService`         | `getTraceId()` 取得當前請求 traceId                                      |
| **資料庫**     | `DatabaseErrorHandler` | Store 層資料庫錯誤轉 HttpException                                       |
| **啟動**       | `bootstrapTelemetry()` | main.ts 初始化 OpenTelemetry（須在 `NestFactory.create` 之前）           |
| **工具**       | `IpAddressUtil`        | IP 位址正規化、驗證、提取                                                |

### `@his/backend-types` 常用 exports

| Export           | 用途                                                  |
| ---------------- | ----------------------------------------------------- |
| `HpcResponse<T>` | Controller 回傳包裝：`new HpcResponse(data)`          |
| `Pageable<T>`    | 分頁結構：`{ data, allPage, currentPage, pageLimit }` |

### `@opentelemetry/api` Metrics

| Export      | 用途                      |
| ----------- | ------------------------- |
| `metrics`   | OpenTelemetry Metrics API |
| `Counter`   | 累積計數器（只增不減）    |
| `Histogram` | 分布統計（如回應時間）    |
| `Gauge`     | 當前值（如記憶體使用量）  |

### 認證使用範例

```typescript
import { JwtTokenGuard, Public, RemoteUser, RemoteUserInfo } from '@his/hpc-nest-common';

@Controller('examples')
@UseGuards(JwtTokenGuard)
export class ExampleController {
  @Get('profile')
  getProfile(@RemoteUser() user: RemoteUserInfo) {
    return new HpcResponse(user);
  }

  @Get('public-data')
  @Public()
  getPublicData() {
    return new HpcResponse({ message: 'no auth required' });
  }
}
```

### MetricsService 使用範例

```typescript
import { Injectable, ConsoleLogger } from '@nestjs/common';
import { MetricsService } from '../common/service/metrics.service';

@Injectable()
export class MyService {
  constructor(
    private readonly logger: ConsoleLogger,
    private readonly metricsService: MetricsService,
  ) {
    this.logger.setContext(MyService.name);
  }

  async performOperation(): Promise<void> {
    const startTime = Date.now();

    try {
      // 業務邏輯
      this.metricsService.incrementCounter('account_manager.operations.total', 1);

      // ... 執行操作

      this.metricsService.incrementCounter('account_manager.operations.success', 1);
    } catch (error) {
      this.metricsService.incrementCounter('account_manager.operations.errors', 1);
      throw error;
    } finally {
      this.metricsService.recordHistogram('account_manager.operations.duration', Date.now() - startTime);
    }
  }
}
```

## 檢查清單

### 必須遵守

- [ ] 遵循 TDD（測試驅動開發）流程，先撰寫測試再實作功能
- [ ] SOLID 原則設計程式碼
- [ ] 日誌用注入 `ConsoleLogger`，不用 `new Logger()`
- [ ] Controller 回傳用 `new HpcResponse(data)`
- [ ] Store 用 `DatabaseErrorHandler` 處理資料庫錯誤
- [ ] Entity `*_datetime` 欄位設 `insert: false, update: false`
- [ ] BIGINT 欄位 TypeScript 型別為 `string`
- [ ] 查詢加 `isActive: true` 過濾
- [ ] 優先用 `@his/hpc-nest-common` 和 `@his/backend-types`
- [ ] 使用 TypeORM Repository 方法，避免原生 SQL

### 建議做法

- 可使用 Context7 MCP 等外部工具取得最新技術資訊與範例

### 禁止事項

- [ ] 不可在 Controller 放業務邏輯或 try-catch
- [ ] 不可在 Store 放業務邏輯
- [ ] 不可使用 `--no-verify` 跳過 Git hooks
- [ ] 不可使用物理刪除（DELETE），一律用停用模式
- [ ] 不可忽略 TypeScript 型別錯誤
