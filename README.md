# Cardo PAC

科学上网 PAC 文件以及生成器。通过自定义域名和 CNIP 地址段生成 PAC（Proxy Auto-Config）文件。对存在于自定义域名和解析出的 IP 不是 CNIP 的域名使用代理，对国内 IP 的域名直连，支持 IPv4/IPv6。

**此仓库每周四自动通过 GitHub Action 从 [Loyalsoldier/geoip](https://github.com/Loyalsoldier/geoip) 同步数据并更新 `cardo.pac` 文件，同时自动创建 Release。**

## 特性

### 核心功能
* **开箱即用**：预生成的 `cardo.pac` 包含常用直连/代理域名及国内 IPv4/IPv6 地址段，下载后修改第一行代理地址即可使用
* **IP 规则前置**：域名解析出的 IP 属于国内地址段时直接返回直连，流量不经过代理程序
* **纯 IP 地址正确处理**：使用 DoH 的 APP 可完全正常工作
* **不误伤**：仅添加高频访问域名，减少流量走向错误的概率
* **可自定义**：支持自定义代理域名、直连域名、本地 TLD
* **广泛兼容**：支持 iOS/macOS/Windows/Android、Chrome/Edge/Firefox；生成的 PAC 使用 ES5 语法，所有现代系统均可正常执行

### 性能优化
* **多级路由引擎**：6 层路由决策，从快到慢逐级匹配，最大化性能
  1. **IP 地址快速路径** — 直接 IP 访问跳过域名匹配，立即进入 CIDR 判断
  2. **本地域名快速路径** — 纯主机名、`localhost`、`.test` 等本地 TLD 直接返回直连
  3. **O(1) Hash 域名匹配** — 代理/直连域名使用 JavaScript Hash 对象精确匹配，子域名通过后缀循环匹配，复杂度仅 O(k)（k = 域名中的 `.` 数量）
  4. **TLD 启发式** — `.com`、`.org`、`.net` 等国外顶级域 99%+ 非国内站，直接走代理，跳过 DNS 解析
  5. **DNS + CIDR 保守策略** — 国内/未知 TLD（如 `.cn`）走 DNS 解析 + CIDR 地址段匹配
  6. **Radix Tree CIDR 匹配** — IP 段使用 Radix Tree 数据结构，时间复杂度 O(m)，m≤32（IPv4）或 ≤128（IPv6）
* **CIDR 压缩算法**：相邻 CIDR 前缀共享超过 50% 时自动压缩，PAC 文件体积减少约 20%（119KB → 96KB）

## 用法

### 方式一：直接使用（推荐）

下载 `cardo.pac`，将第一行的代理服务器地址替换为自己的即可：

```
var proxy = 'PROXY 127.0.0.1:8080; SOCKS5 127.0.0.1:1080; DIRECT;';
```

### 方式二：自定义生成

使用 `cardo.py` 生成自定义 PAC 文件，可按需调整代理/直连域名列表：

```
usage: cardo.py -f 输出的PAC文件名 -p 代理服务器 [-h]
                  [--proxy-domains 自定义使用代理域名的文件]
                  [--direct-domains 自定义直连域名的文件]
                  [--localtld-domains 本地TLD文件]
                  [--ip-file 从 Loyalsoldier/geoip release 下载的 cn.txt 文件]
```

**参数说明：**

| 参数 | 必需 | 说明 |
|------|------|------|
| `-f` | ✅ | 输出的 PAC 文件名 |
| `-p` | ✅ | 代理服务器，例如 `PROXY 192.168.1.1:3128; DIRECT;` |
| `--ip-file` | ✅ | 中国 IP 地址段文件（从 Loyalsoldier/geoip release 下载的 `cn.txt`） |
| `--proxy-domains` | | 代理域名文件或 URL，每行一个域名 |
| `--direct-domains` | | 直连域名文件或 URL，每行一个域名 |
| `--localtld-domains` | | 本地 TLD 规则文件或 URL，每行一个（以 `.` 开头，如 `.test`） |

> 💡 `--proxy-domains`、`--direct-domains`、`--localtld-domains` 均支持本地文件路径和远程 URL，远程 URL 会自动下载。

**示例：**

```bash
./cardo.py -f cardo.pac \
             -p "PROXY 192.168.1.200:3128; DIRECT" \
             --proxy-domains=proxy-domains.txt \
             --direct-domains=direct-domains.txt \
             --localtld-domains=local-tlds.txt \
             --ip-file=cidrs-cn.txt
```

## 自动化 CI/CD

本项目使用 GitHub Actions 实现全自动数据同步与发布：

### 自动生成 PAC（`auto-generate-pac.yml`）
- **触发条件**：每周四 UTC 0:10 / 核心文件变更时 push / 手动触发
- **流程**：
  1. 从 [Loyalsoldier/geoip](https://github.com/Loyalsoldier/geoip) 下载最新 `cn.txt`
  2. 运行 `cardo.py` 生成最新 `cardo.pac`
  3. 若文件有变化则自动提交并推送
  4. 触发自动发布流程

### 自动发布 Release（`auto-release.yml`）
- **触发条件**：`cardo.pac` 文件变更时 push / 手动触发
- **流程**：
  1. 自动生成语义化版本标签 `vYYYYMMDD.N`
  2. 创建 GitHub Release，附带最新 `cardo.pac` 文件

可以在 [Releases 页面](https://github.com/Cle2ment/cardo-pac/releases) 获取历史版本。

## 测试

项目包含 PAC 文件执行测试，用于验证生成的 `cardo.pac` 能正确执行并返回预期的代理配置：

```bash
node test_pac_execution.js
```

测试覆盖 32 个用例，包括：
- 直连域名精确/子域名匹配
- 代理域名精确/子域名匹配
- TLD 启发式（验证 `.com`/`.org`/`.io` 跳过 DNS 直接走代理）
- 国内/国外 IPv4 CIDR 匹配
- IPv6 地址处理
- 本地 TLD（`.localhost`、`.test`）
- 纯 IP 地址直连/代理判断

## 原理

### 为什么用 PAC 文件而不是代理工具的路由规则？

现代操作系统（macOS/iOS/Windows）底层网络框架会自动执行 PAC 策略，使得大多数应用的 HTTP 请求都能使用代理，而不仅限于浏览器。如果依赖代理工具的路由规则，所有流量都会进入代理程序，即使命中直连规则，网络流量也要经过代理程序转发，性能会受影响。而由系统网络框架先通过 PAC 文件决定用代理还是直连，直连流量不再经过代理程序，性能更好。

### 跟代理工具提供的 PAC 文件有什么不同？

维护 PAC 文件并不是代理工具的优先工作。一些代理工具提供的 PAC 文件在不断融合的过程中包含了广告过滤、隐私保护等太多内容，以及体积庞大到无人可维护的域名列表，年久失修导致容易漏掉或者误伤。另一个极端则是仅有很少的规则，大多数流量还是进入客户端，甚至不支持 IPv6。

Cardo PAC 仅添加访问频率最高的域名，可以明确知道哪些域名直连、哪些代理；域名列表没有的再通过 TLD 启发式或 IP 地址段匹配确认。多级路由引擎确保 99% 以上的国内流量不进入代理程序。

## 技巧

* 自行解决 DNS 污染问题
* 经常更新到包含最新数据的 PAC 文件（订阅 Release）
* 代理工具最好同时配置 GEOIP/GEOSITE 等路由规则（及时更新数据的前提下）

## 许可

[Apache License 2.0](LICENSE)

## 版权
Copyright (c) 2026 Cle2ment