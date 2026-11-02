import {UsageGuard, UsageError} from './usage-guard.mjs';
import {MetaProviderError} from './meta-provider.mjs';

function number(env, key, fallback) {
  const raw = env[key];
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new UsageError('invalid_config', `${key} must be a positive integer.`);
  return value;
}
export function readConfig(env = process.env) {
  const config = {
    enabled: env.AI_LIVE_ENABLED === 'true', providerId: env.META_API_PROVIDER_ID || 'meta',
    model: env.META_API_MODEL || '', apiKey: env.META_API_KEY || env.MODEL_API_KEY || '',
    perMinute: number(env, 'AI_REQUESTS_PER_MINUTE', 10), perDay: number(env, 'AI_REQUESTS_PER_DAY', 200),
    timeoutMs: number(env, 'AI_TIMEOUT_MS', 30000), maxInputBytes: number(env, 'AI_MAX_INPUT_BYTES', 12000),
    maxInputTokens: number(env, 'AI_MAX_INPUT_TOKENS', 4096), maxOutputTokens: number(env, 'AI_MAX_OUTPUT_TOKENS', 2048)
  };
  if (config.maxOutputTokens < 16) throw new UsageError('invalid_config', 'AI_MAX_OUTPUT_TOKENS must be at least 16.');
  return config;
}
function inputTabs(tabs) {
  if (!Array.isArray(tabs) || !tabs.length || tabs.length > 100) throw new UsageError('invalid_input', 'Send between one and 100 eligible tabs.');
  const seen = new Set();
  return tabs.map(tab => {
    if (!tab || !((Number.isSafeInteger(tab.id) && tab.id >= 0) || (typeof tab.id === 'string' && /^(0|[1-9]\d*)$/.test(tab.id) && Number.isSafeInteger(Number(tab.id))))) throw new UsageError('invalid_input', 'Every tab must have a valid existing numeric ID.');
    const id = String(tab.id);
    if (seen.has(id)) throw new UsageError('invalid_input', 'Duplicate input tab ID.');
    seen.add(id);
    let url;
    try { url = new URL(tab.url); } catch { throw new UsageError('invalid_input', 'A tab URL is invalid.'); }
    if (!['http:', 'https:'].includes(url.protocol) || tab.incognito || tab.pinned) throw new UsageError('invalid_input', 'Private, pinned or unsupported tabs cannot be submitted.');
    if (typeof tab.title !== 'string' || tab.title.length > 250) throw new UsageError('invalid_input', 'Tab titles must be strings of at most 250 characters.');
    return {id, title: tab.title, url: `${url.origin}${url.pathname}`};
  });
}
function inputExistingGroups(groups) {
  if (!Array.isArray(groups) || groups.length > 100) throw new UsageError('invalid_input', 'Existing group context must contain at most 100 groups.');
  return groups.map(group => {
    if (!group || typeof group !== 'object' || Array.isArray(group) || Object.keys(group).some(key => !['name','tabCount'].includes(key)) || typeof group.name !== 'string' || !group.name.trim() || group.name.length > 80 || !Number.isSafeInteger(group.tabCount) || group.tabCount < 0 || group.tabCount > 1000) throw new UsageError('invalid_input', 'Existing groups must contain only a name and bounded tab count.');
    return {name:group.name.trim(),tabCount:group.tabCount};
  });
}
function validateGroups(result, tabs) {
  if (!result || !Array.isArray(result.groups) || result.groups.length > 30) throw new UsageError('invalid_response', 'The model returned an invalid group list.');
  const allowed = new Set(tabs.map(t => t.id)), seen = new Set();
  return {groups: result.groups.map(group => {
    if (!group || typeof group.name !== 'string' || !group.name.trim() || group.name.length > 80 || typeof group.reason !== 'string' || group.reason.length > 240 || !Array.isArray(group.tabIds) || !group.tabIds.length) throw new UsageError('invalid_response', 'The model returned an invalid group.');
    const tabIds = group.tabIds.map(id => {
      if (!(typeof id === 'string' || Number.isSafeInteger(id))) throw new UsageError('invalid_response', 'The model returned an invalid tab ID.');
      const key = String(id);
      if (!allowed.has(key) || seen.has(key)) throw new UsageError('invalid_response', 'The model invented or duplicated a tab assignment.');
      seen.add(key); return key;
    });
    return {name: group.name.trim(), reason: group.reason, tabIds};
  }), ungrouped: [...allowed].filter(id => !seen.has(id))};
}

