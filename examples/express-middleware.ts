/**
 * Example: Express middleware for AI rate limiting and budget enforcement.
 *
 * Prerequisites:
 *   npm install express ai-cost-controls
 */

// import express from 'express';
import { CostControls } from '../src';

const controls = new CostControls({
  config: {
    rateLimitPerMinute: 20,
    dailyTokenBudget: 100_000
  }
});

/**
 * Middleware that checks rate limits before AI endpoints.
 */
function rateLimitMiddleware() {
  return async (req: any, res: any, next: any) => {
    const userId = req.user?.id ?? req.ip;

    if (!(await controls.checkRateLimit(userId))) {
      return res.status(429).json({
        error: 'Rate limit exceeded. Please try again later.'
      });
    }

    next();
  };
}

/**
 * Middleware that tracks token usage and enforces budgets.
 */
function budgetMiddleware() {
  return async (req: any, res: any, next: any) => {
    const userId = req.user?.id ?? req.ip;

    // Attach helper to request for use in route handler
    req.trackAiUsage = async (
      inputTokens: number,
      outputTokens: number
    ): Promise<boolean> => {
      return controls.trackTokenUsage(userId, inputTokens, outputTokens);
    };

    next();
  };
}

// Usage with Express:
//
// const app = express();
//
// app.use('/api/ai', rateLimitMiddleware(), budgetMiddleware());
//
// app.post('/api/ai/chat', async (req, res) => {
//   const { message } = req.body;
//   const userId = req.user.id;
//
//   const cached = await controls.getCachedResponse(userId, message);
//   if (cached) return res.json({ response: cached });
//
//   const aiResponse = await callAI(message);
//   await controls.cacheResponse(userId, message, aiResponse.text);
//
//   const ok = await req.trackAiUsage(aiResponse.inputTokens, aiResponse.outputTokens);
//   if (!ok) return res.status(402).json({ error: 'Token budget exceeded' });
//
//   res.json({ response: aiResponse.text });
// });

console.log('Express middleware example — see source comments for usage.');
