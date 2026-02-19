# VPP 批量模式更改功能设计方案

## 1. 现有架构分析

### 1.1 项目结构
```
├── index.html          # 主页面 (4个Section: Portfolio/Arbitragem/Ativos/Relatórios)
├── app.js              # 应用逻辑 (1354行, 含翻译系统/Mock数据/图表/实时更新)
├── style.css           # 样式 (1280行, 金融仪表盘设计系统)
├── presentation.html   # 演示入口页
└── demo-multilang.html # 多语言测试页
```

### 1.2 关键现有模块
| 模块 | 位置 | 描述 |
|------|------|------|
| 翻译系统 | `app.js:8-542` | `translations` 对象, `t()` 函数, `changeLanguage()` |
| Mock 数据 | `app.js:627-713` | `mockData.assets[]` 含4个站点 |
| 资产渲染 | `app.js:1105-1165` | `populateAssets()` 生成站点卡片 |
| 导航系统 | `app.js:755-791` | Section 切换, `navigateTo()` |
| Modal 系统 | `app.js:1309-1345` | 交易机会弹窗 (可复用模式) |
| 实时更新 | `app.js:1201-1304` | `startRealTimeUpdates()` 每5秒刷新 |

### 1.3 现有资产数据结构
```javascript
// app.js:628-693 - mockData.assets[] 中每个资产
{
    id: 'ASSET_SP_001',
    name: 'São Paulo - Casa Verde',
    region: 'SP',
    status: 'operando',        // 'operando' | 'carregando'
    investimento: 4200000,
    capacidade: 5.2,           // MWh
    unidades: 948,
    socMedio: 65,              // %
    receitaHoje: 18650,
    receitaMes: 412300,
    roi: 19.2,
    custoHoje: 4250,
    lucroHoje: 14400,
    payback: '3,8'
}
// 注意: 当前没有 "运行模式" 字段
```

---

## 2. UI/UX 设计方案

### 2.1 整体布局变更

在 **Ativos (资产管理)** 页面的现有结构中插入新的批量操作工具栏：

```
┌─────────────────────────────────────────────────────────┐
│ [header] SOLFACIL - Gestão de Ativos de Energia         │
├─────────────────────────────────────────────────────────┤
│ Portfólio | Arbitragem | ★Ativos | Relatórios          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│ 资产组合                          2,847 个活跃资产       │
│                                                         │
│ ┌─────────┬─────────┬─────────┬─────────┐              │
│ │投资总额  │总容量    │回收期   │内部收益率│  ← 现有统计  │
│ └─────────┴─────────┴─────────┴─────────┘              │
│                                                         │
│ ╔═══════════════════════════════════════════════════╗   │
│ ║ 🔧 批量操作工具栏 (新增)                            ║   │
│ ║                                                     ║   │
│ ║ ☑ 全选/取消   已选: 3/4 站点                        ║   │
│ ║                                                     ║   │
│ ║ 目标模式: [自发自用▾] [峰谷套利▾] [削峰▾]          ║   │
│ ║                                                     ║   │
│ ║ [🚀 批量下发模式]  [↻ 重置选择]                     ║   │
│ ╚═══════════════════════════════════════════════════╝   │
│                                                         │
│ ┌──────────────────┐  ┌──────────────────┐             │
│ │ ☑ São Paulo       │  │ ☑ Rio de Janeiro  │             │
│ │ [当前: 峰谷套利]   │  │ [当前: 自发自用]   │             │
│ │ 今日利润 R$14,400 │  │ 今日利润 R$12,530 │  ← 现有卡片  │
│ │ ROI 19.2%         │  │ ROI 17.8%         │    + checkbox │
│ │ ...               │  │ ...               │    + 模式标签 │
│ └──────────────────┘  └──────────────────┘             │
│                                                         │
│ ┌──────────────────┐  ┌──────────────────┐             │
│ │ ☐ Belo Horizonte  │  │ ☑ Curitiba        │             │
│ │ [当前: 峰谷套利]   │  │ [当前: 削峰模式]   │             │
│ │ ...               │  │ ...               │             │
│ └──────────────────┘  └──────────────────┘             │
└─────────────────────────────────────────────────────────┘
```

### 2.2 批量操作工具栏详细设计

```html
<!-- 新增区域: 插入在 .portfolio-overview 和 .sites-grid 之间 -->
<div class="batch-toolbar" id="batchToolbar">
    <!-- 第一行: 选择控制 -->
    <div class="batch-toolbar-row">
        <div class="batch-select-control">
            <label class="checkbox-wrapper">
                <input type="checkbox" id="selectAll">
                <span class="checkmark"></span>
                <span data-translate="select_all">全选</span>
            </label>
            <span class="batch-count" id="batchCount">
                已选: <strong>0</strong> / <strong>4</strong> 站点
            </span>
        </div>
        <button class="batch-reset-btn" id="batchReset" disabled>
            <span class="material-icons">refresh</span>
            <span data-translate="reset_selection">重置选择</span>
        </button>
    </div>

    <!-- 第二行: 模式选择 -->
    <div class="batch-toolbar-row">
        <div class="mode-selector" id="modeSelector">
            <span class="mode-selector-label" data-translate="target_mode">目标模式:</span>
            <div class="mode-options">
                <button class="mode-btn" data-mode="self_consumption">
                    <span class="material-icons">home</span>
                    <span data-translate="mode_self_consumption">自发自用</span>
                </button>
                <button class="mode-btn" data-mode="peak_valley_arbitrage">
                    <span class="material-icons">swap_vert</span>
                    <span data-translate="mode_peak_valley">峰谷套利</span>
                </button>
                <button class="mode-btn" data-mode="peak_shaving">
                    <span class="material-icons">compress</span>
                    <span data-translate="mode_peak_shaving">削峰模式</span>
                </button>
            </div>
        </div>
    </div>

    <!-- 第三行: 执行按钮 -->
    <div class="batch-toolbar-row batch-actions">
        <button class="batch-dispatch-btn" id="batchDispatch" disabled>
            <span class="material-icons">send</span>
            <span data-translate="batch_dispatch">批量下发模式</span>
        </button>
    </div>
</div>
```

### 2.3 站点卡片改造

在每个 `.site-card` 中新增：

