import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { Role, type TenantContext } from '../../shared/types/auth';
import { fail } from '../../shared/types/api';

const VALID_ROLES = new Set<string>(Object.values(Role));

/**
 * 从 Authorization 请求头中提取租户上下文。
 *
 * 支持两种格式：
 *   1. 原始 JSON 字符串：{"userId":"u1","orgId":"ORG_ENERGIA_001","role":"ORG_MANAGER"}
 *   2. JWT 风格令牌：header.payload.signature（payload 为 Base64 编码的 JSON，
 *      包含 userId、orgId、role 声明）
 *
 * 失败时抛出 { statusCode, message }。
 */
export function extractTenantContext(event: APIGatewayProxyEventV2): TenantContext {
  const token = event.headers?.['authorization'] ?? event.headers?.['Authorization'] ?? '';

  if (!token) {
    throw { statusCode: 401, message: 'Unauthorized' };
  }

  let claims: Record<string, unknown>;

  try {
    if (token.trim().startsWith('{')) {
      // 原始 JSON（本地测试用）
      claims = JSON.parse(token);
    } else {
      // JWT 风格：提取 payload 段
      const parts = token.replace(/^Bearer\s+/i, '').split('.');
      if (parts.length < 2) {
        throw new Error('malformed token');
      }
      const payload = Buffer.from(parts[1], 'base64').toString('utf-8');
      claims = JSON.parse(payload);
    }
  } catch {
    throw { statusCode: 401, message: 'Invalid token' };
  }

  const { userId, orgId, role } = claims as { userId?: string; orgId?: string; role?: string };

  if (!userId || !orgId || !role || !VALID_ROLES.has(role)) {
    throw { statusCode: 401, message: 'Invalid token' };
  }

  return { userId, orgId, role: role as Role };
}

/**
 * 强制执行基于角色的访问控制。
 * SOLFACIL_ADMIN 跳过所有角色检查。
 * 失败时抛出 { statusCode: 403, message: "Forbidden" }。
 */
export function requireRole(ctx: TenantContext, allowedRoles: Role[]): void {
  if (ctx.role === Role.SOLFACIL_ADMIN) return;
  if (!allowedRoles.includes(ctx.role)) {
    throw { statusCode: 403, message: 'Forbidden' };
  }
}

/** 构建标准 API Gateway 错误响应。 */
export function apiError(statusCode: number, message: string): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(fail(message)),
  };
}
