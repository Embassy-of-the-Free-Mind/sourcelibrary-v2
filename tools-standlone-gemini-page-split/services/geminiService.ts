import { GoogleGenAI, Type } from "@google/genai";
import { PageCoordinates } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const boundingBoxSchema = {
  type: Type.OBJECT,
  properties: {
    ymin: { type: Type.NUMBER, description: "Top coordinate (0-100)" },
    xmin: { type: Type.NUMBER, description: "Left coordinate (0-100)" },
    ymax: { type: Type.NUMBER, description: "Bottom coordinate (0-100)" },
    xmax: { type: Type.NUMBER, description: "Right coordinate (0-100)" },
  },
  required: ["ymin", "xmin", "ymax", "xmax"],
};

export const detectPageBoundaries = async (base64Image: string, mimeType: string): Promise<PageCoordinates> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: {
        parts: [
          {
            inlineData: {
              data: base64Image,
              mimeType: mimeType,
            },
          },
          {
            text: "Analyze this image of an open book. Identify the precise bounding box for the LEFT page and the bounding box for the RIGHT page. Exclude the background table or surface, focus only on the paper content. Return coordinates as percentages (0-100).",
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            leftPage: boundingBoxSchema,
            rightPage: boundingBoxSchema,
          },
          required: ["leftPage", "rightPage"],
        },
      },
    });

    if (!response.text) {
      throw new Error("No response from Gemini");
    }

    const data = JSON.parse(response.text) as PageCoordinates;
    return data;
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};