```
┌─────────────────────────────────────────┐
│ ☑  São Paulo - Casa Verde    [🟢 卖出]  │  ← 新增 checkbox
│                                         │
│ [当前模式: 峰谷套利 ⚡]                  │  ← 新增模式标签
│                                         │
│ 今日利润    月度ROI     投资额   SoC均值  │
│ R$14,400   19.2%      R$4.2M   65%     │
│ 设备数量    回收期                        │
│ 948        3.8年                         │
│                                         │
│ ░░░░░░░░░░░░░░░░ 日进度 vs 目标          │
│ R$ 18.650 / R$ 20.000                   │
└─────────────────────────────────────────┘
```

### 2.4 三种运行模式定义

| 模式 | 图标 | 颜色 | 描述 | 策略逻辑 |
|------|------|------|------|----------|
| **自发自用** `self_consumption` | `home` | 🟢 绿色 `#059669` | 优先自用，多余才卖 | 储能优先供给本地负载，余电上网 |
| **峰谷套利** `peak_valley_arbitrage` | `swap_vert` | 🔵 蓝色 `#3730a3` | 全额买入/卖出 (VPP核心) | 谷时满充，峰时全放，最大化价差收益 |
| **削峰模式** `peak_shaving` | `compress` | 🟠 橙色 `#d97706` | 基于功率限制 | 限制峰值功率，避免需量电费罚款 |

### 2.5 确认弹窗设计

```
┌───────────────────────────────────────────┐
│ ⚡ 确认批量模式更改                        │
│                                           │
│ 您即将更改以下站点的运行模式:               │
│                                           │
│ 📍 São Paulo - Casa Verde                 │
│    峰谷套利 → 自发自用                     │
│ 📍 Rio de Janeiro - Copacabana            │
│    峰谷套利 → 自发自用                     │
│ 📍 Curitiba - Batel                       │
│    削峰模式 → 自发自用                     │
│                                           │
│ ⚠️ 模式更改将在下一个调度周期生效            │
│ 预计影响: 3 个站点 / 1,321 台设备           │
│                                           │
│ [✅ 确认下发]  [📋 查看详情]  [❌ 取消]      │
└───────────────────────────────────────────┘
```

### 2.6 执行进度弹窗设计

```
┌───────────────────────────────────────────┐
│ 🔄 批量模式下发中...                       │
│                                           │
│ 总进度: ████████████░░░░ 2/3              │
│                                           │
│ ✅ São Paulo - Casa Verde        成功      │
│    → 自发自用 (948 台设备已切换)            │
│                                           │
│ ⏳ Rio de Janeiro - Copacabana   执行中... │
│    → 自发自用 (进度: 65%)                  │
│    ░░░░░░░░░░░░░░ 65%                     │
│                                           │
│ ⏸  Curitiba - Batel             等待中    │
│    → 自发自用                              │
│                                           │
│ [关闭] (执行完成后可关闭)                   │
└───────────────────────────────────────────┘
```

### 2.7 执行结果弹窗

```
┌───────────────────────────────────────────┐
│ ✅ 批量模式更改完成                        │
│                                           │
│ 成功: 2/3 站点  |  失败: 1/3 站点          │
│                                           │
│ ✅ São Paulo - Casa Verde        成功      │
│ ✅ Rio de Janeiro - Copacabana   成功      │
│ ❌ Curitiba - Batel             失败      │
│    原因: 设备通信超时 (重试 3/3)           │
│                                           │
│ [🔄 重试失败项]  [📊 查看报告]  [✖ 关闭]   │
└───────────────────────────────────────────┘
```

---

## 3. 代码架构设计

### 3.1 文件修改清单

| 文件 | 修改类型 | 修改内容 |
|------|----------|----------|
| `index.html` | 修改 | 在 `#ativos` section 中插入批量工具栏 HTML + 新增确认/进度 Modal |
| `app.js` | 修改 | 新增批量操作模块 (~300行代码) |
| `style.css` | 修改 | 新增批量工具栏/模式标签/进度条样式 (~250行CSS) |

**不需要新增文件** — 保持当前单文件架构的一致性。

### 3.2 app.js 新增模块结构

```javascript
// ============================================
// 在 app.js 中新增以下模块 (按顺序)
// ============================================

// [模块1] 运行模式定义 (~30行)
// 位置: mockData 之后 (约 line 714)
const OPERATION_MODES = { ... };

// [模块2] 批量选择状态管理 (~40行)
// 位置: Global Variables 区块 (约 line 718)
const batchState = { ... };

// [模块3] 扩展 mockData.assets 数据结构 (~10行)
// 位置: mockData.assets 定义中
// 每个 asset 新增 operationMode 字段

// [模块4] 批量操作工具栏逻辑 (~80行)
// 位置: populateAssets() 之后
function initBatchToolbar() { ... }
function toggleAssetSelection(assetId) { ... }
function toggleSelectAll() { ... }
function updateBatchUI() { ... }
function selectMode(mode) { ... }
function resetBatchSelection() { ... }

// [模块5] 改造 populateAssets() (~30行修改)
// 位置: 现有 populateAssets() 函数中
// 添加 checkbox + 模式标签渲染

// [模块6] 批量下发流程 (~120行)
// 位置: Modal 区块之后
function startBatchDispatch() { ... }
function showConfirmModal() { ... }
function executeBatchDispatch() { ... }
function simulateAssetModeChange(asset, newMode) { ... }
function updateDispatchProgress(assetId, status, progress) { ... }
function showDispatchResult(results) { ... }
function retryFailedItems() { ... }

// [模块7] 翻译扩展 (~60行)
// 位置: translations 对象中, 每种语言新增 ~20 个 key
```

### 3.3 详细模块设计

#### 模块1: 运行模式定义

```javascript
// 插入位置: app.js, mockData 定义之后
const OPERATION_MODES = {
    self_consumption: {
        key: 'self_consumption',
        icon: 'home',
        color: '#059669',
        bgColor: '#ecfdf5',
        borderColor: '#a7f3d0'
    },
    peak_valley_arbitrage: {
        key: 'peak_valley_arbitrage',
        icon: 'swap_vert',
        color: '#3730a3',
        bgColor: '#eef2ff',
        borderColor: '#c7d2fe'
    },
    peak_shaving: {
        key: 'peak_shaving',
        icon: 'compress',
        color: '#d97706',
        bgColor: '#fffbeb',
        borderColor: '#fde68a'
    }
};
```

