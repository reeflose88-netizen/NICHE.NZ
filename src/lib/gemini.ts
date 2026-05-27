import { GoogleGenAI } from "@google/genai";
import { Niche } from "../data/niches";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function getNicheActionPlan(nicheTitle: string, description: string) {
  const model = "gemini-3-flash-preview";
  const prompt = `
    Produce a high-performance business blueprint for the following NZ niche:
    
    Niche: ${nicheTitle}
    Description: ${description}
    
    Format the response with professional Markdown headings.
    Include exactly the following sections with data-backed advice:
    
    1. **Resource Audit // Zero-Cost Start**: List 3 specific free tools with urls (e.g. https://canva.com, https://substack.com) and how to apply them.
    2. **NZ Market Momentum**: Identify 2 local trends. 
    3. **The 30-Day Execution Matrix**: 3 concrete, sequential steps to getting your first NZ client.
    4. **The Alpha Edge (USP)**: How to beat the competition in Auckland vs Regional NZ.
    5. **Upskilling & Education**: Mention specific **Free AU/NZ Courses** or micro-credentials (e.g. from **AUT University**) that yield immediate skill dividends.
    6. **Official Resource Nodes**: Include exactly 3 links to: https://www.business.govt.nz/, https://www.ird.govt.nz/, or https://www.regionalbusinesspartners.co.nz/
    
    IMPORTANT: Be extremely specific. No generic filler. Links must be functional.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: prompt }] }],
    });
    return response.text || "Failed to generate plan. Please try again.";
  } catch (error: any) {
    const isQuotaError = error?.status === 429 || error?.message?.includes('429');
    if (isQuotaError) {
      console.warn("Gemini Quota Exceeded for Plan Generation.");
      return "The strategic synthesis engine is at capacity. High-priority advice: Start with your first client today using an MVP approach on TradeMe or LinkedIn while the system recalibrates.";
    }
    console.error("Gemini Error:", error);
    return "The AI is currently unavailable. Please check your network connection.";
  }
}

export async function generateCustomNiche(userPrompt: string): Promise<Partial<Niche>> {
  const model = "gemini-3-flash-preview";
  const prompt = `
    Generate a unique, high-potential, and specifically LOW-COST (ideally $0 startup) money-making niche for the New Zealand market based on this request: "${userPrompt}".
    
    The response MUST be a JSON object with the following fields:
    - title: A short, catchy name.
    - category: One of "Digital", "Service", "Local", "Creative", or "Tech".
    - difficulty: One of "Beginner", "Intermediate", or "Expert".
    - shortDescription: A one-sentence summary.
    - potential: One of "$", "$$", or "$$$".
    - startupCost: A number from 0-2 (MUST be low).
    - timeCommitment: A number from 1-10.
    - marketSaturation: A number from 1-10.
    - skillRequired: A number from 1-10.
    
    Only return the JSON object, no other text.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: prompt }] }],
    });
    const text = response.text || "{}";
    const jsonString = text.replace(/```json|```/g, "").trim();
    return JSON.parse(jsonString);
  } catch (error: any) {
    const isQuotaError = error?.status === 429 || error?.message?.includes('429');
    if (isQuotaError) {
      // Return a "recovering" state or throw specific error
      throw new Error("SYNTHESIS_RECHARGING: The agent has exhausted its neural tokens. Try again in 60 seconds.");
    }
    console.error("Custom Niche Generation Error:", error);
    throw error;
  }
}

export async function generateDailyNicheDiscovery(): Promise<Partial<Niche>> {
  const model = "gemini-3-flash-preview";
  const prompt = `
    Generate a completely new, high-potential "Daily Alpha" business niche for the New Zealand market.
    It should be an emerging opportunity (e.g. involving new tech like AI, or a specific local need).
    
    The response MUST be a JSON object with the following fields:
    - title: A short, catchy name.
    - category: One of "Digital", "Service", "Local", "Creative", or "Tech".
    - difficulty: One of "Beginner", "Intermediate", or "Expert".
    - shortDescription: A one-sentence summary.
    - potential: One of "$", "$$", or "$$$".
    - startupCost: A number from 0-10.
    - timeCommitment: A number from 1-10.
    - marketSaturation: A number from 1-10.
    - skillRequired: A number from 1-10.
    
    Only return the JSON object, no other text.
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ parts: [{ text: prompt }] }],
    });
    const text = response.text || "{}";
    const jsonString = text.replace(/```json|```/g, "").trim();
    return JSON.parse(jsonString);
  } catch (error: any) {
    const isQuotaError = error?.status === 429 || error?.message?.includes('429');
    if (isQuotaError) {
      console.warn("Daily Niche Quota Hit. Using static archive fallback.");
      // Return a random high-quality niche from the database as a "daily" discovery fallback 
      // This matches the data structure of Niche
      return {
        title: "Micro-SaaS for NZ Tradies",
        category: "Tech",
        difficulty: "Intermediate",
        shortDescription: "Specialized booking forms for local Auckland contractors.",
        potential: "$$$",
        startupCost: 1,
        timeCommitment: 8,
        marketSaturation: 3,
        skillRequired: 7
      };
    }
    console.error("Daily Niche Generation Error:", error);
    throw error;
  }
}

export async function generateNicheImage(nicheTitle: string) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: {
        parts: [
          {
            text: `A high-quality, professional photography representing the business niche: "${nicheTitle}". 
            Style: Modern, brutalist architectural aesthetic, sharp lighting, realistic textures, New Zealand business context. 
            Composition: Clean, centered, professional.`,
          },
        ],
      },
      config: {
        imageConfig: {
          aspectRatio: "16:9",
        },
      },
    });

    for (const part of response.candidates[0].content.parts) {
      if (part.inlineData) {
        return `data:image/png;base64,${part.inlineData.data}`;
      }
    }
    return null;
  } catch (error: any) {
    const isQuotaError = error?.status === 429 || error?.message?.includes('429') || error?.code === 429 || JSON.stringify(error).includes('429');
    
    if (isQuotaError) {
      console.warn("Gemini Image Quota Exceeded. Using high-quality source fallback.");
      // Return a high-quality architectural fallback image
      return "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=2070&auto=format&fit=crop";
    }

    console.error("Gemini Image Error:", error);
    return null;
  }
}
