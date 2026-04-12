import OpenAI from "openai";

const API_KEY = process.env.OPENROUTER_API_KEY;
if (!API_KEY) {
  console.error("OPENROUTER_API_KEY is missing!");
  throw new Error("OPENROUTER_API_KEY not found in environment");
}

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: API_KEY,
});

export const getGeminiModel = () => client;
export default client;
