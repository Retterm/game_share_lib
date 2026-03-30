# Retterm Game Share Lib

本目录承载游戏项目的本地共享模块原型，目标是让 `manager`、`server`、`frontend` 的通用能力先在本仓库内完成抽象与接入验证，再在后续大版本中迁移到独立共享仓库。

当前布局：

- `rust/retterm-game-server-modules`: server 侧共享能力，已覆盖 `console`、`filesystem`、`metrics/pushgateway`
- `rust/retterm-game-manager-modules`: manager 侧共享能力，已覆盖 `upload session`、`loki`、`pushgateway`、`grafana public dashboard`、`manager rules`
- `frontend/src`: 前端共享源代码，已覆盖 `panel props`、`api client`、`console/files/manager overview` 页面

## 接入原则

1. 共享库优先接管重复页面和重复能力模块，禁止为单个游戏继续保留重复实现。
2. 游戏项目只保留本游戏特有的配置、生命周期、业务字段和页面编排。
3. `palworld`、`minecraft`、`arma_reforger` 已开始共用 `manager rules` 与 `admin overview` 共享实现，后续新增页面也应优先沉淀到这里。

## 预期迁移方式

- `server`: 用共享库接管标准能力，游戏代码只保留游戏进程启动、安装和配置模型。
- `manager`: 用共享库处理日志/指标/文件上传/规则引擎等通用中间层，游戏代码只保留数据库模型和部署编排。
- `frontend`: 用共享库提供 API、hooks 和成熟页面，游戏前端优先用 wrapper 方式挂载共享页，只保留游戏专有配置表单。
