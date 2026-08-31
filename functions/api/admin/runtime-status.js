import { isHumanAdminHost } from '../../_host-policy.js';
import { requireAdmin } from '../../_auth.js';

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!isHumanAdminHost(request, { allowPreview: true })) {
    return reply({ error: 'FORBIDDEN_HOST', message: '관리자 호스트에서만 접근할 수 있습니다.' }, 403);
  }

  const auth = await requireAdmin(request, env);
  if (!auth.ok) {
    return reply({ error: auth.error, message: auth.message }, auth.status);
  }

  const rawToken = env?.GITHUB_TOKEN ? String(env.GITHUB_TOKEN).trim() : '';
  const githubTokenConfigured = rawToken.length > 0;

  let githubRepoRead = false;
  let githubHttpStatus = null;

  if (githubTokenConfigured) {
    try {
      const ghRes = await fetch('https://api.github.com/repos/snowshagal-bot/market-research-site/git/ref/heads/main', {
        headers: {
          'Authorization': `Bearer ${rawToken}`,
          'User-Agent': 'snowshagal-admin-diagnostic',
          'Accept': 'application/vnd.github+json'
        }
      });
      githubHttpStatus = ghRes.status;
      githubRepoRead = ghRes.status === 200;
    } catch (_) {
      githubRepoRead = false;
      githubHttpStatus = 500;
    }
  }

  const browserRenderingConfigured = Boolean(env?.CLOUDFLARE_BROWSER_RENDERING_TOKEN || env?.CLOUDFLARE_ACCOUNT_ID);
  const disclosureSyncKeyConfigured = Boolean(env?.DISCLOSURE_SYNC_KEY && String(env.DISCLOSURE_SYNC_KEY).trim().length > 0);
  const marketPublishKeyConfigured = Boolean(env?.MARKET_PUBLISH_KEY && String(env.MARKET_PUBLISH_KEY).trim().length > 0);

  return reply({
    ok: true,
    runtime: {
      githubTokenConfigured,
      githubRepoRead,
      githubHttpStatus,
      browserRenderingConfigured,
      disclosureSyncKeyConfigured,
      marketPublishKeyConfigured
    }
  }, 200);
}