#### 模块2: 批量选择状态管理

```javascript
// 插入位置: 全局变量区块
const batchState = {
    selectedAssets: new Set(),   // 选中的资产 ID 集合
    targetMode: null,            // 目标模式 key
    isDispatching: false,        // 是否正在下发
    dispatchResults: []          // 下发结果
};
```

#### 模块3: 扩展资产数据

```javascript
// 修改: mockData.assets 中每个对象新增字段
{
    // ... 现有字段保持不变
    operationMode: 'peak_valley_arbitrage'  // 新增: 当前运行模式
}

// 具体默认值:
// ASSET_SP_001 (São Paulo):       'peak_valley_arbitrage'  (峰谷套利)
// ASSET_RJ_002 (Rio de Janeiro):  'self_consumption'        (自发自用)
// ASSET_MG_003 (Belo Horizonte):  'peak_valley_arbitrage'  (峰谷套利)
// ASSET_PR_004 (Curitiba):        'peak_shaving'            (削峰模式)
```

#### 模块4: 批量工具栏逻辑

```javascript
function initBatchToolbar() {
    // 绑定"全选" checkbox 事件
    // 绑定"重置" 按钮事件
    // 绑定模式选择按钮事件
    // 绑定"批量下发" 按钮事件
    // 初始化 UI 状态
}

function toggleAssetSelection(assetId) {
    // 切换单个资产的选中状态
    // 更新 batchState.selectedAssets
    // 更新全选 checkbox 状态 (全选/部分选/不选)
    // 调用 updateBatchUI()
}

function toggleSelectAll() {
    // 如果当前非全选 → 选中全部
    // 如果当前全选 → 取消全部
    // 更新所有卡片的 checkbox
    // 调用 updateBatchUI()
}

function updateBatchUI() {
    // 更新选中计数显示
    // 更新按钮启用/禁用状态:
    //   - 选中 > 0 且 targetMode != null → 启用"批量下发"
    //   - 选中 > 0 → 启用"重置"
    //   - 否则全部禁用
    // 更新选中卡片的视觉高亮
}

function selectMode(mode) {
    // 设置 batchState.targetMode = mode
    // 更新模式按钮的 active 状态
    // 调用 updateBatchUI()
}

function resetBatchSelection() {
    // 清空 batchState.selectedAssets
    // 清空 batchState.targetMode
    // 重置所有 checkbox
    // 重置模式按钮
    // 调用 updateBatchUI()
}
```

#### 模块5: 改造 populateAssets()

```javascript
function populateAssets() {
    const grid = document.getElementById('assetsGrid');
    if (!grid) return;

    mockData.assets.forEach(asset => {
        const card = document.createElement('div');
        card.className = 'site-card';
        card.setAttribute('data-asset-id', asset.id);

        const modeConfig = OPERATION_MODES[asset.operationMode];
        const isSelected = batchState.selectedAssets.has(asset.id);

        // ... 现有卡片内容 ...

        // 新增内容 (在 site-header 内):
        // 1. checkbox (在站点名称前)
        // 2. 当前模式标签 (在 site-header 和 site-metrics 之间)

        card.innerHTML = `
            <div class="site-header">
                <div class="site-name">
                    <label class="asset-checkbox-wrapper" onclick="event.stopPropagation()">
                        <input type="checkbox"
                               class="asset-checkbox"
                               data-asset-id="${asset.id}"
                               ${isSelected ? 'checked' : ''}
                               onchange="toggleAssetSelection('${asset.id}')">
                        <span class="asset-checkmark"></span>
                    </label>
                    <span class="material-icons asset-region-icon">location_on</span>
                    ${asset.name}
                </div>
                <div class="site-status ${statusClass}">
                    <span class="material-icons tiny-icon">${statusIcon}</span> ${statusText}
                </div>
            </div>

            <!-- 新增: 当前模式标签 -->
            <div class="asset-mode-badge"
                 style="background:${modeConfig.bgColor};
                        color:${modeConfig.color};
                        border:1px solid ${modeConfig.borderColor}">
                <span class="material-icons tiny-icon">${modeConfig.icon}</span>
                ${t('current_mode')}: ${t('mode_' + asset.operationMode)}
            </div>

            <div class="site-metrics">
                <!-- ... 现有 metrics 保持不变 ... -->
            </div>
            <!-- ... 现有 footer 保持不变 ... -->
        `;

        // 卡片点击事件 (点击卡片也能切换选中)
        card.addEventListener('click', (e) => {
            if (!e.target.closest('.asset-checkbox-wrapper')) {
                toggleAssetSelection(asset.id);
            }
        });

        grid.appendChild(card);
    });
}
```

#### 模块6: 批量下发流程

