#!/usr/bin/env node

const CHECK_NAME = 'Cloudflare Pages';
const APP_SLUG = 'cloudflare-workers-and-pages';
const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_MAX_ATTEMPTS = 36;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitForCloudflareDeployment({
  repository,
  sha,
  token,
  fetchImpl = fetch,
  sleepImpl = sleep,
  intervalMs = DEFAULT_INTERVAL_MS,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  logger = console
}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(repository || ''))) {
    throw new Error('A valid owner/repository is required.');
  }
  if (!/^[0-9a-f]{40}$/i.test(String(sha || ''))) throw new Error('A full 40-character commit SHA is required.');
  if (!token) throw new Error('GITHUB_TOKEN is required to read Cloudflare check-runs.');
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new Error('maxAttempts must be a positive integer.');
  if (!Number.isFinite(intervalMs) || intervalMs < 0) throw new Error('intervalMs must be non-negative.');

  const endpoint = `https://api.github.com/repos/${repository}/commits/${sha}/check-runs?filter=latest&per_page=100`;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchImpl(endpoint, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'user-agent': 'Snowshagal-Deployment-Smoke/1.0',
        'x-github-api-version': '2022-11-28'
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub check-runs API returned HTTP ${response.status}.`);
    }

    let payload;
    try { payload = await response.json(); }
    catch (error) { throw new Error(`GitHub check-runs API returned invalid JSON: ${error.message}`); }

    const runs = Array.isArray(payload?.check_runs) ? payload.check_runs : [];
    const deployment = runs.find(run => (
      run?.name === CHECK_NAME &&
      run?.app?.slug === APP_SLUG &&
      String(run?.head_sha || '').toLowerCase() === sha.toLowerCase()
    ));

    if (deployment?.status === 'completed') {
      if (deployment.conclusion !== 'success') {
        throw new Error(`Cloudflare deployment completed with conclusion=${deployment.conclusion || 'unknown'}.`);
      }
      const result = {
        id: String(deployment.external_id || deployment.id || ''),
        headSha: deployment.head_sha,
        detailsUrl: deployment.details_url || deployment.html_url || '',
        conclusion: deployment.conclusion
      };
      logger.log(`Cloudflare deployment SUCCESS for ${sha}. Deployment ID: ${result.id || '(unavailable)'}`);
      return result;
    }

    const status = deployment?.status || 'not-created';
    logger.log(`Waiting for Cloudflare deployment (${attempt}/${maxAttempts}, status=${status}, sha=${sha})`);
    if (attempt < maxAttempts) await sleepImpl(intervalMs);
  }

  throw new Error(`Timed out waiting for Cloudflare Pages check-run success for ${sha}. Production smoke was not started.`);
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (!['--repository', '--sha'].includes(arg)) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    values[arg.slice(2)] = value;
    index += 1;
  }
  return values;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/wait-for-cloudflare-deployment.mjs --repository owner/repo --sha <40-char-sha>');
    return;
  }

  try {
    await waitForCloudflareDeployment({
      repository: args.repository || process.env.GITHUB_REPOSITORY,
      sha: args.sha || process.env.GITHUB_SHA,
      token: process.env.GITHUB_TOKEN
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('wait-for-cloudflare-deployment.mjs')) {
  await main();
}
