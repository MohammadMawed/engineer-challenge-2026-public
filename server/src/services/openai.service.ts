import OpenAI from 'openai'

let client: OpenAI | null = null

export function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required when FAKE_LLM is not enabled')
  }

  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 15_000,
      maxRetries: 1,
    })
  }

  return client
}
