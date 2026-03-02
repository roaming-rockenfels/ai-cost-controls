/**
 * Example: Using ai-cost-controls with Vercel AI SDK.
 *
 * Prerequisites:
 *   npm install ai @ai-sdk/openai ai-cost-controls
 */

// import { streamText } from 'ai';
// import { openai } from '@ai-sdk/openai';
import { CostControls } from '../src';

const controls = new CostControls({
  config: {
    rateLimitPerMinute: 10,
    dailyTokenBudget: 50_000,
    cacheTtlSeconds: 300
  }
});

async function handleChat(userId: string, message: string): Promise<string> {
  // Rate limit
  if (!(await controls.checkRateLimit(userId))) {
    throw new Error('Too many requests. Please wait a moment.');
  }

  // Cache check
  const cached = await controls.getCachedResponse(userId, message);
  if (cached) return cached;

  // Call AI (uncomment with real AI SDK)
  // const result = await streamText({
  //   model: openai('gpt-4o'),
  //   messages: [{ role: 'user', content: message }],
  // });
  // const text = await result.text;
  // const { promptTokens, completionTokens } = result.usage;

  // Simulated response
  const text = `AI response to: ${message}`;
  const promptTokens = 20;
  const completionTokens = 50;

  // Cache + track
  await controls.cacheResponse(userId, message, text);
  const ok = await controls.trackTokenUsage(
    userId,
    promptTokens,
    completionTokens
  );

  if (!ok) {
    throw new Error('Token budget exceeded for today.');
  }

  return text;
}

async function main() {
  const response = await handleChat('user-1', 'Summarize my portfolio');
  console.log(response);

  // Second call hits cache
  const cached = await handleChat('user-1', 'Summarize my portfolio');
  console.log('(cached)', cached);
}

main().catch(console.error);