```javascript
function startBatchDispatch() {
    // 前置校验
    if (batchState.selectedAssets.size === 0 || !batchState.targetMode) return;

    // 过滤掉目标模式与当前模式相同的资产
    const assetsToChange = getAssetsToChange();
    if (assetsToChange.length === 0) {
        // 提示: 所有选中站点已在目标模式下
        return;
    }

    showConfirmModal(assetsToChange);
}

function getAssetsToChange() {
    return mockData.assets.filter(asset =>
        batchState.selectedAssets.has(asset.id) &&
        asset.operationMode !== batchState.targetMode
    );
}

function showConfirmModal(assetsToChange) {
    // 构建确认弹窗内容
    // 显示: 站点列表 + 模式变更方向 + 影响设备数量
    // 按钮: [确认下发] [取消]
    const modal = document.getElementById('batchConfirmModal');
    // ... 填充内容 ...
    modal.classList.add('show');
}

async function executeBatchDispatch() {
    // 关闭确认弹窗
    document.getElementById('batchConfirmModal').classList.remove('show');

    // 显示进度弹窗
    const progressModal = document.getElementById('batchProgressModal');
    progressModal.classList.add('show');

    batchState.isDispatching = true;
    batchState.dispatchResults = [];
    const assetsToChange = getAssetsToChange();

    // 初始化进度 UI
    renderProgressList(assetsToChange);

    // 逐个执行模式切换 (模拟异步过程)
    for (let i = 0; i < assetsToChange.length; i++) {
        const asset = assetsToChange[i];
        updateDispatchProgress(asset.id, 'executing', 0);

        const result = await simulateAssetModeChange(asset, batchState.targetMode);

        batchState.dispatchResults.push(result);
        updateDispatchProgress(asset.id, result.success ? 'success' : 'failed', 100);

        // 如果成功, 更新 mockData 中的模式
        if (result.success) {
            asset.operationMode = batchState.targetMode;
        }
    }

    batchState.isDispatching = false;

    // 显示结果摘要
    showDispatchResult(batchState.dispatchResults);

    // 刷新资产卡片以反映新模式
    const grid = document.getElementById('assetsGrid');
    grid.innerHTML = '';
    populateAssets();
}

function simulateAssetModeChange(asset, newMode) {
    // 模拟异步API调用
    // 返回 Promise, 模拟 2-4 秒延迟
    // 90% 成功率, 10% 随机失败
    return new Promise((resolve) => {
        const duration = 2000 + Math.random() * 2000;
        const steps = 10;
        let currentStep = 0;

        const interval = setInterval(() => {
            currentStep++;
            const progress = Math.round((currentStep / steps) * 100);
            updateDispatchProgress(asset.id, 'executing', progress);

            if (currentStep >= steps) {
                clearInterval(interval);
                const success = Math.random() > 0.1; // 90% 成功率
                resolve({
                    assetId: asset.id,
                    assetName: asset.name,
                    fromMode: asset.operationMode,
                    toMode: newMode,
                    success: success,
                    error: success ? null : 'communication_timeout',
                    units: asset.unidades,
                    timestamp: new Date().toISOString()
                });
            }
        }, duration / steps);
    });
}

function updateDispatchProgress(assetId, status, progress) {
    // 更新进度弹窗中对应站点的状态
    const item = document.querySelector(`[data-progress-asset="${assetId}"]`);
    if (!item) return;

    const statusIcon = item.querySelector('.progress-status-icon');
    const progressBar = item.querySelector('.dispatch-progress-fill');
    const statusText = item.querySelector('.progress-status-text');

    // 更新图标
    if (status === 'executing') {
        statusIcon.textContent = 'sync';
        statusIcon.className = 'material-icons progress-status-icon spinning';
        statusText.textContent = `${progress}%`;
    } else if (status === 'success') {
        statusIcon.textContent = 'check_circle';
        statusIcon.className = 'material-icons progress-status-icon status-success';
        statusText.textContent = t('dispatch_success');
    } else if (status === 'failed') {
        statusIcon.textContent = 'error';
        statusIcon.className = 'material-icons progress-status-icon status-failed';
        statusText.textContent = t('dispatch_failed');
    } else if (status === 'waiting') {
        statusIcon.textContent = 'hourglass_empty';
        statusIcon.className = 'material-icons progress-status-icon status-waiting';
        statusText.textContent = t('dispatch_waiting');
    }

    // 更新进度条
    if (progressBar) {
        progressBar.style.width = `${progress}%`;
    }

    // 更新总进度
    updateOverallProgress();
}

function updateOverallProgress() {
    const total = getAssetsToChange().length;
    const completed = batchState.dispatchResults.length;
    const overallBar = document.getElementById('overallProgressFill');
    const overallText = document.getElementById('overallProgressText');

    if (overallBar) overallBar.style.width = `${(completed / total) * 100}%`;
    if (overallText) overallText.textContent = `${completed} / ${total}`;
}

function showDispatchResult(results) {
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    // 更新进度弹窗为结果视图
    // 显示成功/失败统计
    // 如果有失败项, 显示"重试失败项"按钮
}

function retryFailedItems() {
    const failedAssets = batchState.dispatchResults
        .filter(r => !r.success)
        .map(r => mockData.assets.find(a => a.id === r.assetId));

    // 重置失败项
    batchState.dispatchResults = batchState.dispatchResults.filter(r => r.success);

    // 重新执行失败项
    // (复用 executeBatchDispatch 逻辑)
}
```

---

## 4. 数据流设计

### 4.1 状态管理架构

```
┌─────────────────────────────────────────────────────┐
│                    batchState                        │
│  ┌──────────────────┐  ┌──────────────────────────┐ │
│  │ selectedAssets    │  │ targetMode               │ │
│  │ Set<assetId>     │  │ string | null            │ │
│  └────────┬─────────┘  └──────────┬───────────────┘ │
│           │                       │                  │
│  ┌────────┴──────────────────────┴───────────────┐  │
│  │              updateBatchUI()                    │  │
│  │  - 计数更新                                     │  │
│  │  - 按钮状态                                     │  │
│  │  - 卡片高亮                                     │  │
│  └───────────────────────────────────────────────┘  │
│                                                      │
│  ┌──────────────────┐  ┌──────────────────────────┐ │
│  │ isDispatching    │  │ dispatchResults          │ │
│  │ boolean          │  │ Array<ResultObj>         │ │
│  └──────────────────┘  └──────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### 4.2 数据流时序图

```
用户操作                     batchState              UI更新
  │                            │                       │
  │ 1. 点击 checkbox           │                       │
  ├──────────────────────────►│                       │
  │     toggleAssetSelection() │                       │
  │                            │ selectedAssets.add()  │
  │                            ├──────────────────────►│
  │                            │   updateBatchUI()     │
  │                            │   → 计数, 高亮, 按钮   │
  │                            │                       │
  │ 2. 选择模式                 │                       │
  ├──────────────────────────►│                       │
  │     selectMode()           │                       │
  │                            │ targetMode = mode     │
  │                            ├──────────────────────►│
  │                            │   → 模式按钮高亮       │
  │                            │   → 下发按钮启用       │
  │                            │                       │
  │ 3. 点击"批量下发"           │                       │
  ├──────────────────────────►│                       │
  │     startBatchDispatch()   │                       │
  │                            │ 过滤需更改的站点       │
  │                            ├──────────────────────►│
  │                            │   showConfirmModal()  │
  │                            │                       │
  │ 4. 确认                    │                       │
  ├──────────────────────────►│                       │
  │     executeBatchDispatch() │                       │
  │                            │ isDispatching = true  │
  │                            ├──────────────────────►│
  │                            │  显示进度弹窗          │
  │                            │                       │
  │                            │ 逐站点模拟切换         │
  │                            │  ┌───────────────┐    │
  │                            │  │ simulate...() │    │
  │                            │  │ 进度回调       │───►│ 进度条更新
  │                            │  │               │    │
  │                            │  │ resolve()     │    │
  │                            │  └───────────────┘    │
  │                            │                       │
  │                            │ asset.operationMode   │
  │                            │   = newMode           │
  │                            │                       │
  │                            │ dispatchResults.push()│
  │                            ├──────────────────────►│
  │                            │  showDispatchResult() │
  │                            │  populateAssets()     │
