import { IProviderAdapter } from '../../types/adapters.js';
import { ILogger } from '../../types/logger.js';
import {
    IRouterAdapter,
    RouterDecision,
    ToolCategoryInfo,
} from '../../types/agent.js';

/**
 * Options for the built-in {@link LLMRouter}.
 *
 * @since 1.6.0
 */
export interface LLMRouterOptions {
    adapter: IProviderAdapter;
    model: string;
    logger: ILogger;
}

/**
 * Built-in MetaRouter. Classifies a user message (`chat` vs `task`) and selects
 * the relevant tool categories with a single temperature-0 LLM call.
 *
 * Two cheap guards run before the LLM:
 *  - **Conversational fast-path**: short greeting/acknowledgement input is
 *    classified `chat` with no categories and no LLM call.
 *  - **No categories**: if no categorized tools exist, routing is moot — returns
 *    `task` with an empty category list (uncategorized tools are always exposed
 *    by the caller anyway).
 *
 * Fails safe: any error returns `{ mode: 'task', categories: <all> }` so the
 * agent never loses tool access because routing hiccupped.
 *
 * @since 1.6.0
 */
export class LLMRouter implements IRouterAdapter {
    private adapter: IProviderAdapter;
    private model: string;
    private logger: ILogger;

    /** Matches purely conversational input — greetings, thanks, acknowledgements. */
    private static readonly CHAT_FAST_PATH =
        /^\s*(hi|hello|hey|yo|sup|thanks|thank you|thx|ok|okay|cool|great|nice|got it|sounds good|bye|goodbye|cheers|gracias|merci)[\s!.?]*$/i;

    constructor(opts: LLMRouterOptions) {
        this.adapter = opts.adapter;
        this.model = opts.model;
        this.logger = opts.logger;
    }

    async route(
        userMessage: string,
        availableCategories: ToolCategoryInfo[]
    ): Promise<RouterDecision> {
        const allCategoryNames = availableCategories.map(c => c.name);

        // No categorized tools — nothing to route.
        if (allCategoryNames.length === 0) {
            return { mode: 'task', categories: [], reason: 'no categorized tools' };
        }

        // Conversational fast-path — skip the LLM entirely.
        if (LLMRouter.CHAT_FAST_PATH.test(userMessage)) {
            return { mode: 'chat', categories: [], reason: 'conversational fast-path' };
        }

        const catalog = availableCategories
            .map(c => `- ${c.name}: ${c.tools.join(', ')}`)
            .join('\n');

        const prompt = `You are a router. Classify the user's message and select which tool categories are needed to handle it.

Available tool categories:
${catalog}

Rules:
- mode "chat" = purely conversational (greeting, opinion, simple question answerable from general knowledge). Select NO categories.
- mode "task" = requires doing work with tools. Select ONLY the categories actually needed.
- Be minimal: do not select a category unless the message clearly needs it.

User message:
"""${userMessage.slice(0, 2000)}"""

Respond ONLY with valid JSON (no markdown, no prose):
{ "mode": "chat" | "task", "categories": string[], "reason": string }`;

        try {
            const response = await this.adapter.complete({
                model: this.model,
                temperature: 0,
                maxTokens: 256,
                messages: [{ role: 'user', content: prompt }],
            });

            const stripped = response.content.replace(/```json|```/g, '').trim();
            const jsonMatch = stripped.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error(`No JSON object in router response: "${stripped.slice(0, 200)}"`);
            }
            const parsed = JSON.parse(jsonMatch[0]) as Partial<RouterDecision>;

            const mode: RouterDecision['mode'] = parsed.mode === 'chat' ? 'chat' : 'task';
            // Keep only categories the router was actually offered — drop hallucinated ones.
            const known = new Set(allCategoryNames);
            const categories = Array.isArray(parsed.categories)
                ? parsed.categories.filter(c => known.has(c))
                : [];

            const decision: RouterDecision = {
                mode,
                categories: mode === 'chat' ? [] : categories,
            };
            if (typeof parsed.reason === 'string') decision.reason = parsed.reason;
            return decision;
        } catch (err: unknown) {
            // Fail safe: expose everything as a task rather than starving the agent.
            this.logger.warn(
                `[Router] Routing failed, falling back to all tools: ${(err as Error).message ?? String(err)}`
            );
            return {
                mode: 'task',
                categories: allCategoryNames,
                reason: 'router error — fail-safe to all categories',
            };
        }
    }
}
