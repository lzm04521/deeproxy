# DeeProxy

一个将Ollama
API转换为OpenAI格式API的工具，帮助用户通过Ollama方式将其他AI工具接入GitHub
Copilot Chat。

## 功能特性

- 将Ollama API转换为OpenAI兼容格式
- 提供本地代理服务，监听指定端口
- 直接透传所有模型，可以在Copilot中对模型显示和隐藏
- 轻量级Tauri桌面应用

## 安装使用

### 前置要求

- Node.js 18+
- Rust (安装Tauri需要)
- pnpm

### 安装步骤

1. 克隆仓库

```bash
git clone https://github.com/wrtx-dev/deeproxy.git
cd deeproxy
```

2. 安装依赖

```bash
pnpm install
```

3. 运行开发模式

```bash
pnpm tauri dev
```

4. 构建应用

```bash
pnpm tauri build
```

## 详细配置说明

应用启动后，界面提供以下配置项：

### 1. 代理服务配置

- **监听地址**：本地服务监听地址 (默认: localhost)
  - 可设置为 0.0.0.0 允许局域网访问
  - 支持IPv4/IPv6地址格式
- **端口**：本地服务监听端口 (默认: 11484)
  - 范围: 1-65535
  - 确保端口未被占用

### 2. 目标API配置

- **API地址**：目标API基础地址 (示例: https://api.deepseek.com)
  - 需包含协议头(http/https)
  - 无需包含/v1等路径
- **API密钥**：目标API的访问密钥
  - 输入框支持密码隐藏
  - 配置后会自动验证有效性

### 3. 服务控制

- **保存**：应用配置变更
- **启动/重启**：使用当前保存配置(重新)获取Models列表并缓存，(重新)启动服务监听
- **停止**：停止代理服务
- 状态指示灯显示当前服务状态

## 技术架构

- **前端界面**：Preact + TypeScript + Vite
  - 轻量级响应式UI
  - 配置自动保存
- **后端服务**：Rust (Tauri)
  - 系统托盘支持
  - 后台服务管理
- **代理核心**：Axum + Hyper
  - 高性能API转换
  - 支持HTTP/HTTPS

## 许可证

本项目采用 [MIT License](LICENSE) 开源协议