```

### 4.3 模式数据与 mockData 的联动

```javascript
// 模式切换成功后直接修改 mockData (Demo 场景, 无后端)
mockData.assets.find(a => a.id === assetId).operationMode = newMode;

// 然后重新渲染资产卡片
document.getElementById('assetsGrid').innerHTML = '';
populateAssets();
```

---

## 5. 用户操作流程

### 5.1 完整操作流程图

```
                            ┌──────────────┐
                            │  进入资产页面  │
                            └──────┬───────┘
                                   │
                       ┌───────────▼───────────┐
                       │  查看站点列表          │
                       │  (含模式标签 + checkbox) │
                       └───────────┬───────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
     ┌────────▼────────┐  ┌───────▼───────┐  ┌────────▼────────┐
     │ 单击 checkbox    │  │ 单击卡片       │  │ 点击"全选"       │
     │ 选中/取消单站点  │  │ 切换选中状态   │  │ 选中全部站点      │
     └────────┬────────┘  └───────┬───────┘  └────────┬────────┘
              │                    │                    │
              └────────────────────┼────────────────────┘
                                   │
                       ┌───────────▼───────────┐
                       │  选择目标运行模式       │
                       │  [自发自用][峰谷套利]   │
                       │  [削峰模式]            │
                       └───────────┬───────────┘
                                   │
                       ┌───────────▼───────────┐
                       │  "批量下发"按钮变为     │
                       │   可点击状态            │
                       └───────────┬───────────┘
                                   │
                       ┌───────────▼───────────┐
                       │  点击"批量下发模式"     │
                       └───────────┬───────────┘
                                   │
                       ┌───────────▼───────────┐
                       │  弹出确认窗口           │
                       │  显示变更详情           │
                       └──────┬───────┬────────┘
                              │       │
                     ┌────────▼┐  ┌──▼────────┐
                     │  确认    │  │   取消     │
                     └────┬───┘  └──────────┘
                          │            ↑
                          │        返回选择
                          │
              ┌───────────▼───────────┐
              │  显示执行进度弹窗       │
              │  逐站点执行模式切换     │
              │  实时进度条更新         │
              └───────────┬───────────┘
                          │
              ┌───────────▼───────────┐
              │  全部执行完毕          │
              └──────┬───────┬────────┘
                     │       │
            ┌────────▼┐  ┌──▼────────┐
            │ 全部成功 │  │ 部分失败   │
            └────┬───┘  └──┬────────┘
                 │         │
                 │    ┌────▼────────────┐
                 │    │ 显示失败原因     │
                 │    │ 提供"重试"按钮   │
                 │    └────┬────────────┘
                 │         │
                 └────┬────┘
                      │
              ┌───────▼────────────┐
              │  资产卡片刷新        │
              │  模式标签更新为新值  │
              │  选中状态重置        │
              └────────────────────┘
```

### 5.2 快捷操作路径

**最短路径 (3步):**
1. 点击"全选" → 2. 选择目标模式 → 3. 点击"批量下发" → 确认

**典型路径 (4步):**
1. 勾选2-3个站点 → 2. 选择目标模式 → 3. 点击"批量下发" → 4. 确认

---

## 6. HTML 新增结构

### 6.1 在 index.html 的 `#ativos` section 中插入

```html
<!-- 插入位置: .portfolio-overview 之后, .sites-grid 之前 -->

<!-- 批量操作工具栏 -->
<div class="batch-toolbar" id="batchToolbar">
    <div class="batch-toolbar-header">
        <div class="batch-toolbar-left">
            <label class="batch-checkbox-wrapper">
                <input type="checkbox" id="selectAllCheckbox">
                <span class="batch-checkmark"></span>
            </label>
            <span class="batch-label" data-translate="select_all">全选</span>
            <span class="batch-divider">|</span>
            <span class="batch-count">
                <span data-translate="selected">已选</span>:
                <strong id="selectedCount">0</strong> /
                <strong id="totalCount">4</strong>
                <span data-translate="sites">站点</span>
            </span>
        </div>
        <button class="batch-reset-btn" id="batchResetBtn" disabled>
            <span class="material-icons">refresh</span>
            <span data-translate="reset_selection">重置选择</span>
        </button>
    </div>

    <div class="batch-toolbar-body">
        <span class="mode-label" data-translate="target_mode">目标模式</span>
        <div class="mode-btn-group" id="modeBtnGroup">
            <button class="mode-btn mode-self-consumption" data-mode="self_consumption">
                <span class="material-icons">home</span>
                <div class="mode-btn-text">
                    <span class="mode-btn-title" data-translate="mode_self_consumption">自发自用</span>
                    <span class="mode-btn-desc" data-translate="mode_self_desc">优先自用, 多余才卖</span>
                </div>
            </button>
            <button class="mode-btn mode-peak-valley" data-mode="peak_valley_arbitrage">
                <span class="material-icons">swap_vert</span>
                <div class="mode-btn-text">
                    <span class="mode-btn-title" data-translate="mode_peak_valley">峰谷套利</span>
                    <span class="mode-btn-desc" data-translate="mode_pv_desc">全额买入/卖出 (VPP)</span>
                </div>
            </button>
            <button class="mode-btn mode-peak-shaving" data-mode="peak_shaving">
                <span class="material-icons">compress</span>
                <div class="mode-btn-text">
                    <span class="mode-btn-title" data-translate="mode_peak_shaving">削峰模式</span>
                    <span class="mode-btn-desc" data-translate="mode_ps_desc">功率限制, 避免罚款</span>
                </div>
            </button>
        </div>
    </div>

    <div class="batch-toolbar-footer">
        <button class="batch-dispatch-btn" id="batchDispatchBtn" disabled>
            <span class="material-icons">send</span>
            <span data-translate="batch_dispatch">批量下发模式</span>
        </button>
    </div>
</div>
```

