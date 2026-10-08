// Unified chat-completion client — routes every LLM call in this app to
// EITHER Hugging Face Inference (default, current production behavior) OR
// a locally-running Ollama instance, selected by one env var
// (LLM_PROVIDER=ollama) with no other code changes required. Built so
// ragService.js (narration) and queryPlanExtractor.js (query-plan
// extraction) don't each need their own HF-vs-Ollama branching — they call
// chatCompletion()/chatCompletionStream() here exactly as they already
// called hf.chatCompletion()/hf.chatCompletionStream() before, and never
// need to know which backend actually answered.
//
// Why this is safe to swap transparently: Ollama's OpenAI-compatible
// endpoint (http://localhost:11434/v1/chat/completions) returns the SAME
// response shape @huggingface/inference's chatCompletion/chatCompletionStream
// already do — { choices: [{ message: { content } }] } for a single
// response, and an async-iterable of { choices: [{ delta: { content } }] }
// chunks for a stream. No translation layer needed beyond picking a base
// URL and substituting the model name (Ollama's local model, e.g.
// "llama3.2", is a different name than the HF model string the callers
// pass in — that HF-specific string is meaningless to Ollama, so it's
// always overridden with OLLAMA_MODEL when routing there).
//
// Reversible by design: set LLM_PROVIDER back to anything other than
// "ollama" (or unset it) to go straight back to Hugging Face — no code
// change, no redeploy of logic, just the env var.
const { HfInference } = require('@huggingface/inference');

const USE_OLLAMA = (process.env.LLM_PROVIDER || '').toLowerCase() === 'ollama';
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1').replace(/\/+$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';

const hf = new HfInference(process.env.HF_API_KEY);

async function ollamaRequest(path, body) {
  const res = await fetch(`${OLLAMA_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Ollama request failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`);
    err.statusCode = res.status;
    throw err;
  }
  return res;
}

async function ollamaChatCompletion({ messages, max_tokens, temperature }) {
  const res = await ollamaRequest('/chat/completions', {
    model: OLLAMA_MODEL, messages, max_tokens, temperature, stream: false,
  });
  return res.json();
}

// Mirrors hf.chatCompletionStream's own contract: an async generator
// yielding parsed chunk objects, each shaped { choices: [{ delta: { content } }] }.
async function* ollamaChatCompletionStream({ messages, max_tokens, temperature }) {
  const res = await ollamaRequest('/chat/completions', {
    model: OLLAMA_MODEL, messages, max_tokens, temperature, stream: true,
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // keep the last (possibly partial) line for next read
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') return;
      if (!data) continue;
      try {
        yield JSON.parse(data);
      } catch {
        // Malformed/partial SSE chunk — skip rather than crash the stream,
        // same "don't let one bad chunk kill the whole answer" principle
        // streamHF's own retry logic already follows in ragService.js.
      }
    }
  }
}

// `model`/`provider` params are HF-specific routing hints — harmlessly
// ignored by the Ollama path (OLLAMA_MODEL always wins there instead).
function chatCompletion(params) {
  return USE_OLLAMA ? ollamaChatCompletion(params) : hf.chatCompletion(params);
}

function chatCompletionStream(params) {
  return USE_OLLAMA ? ollamaChatCompletionStream(params) : hf.chatCompletionStream(params);
}

module.exports = { chatCompletion, chatCompletionStream, USE_OLLAMA };
