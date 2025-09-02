import express from "express";
import { AIModelFactory } from "../services/ai-models/ai-model-factory";
import type { AiConfig } from "@shared/schema";

const router = express.Router();

// Test endpoint for all AI models
router.post("/api/test-models", async (req, res) => {
  const { prompt = "Wat is 2 + 2?" } = req.body;
  const factory = AIModelFactory.getInstance();
  const results: any[] = [];

  // Test configurations for each model
  const testConfigs: AiConfig[] = [
    // Google models
    {
      provider: "google",
      model: "gemini-2.5-pro",
      temperature: 0.1,
      topP: 0.95,
      topK: 20,
      maxOutputTokens: 100
    },
    {
      provider: "google",
      model: "gemini-2.5-flash",
      temperature: 0.5,
      topP: 0.9,
      topK: 30,
      maxOutputTokens: 100
    },
    // OpenAI standard models
    {
      provider: "openai",
      model: "gpt-4o",
      temperature: 0.3,
      topP: 0.95,
      topK: 20, // Will be filtered out
      maxOutputTokens: 100
    },
    {
      provider: "openai",
      model: "gpt-4o-mini",
      temperature: 0.7,
      topP: 0.85,
      topK: 20, // Will be filtered out
      maxOutputTokens: 100
    },
    // OpenAI reasoning models
    {
      provider: "openai",
      model: "o3-mini",
      temperature: 1, // Will be ignored
      topP: 1, // Will be ignored
      topK: 20, // Will be ignored
      maxOutputTokens: 100,
      reasoning: { effort: "low" }
    },
    {
      provider: "openai",
      model: "o3",
      temperature: 1, // Will be ignored
      topP: 1, // Will be ignored
      topK: 20, // Will be ignored
      maxOutputTokens: 100,
      reasoning: { effort: "medium" }
    },
    // GPT-5
    {
      provider: "openai",
      model: "gpt-5",
      temperature: 1, // Will be ignored
      topP: 1, // Will be ignored
      topK: 20, // Will be ignored
      maxOutputTokens: 100,
      reasoning: { effort: "high" },
      verbosity: "medium"
    },
    // Deep research models
    {
      provider: "openai",
      model: "o3-deep-research-2025-06-26",
      temperature: 1, // Will be ignored
      topP: 1, // Will be ignored
      topK: 20, // Will be ignored
      maxOutputTokens: 100,
      reasoning: { effort: "high" }
    },
    {
      provider: "openai",
      model: "o4-mini-deep-research-2025-06-26",
      temperature: 1, // Will be ignored
      topP: 1, // Will be ignored
      topK: 20, // Will be ignored
      maxOutputTokens: 100,
      reasoning: { effort: "minimal" }
    }
  ];

  for (const config of testConfigs) {
    try {
      console.log(`\n🧪 Testing model: ${config.model}`);
      
      // Get model info
      const modelInfo = factory.getModelInfo(config.model);
      const supportedParams = factory.getSupportedParameters(config.model);
      
      // Validate config
      factory.validateConfig(config);
      
      // Try to call the model (will fail if no API key, but that's okay for testing)
      let response = null;
      let error = null;
      
      try {
        const result = await factory.callModel(config, prompt, {
          jobId: `test-${config.model}`,
          useWebSearch: false,
          useGrounding: false
        });
        response = {
          content: result.content.substring(0, 100) + "...",
          duration: result.duration,
          hasUsage: !!result.usage
        };
      } catch (err: any) {
        error = err.message;
      }
      
      results.push({
        model: config.model,
        provider: config.provider,
        modelInfo,
        supportedParams,
        testResult: {
          validated: true,
          response,
          error
        }
      });
      
    } catch (err: any) {
      results.push({
        model: config.model,
        provider: config.provider,
        error: err.message
      });
    }
  }

  res.json({
    success: true,
    testedModels: results.length,
    results
  });
});

// Get available models info
router.get("/api/model-info", (req, res) => {
  const factory = AIModelFactory.getInstance();
  const models = factory.getAvailableModels();
  
  res.json({
    success: true,
    totalModels: models.length,
    models: models.map(({ model, info }) => ({
      model,
      ...info
    }))
  });
});

export default router;