### 6.2 新增 Modal (确认 + 进度)

```html
<!-- 批量确认 Modal -->
<div id="batchConfirmModal" class="modal">
    <div class="modal-content modal-batch-confirm">
        <h2>
            <span class="material-icons modal-icon" style="color:#d97706">bolt</span>
            <span data-translate="confirm_batch_change">确认批量模式更改</span>
        </h2>
        <div class="modal-body">
            <p data-translate="confirm_batch_desc">您即将更改以下站点的运行模式:</p>
            <div class="batch-change-list" id="batchChangeList">
                <!-- 动态填充 -->
            </div>
            <div class="batch-impact-box" id="batchImpactBox">
                <!-- 影响摘要 -->
            </div>
        </div>
        <div class="modal-actions">
            <button class="btn-accept" onclick="executeBatchDispatch()">
                <span class="material-icons">check_circle</span>
                <span data-translate="confirm_dispatch">确认下发</span>
            </button>
            <button class="btn-reject" onclick="closeBatchConfirmModal()">
                <span class="material-icons">cancel</span>
                <span data-translate="cancel">取消</span>
            </button>
        </div>
    </div>
</div>

<!-- 批量进度 Modal -->
<div id="batchProgressModal" class="modal">
    <div class="modal-content modal-batch-progress">
        <h2>
            <span class="material-icons modal-icon spinning" style="color:#3730a3" id="progressIcon">sync</span>
            <span id="progressTitle" data-translate="batch_dispatching">批量模式下发中...</span>
        </h2>
        <div class="modal-body">
            <!-- 总进度 -->
            <div class="overall-progress">
                <span data-translate="overall_progress">总进度</span>:
                <span id="overallProgressText">0 / 0</span>
                <div class="progress-bar overall-progress-bar">
                    <div class="progress-fill overall-progress-fill" id="overallProgressFill" style="width:0%"></div>
                </div>
            </div>
            <!-- 逐站点进度列表 -->
            <div class="dispatch-progress-list" id="dispatchProgressList">
                <!-- 动态填充 -->
            </div>
        </div>
        <div class="modal-actions" id="progressActions">
            <button class="btn-view" id="closeProgressBtn" onclick="closeProgressModal()" disabled>
                <span class="material-icons">close</span>
                <span data-translate="close">关闭</span>
            </button>
            <button class="btn-accept" id="retryBtn" onclick="retryFailedItems()" style="display:none">
                <span class="material-icons">refresh</span>
                <span data-translate="retry_failed">重试失败项</span>
            </button>
        </div>
    </div>
</div>
```

---

## 7. CSS 新增样式

### 7.1 批量工具栏样式

```css
/* ============================================
   Batch Operations Toolbar
   ============================================ */
.batch-toolbar {
    background: white;
    border-radius: 12px;
    padding: 1.25rem 1.5rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    margin-bottom: 1.5rem;
    border: 2px solid #e2e8f0;
    transition: border-color 0.3s ease;
}

.batch-toolbar.has-selection {
    border-color: #3730a3;
    box-shadow: 0 2px 8px rgba(55, 48, 163, 0.1);
}

.batch-toolbar-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid #f1f5f9;
}

.batch-toolbar-left {
    display: flex;
    align-items: center;
    gap: 0.75rem;
}

.batch-count {
    font-size: 0.9rem;
    color: #64748b;
}

.batch-count strong {
    color: #3730a3;
    font-size: 1.1rem;
}

.batch-divider {
    color: #e2e8f0;
    font-size: 1.2rem;
}

.batch-reset-btn {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.4rem 0.8rem;
    border: 1px solid #e2e8f0;
    background: white;
    border-radius: 6px;
    font-size: 0.85rem;
    color: #64748b;
    cursor: pointer;
    transition: all 0.2s ease;
}

.batch-reset-btn:hover:not(:disabled) {
    border-color: #dc2626;
    color: #dc2626;
}

.batch-reset-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}

.batch-reset-btn .material-icons {
    font-size: 1rem;
}
```

### 7.2 模式选择按钮样式

```css
/* Mode Button Group */
.batch-toolbar-body {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
}

.mode-label {
    font-size: 0.85rem;
    font-weight: 600;
    color: #475569;
    white-space: nowrap;
}

.mode-btn-group {
    display: flex;
    gap: 0.75rem;
    flex: 1;
}

.mode-btn {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    border: 2px solid #e2e8f0;
    background: white;
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.3s ease;
}

.mode-btn:hover {
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.mode-btn .material-icons {
    font-size: 1.5rem;
    opacity: 0.6;
}

.mode-btn-text {
    display: flex;
    flex-direction: column;
}

.mode-btn-title {
    font-weight: 600;
    font-size: 0.9rem;
    color: #334155;
}

.mode-btn-desc {
    font-size: 0.75rem;
    color: #94a3b8;
}

/* Mode button active states */
.mode-btn.active.mode-self-consumption {
    border-color: #059669;
    background: #ecfdf5;
}
.mode-btn.active.mode-self-consumption .material-icons {
    color: #059669;
    opacity: 1;
}

.mode-btn.active.mode-peak-valley {
    border-color: #3730a3;
    background: #eef2ff;
}
.mode-btn.active.mode-peak-valley .material-icons {
    color: #3730a3;
    opacity: 1;
}

.mode-btn.active.mode-peak-shaving {
    border-color: #d97706;
    background: #fffbeb;
}
.mode-btn.active.mode-peak-shaving .material-icons {
    color: #d97706;
    opacity: 1;
}
```

### 7.3 批量下发按钮样式

```css
/* Batch Dispatch Button */
.batch-toolbar-footer {
    display: flex;
    justify-content: flex-end;
}

.batch-dispatch-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 2rem;
    background: linear-gradient(135deg, #3730a3, #4c1d95);
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s ease;
}

.batch-dispatch-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, #4338ca, #5b21b6);
    box-shadow: 0 4px 16px rgba(55, 48, 163, 0.35);
    transform: translateY(-1px);
}

.batch-dispatch-btn:disabled {
    background: #cbd5e1;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
}

.batch-dispatch-btn .material-icons {
    font-size: 1.2rem;
}
```

