import express from 'express';
import cors from 'cors';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { handler as dashboardHandler } from '../src/bff/handlers/get-dashboard';
import { handler as assetsHandler } from '../src/bff/handlers/get-assets';
import { handler as revenueTrendHandler } from '../src/bff/handlers/get-revenue-trend';
import { handler as tradesHandler } from '../src/bff/handlers/get-trades';

type LambdaHandler = (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2>;

const PORT = 3000;

function makeStubEvent(method: string, path: string): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: '',
    headers: {},
    requestContext: {
      accountId: 'local',
      apiId: 'local',
      domainName: 'localhost',
      domainPrefix: 'localhost',
      http: {
        method,
        path,
        protocol: 'HTTP/1.1',
        sourceIp: '127.0.0.1',
        userAgent: 'local-server',
      },
      requestId: 'local-' + Date.now(),
      routeKey: `${method} ${path}`,
      stage: '$default',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    isBase64Encoded: false,
  };
}

function wrapHandler(handler: LambdaHandler, method: string, path: string) {
  return async (_req: express.Request, res: express.Response): Promise<void> => {
    const event = makeStubEvent(method, path);
    const result = await handler(event);

    const statusCode = typeof result === 'string' ? 200 : result.statusCode ?? 200;
    const body = typeof result === 'string' ? result : result.body ?? '';
    const headers = typeof result === 'string' ? {} : result.headers ?? {};

    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) {
        res.setHeader(key, String(value));
      }
    }

    res.status(statusCode).send(body);
  };
}

const app = express();

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
}));

app.get('/dashboard', wrapHandler(dashboardHandler, 'GET', '/dashboard'));
app.get('/assets', wrapHandler(assetsHandler, 'GET', '/assets'));
app.get('/revenue-trend', wrapHandler(revenueTrendHandler, 'GET', '/revenue-trend'));
app.get('/trades', wrapHandler(tradesHandler, 'GET', '/trades'));

app.listen(PORT, () => {
  console.log(`Local API Gateway emulator running at http://localhost:${PORT}`);
  console.log('Routes:');
  console.log('  GET /dashboard');
  console.log('  GET /assets');
  console.log('  GET /revenue-trend');
  console.log('  GET /trades');
});
