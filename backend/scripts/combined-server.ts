/**
 * VPP 演示测试用的合并 HTTPS 服务器，无需 AWS 部署。
 * 提供：
 *   - /api/* 下的 API 路由（封装 Lambda handler）
 *   - / 下的静态前端文件
 * 使用现有自签名证书在端口 8443 上运行 HTTPS。
 */
import https from 'https';
import fs from 'fs';
import path from 'path';
import express from 'express';
import cors from 'cors';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { handler as dashboardHandler } from '../src/bff/handlers/get-dashboard';
import { handler as assetsHandler } from '../src/bff/handlers/get-assets';
import { handler as revenueTrendHandler } from '../src/bff/handlers/get-revenue-trend';
import { handler as tradesHandler } from '../src/bff/handlers/get-trades';

type LambdaHandler = (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;

const PORT = 8443;
const CERT_PATH = '/tmp/ashe_share/ssl/cert.pem';
const KEY_PATH  = '/tmp/ashe_share/ssl/key.pem';
const STATIC_ROOT = path.resolve(__dirname, '../../../');  // 项目根目录（前端）

// ── 辅助函数 ─────────────────────────────────────────────────────────────────

function makeStubEvent(method: string, rawPath: string): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: `${method} ${rawPath}`,
    rawPath,
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: 'local',
      apiId: 'local',
      domainName: 'localhost',
      domainPrefix: 'localhost',
      http: { method, path: rawPath, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'local' },
      requestId: `local-${Date.now()}`,
      routeKey: `${method} ${rawPath}`,
      stage: '$default',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
  };
}

function wrapHandler(handler: LambdaHandler) {
  return async (req: express.Request, res: express.Response) => {
    const result = await handler(makeStubEvent(req.method, req.path));
    const statusCode = typeof result === 'object' && 'statusCode' in result ? result.statusCode : 200;
    const body       = typeof result === 'object' && 'body' in result ? result.body : '';
    res.status(statusCode as number).set('Content-Type', 'application/json').send(body);
  };
}

// ── 应用 ──────────────────────────────────────────────────────────────────────

const app = express();

app.use(cors({ origin: '*' }));
app.use(express.json());

// API 路由
app.get('/api/dashboard',     wrapHandler(dashboardHandler));
app.get('/api/assets',        wrapHandler(assetsHandler));
app.get('/api/revenue-trend', wrapHandler(revenueTrendHandler));
app.get('/api/trades',        wrapHandler(tradesHandler));

// 静态前端（服务路径 /2026-02-15_SOLFACIL_VPP_Demo/）
app.use('/2026-02-15_SOLFACIL_VPP_Demo', express.static(STATIC_ROOT));

// 根路径重定向
app.get('/', (_req, res) => res.redirect('/2026-02-15_SOLFACIL_VPP_Demo/'));

// ── HTTPS 服务器 ─────────────────────────────────────────────────────────────

const credentials = {
  cert: fs.readFileSync(CERT_PATH),
  key:  fs.readFileSync(KEY_PATH),
};

https.createServer(credentials, app).listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ VPP Demo running at: https://152.42.235.155:${PORT}/2026-02-15_SOLFACIL_VPP_Demo/`);
  console.log(`📡 API endpoints:`);
  console.log(`   GET https://152.42.235.155:${PORT}/api/dashboard`);
  console.log(`   GET https://152.42.235.155:${PORT}/api/assets`);
  console.log(`   GET https://152.42.235.155:${PORT}/api/revenue-trend`);
  console.log(`   GET https://152.42.235.155:${PORT}/api/trades\n`);
});