### 7.4 资产卡片 Checkbox 样式

```css
/* Asset Card Checkbox */
.asset-checkbox-wrapper {
    display: inline-flex;
    align-items: center;
    cursor: pointer;
    margin-right: 0.25rem;
}

.asset-checkbox {
    display: none;
}

.asset-checkmark {
    width: 20px;
    height: 20px;
    border: 2px solid #cbd5e1;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s ease;
    flex-shrink: 0;
}

.asset-checkbox:checked + .asset-checkmark {
    background: #3730a3;
    border-color: #3730a3;
}

.asset-checkbox:checked + .asset-checkmark::after {
    content: '✓';
    color: white;
    font-size: 0.75rem;
    font-weight: 700;
}

.site-card.selected {
    border: 2px solid #3730a3;
    background: #fafaff;
}

.site-card {
    cursor: pointer;
    border: 2px solid transparent;
}
```

### 7.5 模式标签样式

```css
/* Asset Mode Badge */
.asset-mode-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.3rem 0.75rem;
    border-radius: 6px;
    font-size: 0.8rem;
    font-weight: 600;
    margin-bottom: 0.75rem;
}

.asset-mode-badge .material-icons {
    font-size: 0.9rem;
}
```

### 7.6 进度弹窗样式

```css
/* Batch Progress Modal */
.modal-batch-progress .modal-content,
.modal-batch-confirm .modal-content {
    max-width: 580px;
}

.overall-progress {
    margin-bottom: 1.25rem;
    font-size: 0.9rem;
    color: #475569;
}

.overall-progress-bar {
    margin-top: 0.5rem;
    height: 10px;
}

.overall-progress-fill {
    transition: width 0.5s ease;
}

.dispatch-progress-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.dispatch-progress-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    background: #f8fafc;
    border-radius: 8px;
    transition: background 0.3s ease;
}

.dispatch-progress-item.success { background: #ecfdf5; }
.dispatch-progress-item.failed { background: #fef2f2; }

.progress-status-icon {
    font-size: 1.5rem;
    flex-shrink: 0;
}

.progress-status-icon.spinning {
    animation: spin 1s linear infinite;
    color: #3730a3;
}

.progress-status-icon.status-success { color: #059669; }
.progress-status-icon.status-failed { color: #dc2626; }
.progress-status-icon.status-waiting { color: #94a3b8; }

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}

.dispatch-item-info {
    flex: 1;
}

.dispatch-item-name {
    font-weight: 600;
    font-size: 0.9rem;
    color: #1e293b;
}

.dispatch-item-detail {
    font-size: 0.8rem;
    color: #64748b;
}

.dispatch-item-progress {
    width: 80px;
}

.dispatch-item-progress .progress-bar {
    height: 6px;
}

.progress-status-text {
    font-size: 0.8rem;
    font-weight: 600;
    white-space: nowrap;
}

/* Batch Change List (Confirm Modal) */
.batch-change-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin: 1rem 0;
}

.batch-change-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    background: #f8fafc;
    border-radius: 6px;
    font-size: 0.9rem;
}

.batch-change-arrow {
    color: #3730a3;
    font-size: 1rem;
}

.batch-impact-box {
    padding: 0.75rem 1rem;
    background: #fffbeb;
    border: 1px solid #fde68a;
    border-radius: 8px;
    font-size: 0.85rem;
    color: #92400e;
    display: flex;
    align-items: center;
    gap: 0.5rem;
}
```

---

## 8. 翻译系统扩展

### 8.1 新增翻译键值

在 `translations` 对象的 `zh`、`en`、`pt` 中各新增以下键值:

```javascript
// 中文 (zh)
'select_all': '全选',
'selected': '已选',
'sites': '站点',
'reset_selection': '重置选择',
'target_mode': '目标模式',
'mode_self_consumption': '自发自用',
'mode_peak_valley': '峰谷套利',
'mode_peak_shaving': '削峰模式',
'mode_self_desc': '优先自用, 多余才卖',
'mode_pv_desc': '全额买入/卖出 (VPP)',
'mode_ps_desc': '功率限制, 避免罚款',
'batch_dispatch': '批量下发模式',
'current_mode': '当前模式',
'confirm_batch_change': '确认批量模式更改',
'confirm_batch_desc': '您即将更改以下站点的运行模式:',
'confirm_dispatch': '确认下发',
'cancel': '取消',
'batch_dispatching': '批量模式下发中...',
'overall_progress': '总进度',
'close': '关闭',
'retry_failed': '重试失败项',
'dispatch_success': '成功',
'dispatch_failed': '失败',
'dispatch_waiting': '等待中',
'batch_complete': '批量模式更改完成',
'batch_impact_warning': '模式更改将在下一个调度周期生效',
'affected_sites': '个站点',
'affected_units': '台设备',
'communication_timeout': '设备通信超时',
'all_in_target_mode': '所有选中站点已在目标模式下',
'success_count': '成功',
'failed_count': '失败',

// English (en)
'select_all': 'Select All',
'selected': 'Selected',
'sites': 'sites',
'reset_selection': 'Reset',
'target_mode': 'Target Mode',
'mode_self_consumption': 'Self-Consumption',
'mode_peak_valley': 'Peak-Valley Arbitrage',
'mode_peak_shaving': 'Peak Shaving',
'mode_self_desc': 'Self-use first, sell excess',
'mode_pv_desc': 'Full buy/sell (VPP)',
'mode_ps_desc': 'Power limit, avoid penalties',
'batch_dispatch': 'Batch Dispatch Mode',
'current_mode': 'Current Mode',
'confirm_batch_change': 'Confirm Batch Mode Change',
'confirm_batch_desc': 'You are about to change the operating mode for:',
'confirm_dispatch': 'Confirm Dispatch',
'cancel': 'Cancel',
'batch_dispatching': 'Batch Mode Dispatching...',
'overall_progress': 'Overall Progress',
'close': 'Close',
'retry_failed': 'Retry Failed',
'dispatch_success': 'Success',
'dispatch_failed': 'Failed',
'dispatch_waiting': 'Waiting',
'batch_complete': 'Batch Mode Change Complete',
'batch_impact_warning': 'Mode change takes effect next scheduling cycle',
'affected_sites': 'sites',
'affected_units': 'devices',
'communication_timeout': 'Communication timeout',
'all_in_target_mode': 'All selected sites are already in target mode',
'success_count': 'Success',
'failed_count': 'Failed',

// Português (pt)
'select_all': 'Selecionar Tudo',
'selected': 'Selecionados',
'sites': 'sites',
'reset_selection': 'Resetar',
'target_mode': 'Modo Alvo',
'mode_self_consumption': 'Autoconsumo',
'mode_peak_valley': 'Arbitragem Ponta-Fora Ponta',
'mode_peak_shaving': 'Corte de Pico',
'mode_self_desc': 'Prioridade ao autoconsumo',
'mode_pv_desc': 'Compra/venda total (VPP)',
'mode_ps_desc': 'Limite de potência, evitar multas',
'batch_dispatch': 'Despacho em Lote',
'current_mode': 'Modo Atual',
'confirm_batch_change': 'Confirmar Alteração em Lote',
'confirm_batch_desc': 'Você está prestes a alterar o modo de operação de:',
'confirm_dispatch': 'Confirmar Despacho',
'cancel': 'Cancelar',
'batch_dispatching': 'Despachando Modos em Lote...',
'overall_progress': 'Progresso Geral',
'close': 'Fechar',
'retry_failed': 'Tentar Novamente',
'dispatch_success': 'Sucesso',
'dispatch_failed': 'Falha',
'dispatch_waiting': 'Aguardando',
'batch_complete': 'Alteração em Lote Concluída',
'batch_impact_warning': 'Alteração entra em vigor no próximo ciclo',
'affected_sites': 'sites',
'affected_units': 'dispositivos',
'communication_timeout': 'Timeout de comunicação',
'all_in_target_mode': 'Todos os sites já estão no modo alvo',
'success_count': 'Sucesso',
'failed_count': 'Falha',
```