/** All model operations pass through this credential-safe server boundary. */
export function createAIService({env = process.env, provider, statePath, now = Date.now}) {
  const config = readConfig(env);
  if (provider?.remoteTokenCount && (config.perMinute < 2 || config.perDay < 2)) throw new UsageError('invalid_config', 'This provider needs room for two attempts per suggestion.');
  const guard = new UsageGuard({statePath, perMinute: config.perMinute, perDay: config.perDay, timeoutMs: config.timeoutMs, now});
  const configured = () => config.enabled && Boolean(config.apiKey.trim() && config.model.trim() && config.providerId.trim()) && provider?.id === config.providerId && typeof provider.generate === 'function' && typeof provider.countInputTokens === 'function';
  return {
    async status() { return {enabled: config.enabled, configured: Boolean(configured()), ...await guard.status({requiredAttempts: provider?.remoteTokenCount ? 2 : 1}), maxInputBytes: config.maxInputBytes, maxInputTokens: config.maxInputTokens, maxOutputTokens: config.maxOutputTokens, requestsPerSuggestion: provider?.remoteTokenCount ? 2 : 1}; },
    async suggest(tabs, {consent = false, preferences = '', existingGroups = []} = {}) {
      if (!configured()) throw new UsageError('not_configured', 'Live AI is disabled or its provider/model/key adapter is not configured. No request was sent.');
      if (consent !== true) throw new UsageError('consent_required', 'Confirm sending tab titles and sanitized URL paths to the configured provider. Titles and paths may contain sensitive information.');
      if(typeof preferences!=='string'||preferences.length>1200)throw new UsageError('invalid_input','Grouping preferences must be at most 1200 characters.');
      const input = inputTabs(tabs);
      const context = inputExistingGroups(existingGroups);
      const body = JSON.stringify({tabs:input,preferences,existingGroups:context});
      if (Buffer.byteLength(body, 'utf8') > config.maxInputBytes) throw new UsageError('input_limit', 'The tab inventory exceeds the configured input byte limit.');
      const options = {tabs: input, preferences, existingGroups:context, model: config.model, apiKey: config.apiKey, maxOutputTokens: config.maxOutputTokens};
      const checkCount = count => {
        if (!Number.isSafeInteger(count) || count < 0 || count > config.maxInputTokens) throw new UsageError('input_limit', 'The complete prompt exceeds the input token limit or cannot be counted.');
      };
      const generate = async signal => {
        if (signal.aborted) throw new UsageError('timeout', 'The request was cancelled before generation. The reserved budget is retained.');
        let result;
        try { result = await provider.generate({...options, signal}); }
        catch(error) { throw new UsageError('provider_error', `${error instanceof MetaProviderError?error.message:'The provider request failed.'} This attempt counts against your budget. No automatic retry was made.`); }
        return validateGroups(result, input);
      };
      if (provider.remoteTokenCount) {
        // Preflight room for both calls; hold one lock and admit each endpoint
        // immediately before calling it, with its own durable timestamp.
        return guard.run(async (signal, reserve) => {
          let count;
          try { count = await provider.countInputTokens({...options, signal}); }
          catch(error) { throw new UsageError('provider_error', `Token count: ${error instanceof MetaProviderError?error.message:'The provider request failed.'} The reserved budget is retained; no generation or retry was made.`); }
          checkCount(count);
          await reserve();
          return generate(signal);
        }, {requiredAttempts: 2});
      }
      let count;
      try { count = provider.countInputTokens(options); }
      catch { throw new UsageError('input_limit', 'The adapter could not count input tokens. No request was sent.'); }
      checkCount(count);
      return guard.run(generate);
    }
  };
}
