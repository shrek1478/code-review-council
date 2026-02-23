# 安全性修正設計文件

日期：2026-02-23
來源：crc codebase 自動審查報告（Copilot + Claude Decision Maker）

## 背景

工具對自身進行 codebase 審查後，Decision Maker 確認以下問題需要修正。
部署情境為**純本機開發工具（localhost only）**，已排除對外暴露場景。

---

## 已確認無需修改（已實作）

- **CWD 設定檔載入警告**（`src/config/config.service.ts:58-61`）：已有 `logger.warn`，符合 Decision Maker ✏️ 要求。
- **`setMaxListeners` 說明註解**（`src/cli.ts:30-33`）：已有詳細計算說明，符合 ✏️ 要求。
- **WebSocket URL 使用 `location.host`**（`apps/web/src/app/core/services/api.service.ts:119`）：純本機工具，`location.host` 即 localhost，無反向代理風險，不修改。

---

## 修正項目

### A. `listDirectory` 限制為 home 目錄以下

**檔案**：`apps/api/src/filesystem/filesystem.controller.ts`
**問題**：端點允許列出任意目錄（包括 `/etc`、`/root`），未限制存取範圍。
**修正**：解析路徑後，驗證是否在 `defaultRoot`（`homedir()`）以下；若否，拋出 `ForbiddenException`。

```typescript
import { sep } from 'node:path';
import { ForbiddenException } from '@nestjs/common';

const targetPath = resolve(dirPath || this.defaultRoot);
if (!targetPath.startsWith(this.defaultRoot + sep) && targetPath !== this.defaultRoot) {
  throw new ForbiddenException('Access outside home directory is not allowed');
}
```

---

### B. `saveConfig` 防禦性路徑驗證

**檔案**：`apps/api/src/filesystem/filesystem.controller.ts`
**問題**：路徑雖已硬編碼，但缺乏防禦性斷言（Deep Defense）。
**修正**：加入 `basename` 驗證，確保寫入目標一定是 `review-council.config.json`。

```typescript
import { basename } from 'node:path';
import { ForbiddenException } from '@nestjs/common';

if (basename(configPath) !== 'review-council.config.json') {
  throw new ForbiddenException('Invalid config path');
}
```

---

### C. CORS 限制為 localhost

**檔案**：`apps/api/src/main.ts`
**問題**：`app.enableCors()` 無任何限制，允許所有跨域來源。
**修正**：限制為 localhost 任意 port。

```typescript
app.enableCors({ origin: /^http:\/\/localhost(:\d+)?$/, credentials: true });
```

---

### D. `ConfigController.validateConfig` 重用 ConfigService 邏輯

**檔案**：
- `src/config/config.service.ts`：將私有 `validateConfig` 包裝為 `public validateConfigData(config, source): { valid: boolean; error?: string }`
- `apps/api/src/config/config.controller.ts`：呼叫 `configService.validateConfigData()`

**問題**：`ConfigController` 有自訂的簡化驗證邏輯，與 `ConfigService` 的完整驗證不一致。
**修正**：新增公開包裝方法，`ConfigController` 直接呼叫，避免重複邏輯。

---

### E. WebSocket 訊息結構驗證

**檔案**：`apps/api/src/review/review.gateway.ts`
**問題**：JSON parse 成功後，未驗證 `event` 與 `data` 的型別，可能導致執行時錯誤。
**修正**：在 `handleConnection` 中 parse 後加入結構驗證。

```typescript
if (typeof msg.event !== 'string' || !msg.event ||
    typeof msg.data !== 'object' || msg.data === null || Array.isArray(msg.data)) {
  this.send(client, 'error', { message: 'Invalid message format' });
  return;
}
```

---

### F. `while` 迴圈改用 UUID 後綴

**檔案**：`apps/web/src/app/features/review/reviewer-selector.component.ts`
**問題**：`while` 迴圈搜尋可用名稱，雖然實際上有界，但有無限迴圈的潛在風險。
**修正**：直接附加 UUID 前 8 碼作為後綴，保證唯一性且無迴圈風險。

```typescript
if (existingNames.has(name)) {
  name = `${name} (${crypto.randomUUID().slice(0, 8)})`;
}
```

---

### G. 自訂 glob 匹配改用 minimatch

**檔案**：`src/review/code-reader.service.ts`
**問題**：自訂的 glob 正規表示式可能與標準 glob 行為不一致（邊緣案例）。
**修正**：以 `minimatch`（已在 `node_modules` 中）取代 `globMatch` 私有方法。

```typescript
import { minimatch } from 'minimatch';
// 取代 this.globMatch(normalized, pattern)
minimatch(normalized, pattern, { dot: true })
```

---

## 影響範圍

| 檔案 | 變更類型 |
|------|---------|
| `apps/api/src/filesystem/filesystem.controller.ts` | 安全性修正（A、B） |
| `apps/api/src/main.ts` | 安全性修正（C） |
| `src/config/config.service.ts` | 新增公開方法（D） |
| `apps/api/src/config/config.controller.ts` | 重構呼叫（D） |
| `apps/api/src/review/review.gateway.ts` | 輸入驗證（E） |
| `apps/web/src/app/features/review/reviewer-selector.component.ts` | 程式碼品質（F） |
| `src/review/code-reader.service.ts` | 程式碼品質（G） |

## 測試策略

- 現有單元測試（`npm run test`）必須全數通過
- `listDirectory` 手動驗證：嘗試存取 `/etc` 應回傳 403
- `saveConfig` 手動驗證：正常儲存仍可運作
- CORS 手動驗證：非 localhost origin 應被拒絕