---

## 9. 技术实现注意事项

### 9.1 与现有代码的兼容性

| 关注点 | 处理策略 |
|--------|----------|
| `populateAssets()` 被 `changeLanguage()` 调用 | 重新渲染时需保留 `batchState.selectedAssets` 状态 |
| 实时更新 `startRealTimeUpdates()` | 批量操作进行中时 (`batchState.isDispatching`) 应暂停实时更新 |
| Modal 点击背景关闭 | 进度弹窗在执行中时不应允许关闭 |
| `changeLanguage()` 切换语言 | 需要在 `changeLanguage()` 中调用工具栏的翻译更新 |

### 9.2 DOMContentLoaded 初始化顺序

```javascript
document.addEventListener('DOMContentLoaded', function() {
    updateAllTranslations();
    setupNavigation();
    setCurrentDate();
    initializeRevenueCurveChart();
    initializeArbitrageChart();
    initializeRevenueTrendChart();
    initializeRevenueBreakdownChart();
    populateAssets();         // 现有: 渲染资产卡片 (含新的 checkbox + 模式标签)
    initBatchToolbar();       // 新增: 初始化批量工具栏事件
    populateTrades();
    startRealTimeUpdates();
});
```

### 9.3 边界情况处理

| 场景 | 处理方式 |
|------|----------|
| 选中站点已是目标模式 | 自动过滤, 不纳入下发; 如果全部已是目标模式, 弹出提示 |
| 下发过程中切换页面 | Modal 保持显示, 后台继续执行 |
| 下发过程中切换语言 | 弹窗内翻译实时更新 (通过 data-translate 属性) |
| 全部失败 | 显示结果, "重试失败项"按钮可见 |
| 部分失败后重试 | 仅重试失败项, 成功项保持不变 |
| 网络超时模拟 | `simulateAssetModeChange()` 中10%随机失败 |
| 正在下发时点击"全选/取消" | 工具栏在下发期间禁用交互 |

### 9.4 性能考虑

- 资产卡片重新渲染时使用 `innerHTML = ''` 清空再重建 (保持现有模式)
- 进度更新使用 `setInterval` 分步回调, 不阻塞主线程
- Modal DOM 元素预创建在 HTML 中, 而非动态创建

### 9.5 CSS 变量建议 (可选优化)

```css
:root {
    --mode-self: #059669;
    --mode-self-bg: #ecfdf5;
    --mode-self-border: #a7f3d0;
    --mode-pv: #3730a3;
    --mode-pv-bg: #eef2ff;
    --mode-pv-border: #c7d2fe;
    --mode-ps: #d97706;
    --mode-ps-bg: #fffbeb;
    --mode-ps-border: #fde68a;
}
```

---

## 10. 实施步骤建议

### Phase 1: 数据层 (~30分钟)
1. 扩展 `mockData.assets` — 添加 `operationMode` 字段
2. 定义 `OPERATION_MODES` 常量对象
3. 定义 `batchState` 状态对象
4. 扩展 `translations` 三语翻译

### Phase 2: UI层 — 静态 (~45分钟)
5. 在 `index.html` 中插入批量工具栏 HTML
6. 在 `index.html` 中插入两个新 Modal (确认 + 进度)
7. 在 `style.css` 中添加所有新样式

### Phase 3: 资产卡片改造 (~30分钟)
8. 改造 `populateAssets()` — 添加 checkbox + 模式标签
9. 处理 `changeLanguage()` 中的重新渲染兼容

### Phase 4: 交互逻辑 (~60分钟)
10. 实现 `initBatchToolbar()` 和选择逻辑
11. 实现 `toggleAssetSelection()` / `toggleSelectAll()` / `updateBatchUI()`
12. 实现 `selectMode()` / `resetBatchSelection()`

### Phase 5: 下发流程 (~60分钟)
13. 实现 `startBatchDispatch()` / `showConfirmModal()`
14. 实现 `executeBatchDispatch()` / `simulateAssetModeChange()`
15. 实现 `updateDispatchProgress()` / `showDispatchResult()`
16. 实现 `retryFailedItems()`

### Phase 6: 测试 & 优化 (~30分钟)
17. 全语言测试 (中/英/葡)
18. 边界情况测试
19. 响应式适配验证

**预估新增代码量:**
- `app.js`: +300 行
- `style.css`: +250 行
- `index.html`: +80 行
- **总计: ~630 行**
