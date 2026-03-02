import { CostControls } from '../src';

async function main() {
  const controls = new CostControls({
    config: {
      rateLimitPerMinute: 5,
      dailyTokenBudget: 10_000,
      cacheTtlSeconds: 60
    }
  });

  const userId = 'user-123';
  const message = 'What is my portfolio performance?';

  // 1. Rate limit check
  const allowed = await controls.checkRateLimit(userId);
  if (!allowed) {
    console.log('Rate limited!');
    return;
  }

  // 2. Cache check
  const cached = await controls.getCachedResponse(userId, message);
  if (cached) {
    console.log('Cache hit:', cached);
    return;
  }

  // 3. Simulate AI response
  const response = 'Your portfolio is up 12.5% YTD.';
  const inputTokens = 15;
  const outputTokens = 10;

  // 4. Cache the response
  await controls.cacheResponse(userId, message, response);

  // 5. Track token usage
  const withinBudget = await controls.trackTokenUsage(
    userId,
    inputTokens,
    outputTokens
  );

  if (!withinBudget) {
    console.log('Token budget exceeded!');
    return;
  }

  console.log('Response:', response);
  console.log(
    'Daily usage:',
    await controls.getTokenUsage(userId, 'daily'),
    'tokens'
  );
}

main().catch(console.error);
