# Shared Module Integration Plan

## 目标

共享库先覆盖所有游戏都必然存在的“控制平面能力”，不碰游戏特有流程：

- `websocket rpc`: 已存在，继续作为 manager <-> server 的基础通道
- `file management`: manager 侧上传/下载转发 + server 侧文件系统操作
- `console`: server 侧 backlog/stdin/stream + manager/front 侧消费
- `logs`: manager 侧 Loki 查询、会话枚举、tail 代理 + front 侧页面
- `performance`: server 侧采样 + pushgateway 上报事件 + manager 侧 Pushgateway/Grafana 公共逻辑

## 接入方式

### 1. Server 接入

`server` 只保留游戏特有部分：

- 安装器
- 启动命令生成
- 配置模型
- 生命周期状态字段

`server` 通过共享库接入标准能力：

- `ConsoleStore`
- `FsService`
- `MetricsCollector`

接入点：

- `AppState` 持有共享能力对象
- `rpc::dispatch` 把标准 RPC action 直接映射到共享服务
- `ws_manage` 继续沿用现有 websocket rpc，只转发共享服务产出的标准事件

### 2. Manager 接入

`manager` 只保留游戏特有部分：

- 数据库模型
- deploy/reconcile/protocol 编排
- game specific dashboard 定义

`manager` 通过共享库接入标准能力：

- `UploadSessionStore`
- `Loki` 查询助手
- `Pushgateway` 转发器
- `Grafana public dashboard` 公共 API 封装

接入点：

- `handlers.rs` 使用共享上传/日志 helper
- `online.rs` 在处理 server 事件时接管 `internal.pushgateway_metrics`
- `grafana.rs` 只保留 Palworld 自己的 dashboard JSON 定义，公共 API 调用下沉到共享库

### 3. Frontend 接入

`frontend` 只保留游戏特有部分：

- 页面路由
- 游戏配置表单
- 自定义展示文案

`frontend` 通过共享库接入标准能力：

- panel props 解析
- API client
- console/files/logs/metrics 的基础请求与 websocket 连接

接入点：

- 本地 `src/lib/api.ts` 作为薄适配层，调用共享 `createGamePanelApi`
- 后续 Arma/Minecraft 切换时，只需要替换本地 API 层和页面 hooks，不需要一起重做 UI 路由

## 迁移顺序

1. Palworld 先作为验证项目接入共享库
2. 下一次 Arma Reforger / Minecraft 大版本时，把现有实现逐步替换成共享模块
3. 等三个游戏都稳定使用后，再把 `game/share_lib` 整理到独立仓库
