import { GoogleGenAI, Chat, GenerateContentResponse, Content, Part, FunctionDeclaration, Type, Tool } from "@google/genai";
import { Message, Attachment, ChatConfig, UIChangeResult } from "../types";

// Always create a new instance to ensure the latest API key is used
const getAIClient = () => {
    // Priority 1: LocalStorage (Manual Entry for Static Deployment)
    if (typeof window !== 'undefined') {
        const localKey = localStorage.getItem('GEMINI_API_KEY');
        if (localKey) return new GoogleGenAI({ apiKey: localKey });
    }

    // Priority 2: Environment Variables (Local Dev / Build w/ check)
    let apiKey = '';
    try {
        // @ts-ignore
        if (typeof process !== 'undefined' && process.env) {
            // @ts-ignore
            apiKey = process.env.API_KEY || '';
        }
    } catch (e) {
        // Ignore ReferenceError
    }

    if (!apiKey && typeof window !== 'undefined') {
        const win = window as any;
        if (win.process && win.process.env) {
            apiKey = win.process.env.API_KEY || '';
        }
    }

    return new GoogleGenAI({ apiKey: apiKey });
};

// Store chat session in module scope
let chatSession: Chat | null = null;
// Store the avatar for image generation reference
let currentAvatarBase64: string | null = null;
// Store current config to access settings inside stream
let currentConfig: ChatConfig | null = null;

const DEFAULT_INSTRUCTION = "You are a helpful and friendly AI assistant. Keep responses concise and conversational.";
const DEFAULT_MODEL = 'gemini-1.5-pro';
const IMAGE_MODEL = 'gemini-1.5-pro';

// --- Tool Definitions ---

// 1. Image Generation Tool (Character Scene)
const generateImageTool: FunctionDeclaration = {
    name: "generate_character_scene",
    description: "Call this function to generate an illustration when the character's action or scene changes significantly. The argument should be a descriptive prompt in English.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            scene_description: {
                type: Type.STRING,
                description: "A detailed description of the character's action and the scene for an image generator. E.g. 'A girl eating a hamburger happily'.",
            },
        },
        required: ["scene_description"],
    },
};

// 2. UI Update Tool (Background & Opacity)
const updateUITool: FunctionDeclaration = {
    name: "update_ui_appearance",
    description: "Call this function to change the chat background image or the transparency of message bubbles based on the user's request or the current atmosphere.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            generate_background_prompt: {
                type: Type.STRING,
                description: "A prompt to generate a new background image (e.g., 'a cozy cafe interior at night', 'a magical forest'). If provided, an image will be generated and set as background.",
            },
            bubble_opacity: {
                type: Type.NUMBER,
                description: "The opacity of the message bubbles, from 0.0 (transparent) to 1.0 (opaque). Lower it to show more background.",
            }
        },
    },
};

export const initializeChat = (history: Message[], systemInstruction: string = DEFAULT_INSTRUCTION, model: string = DEFAULT_MODEL, avatarBase64: string | null = null, config: ChatConfig | null = null) => {
    const ai = getAIClient();

    currentAvatarBase64 = avatarBase64;
    currentConfig = config;

    const chatModel = model;

    // Convert app Message format to SDK Content format
    const sdkHistory: Content[] = history
        .filter(msg => !msg.isThinking)
        .map(msg => {
            const parts: Part[] = [];

            // Add text part
            if (msg.text) parts.push({ text: msg.text });

            // Add user attachment parts (images/files)
            // Only add attachments for USER messages to give context to the model.
            // We generally don't send back model-generated images to save tokens, unless needed.
            if (msg.role === 'user' && msg.images && msg.images.length > 0) {
                msg.images.forEach(img => {
                    parts.push({
                        inlineData: {
                            mimeType: img.mimeType,
                            data: img.data
                        }
                    });
                });
            }

            return {
                role: msg.role,
                parts: parts
            };
        });

    // Construct dynamic system instruction with user context
    let finalSystemInstruction = systemInstruction;

    // Add language instruction
    if (config && config.language && config.language !== 'ja') {
        const languageNames: Record<string, string> = {
            'en': 'English',
            'ko': 'Korean (한국어)',
            'zh-TW': 'Traditional Chinese (繁體中文)',
            'zh-CN': 'Simplified Chinese (简体中文)'
        };
        const langName = languageNames[config.language] || 'English';
        finalSystemInstruction += `\n\n[IMPORTANT: Language Requirement]\nYou MUST respond ONLY in ${langName}. Never respond in any other language.`;
    }

    // Add response length instruction
    if (config && config.responseLength) {
        if (config.responseLength === 'short') {
            finalSystemInstruction += "\n\n[Response Length]\nKeep your responses very short and concise.";
        } else if (config.responseLength === 'normal') {
            finalSystemInstruction += "\n\n[Response Length]\nKeep your responses moderate in length.";
        }
    }

    if (config && (config.userName || config.userPersona || config.relationship)) {
        finalSystemInstruction += "\n\n[User Context]";
        if (config.userName) {
            finalSystemInstruction += `\nUser Name: ${config.userName}`;
        }
        if (config.userPersona) {
            finalSystemInstruction += `\nUser Persona: ${config.userPersona}`;
        }
        if (config.relationship) {
            finalSystemInstruction += `\nRelationship with AI: ${config.relationship}`;
        }
        finalSystemInstruction += "\n\nPlease reflect the user context and relationship in your responses.";
    }

    const chatConfig: any = {
        systemInstruction: finalSystemInstruction,
    };

    // --- Dynamic Tool Configuration ---
    const activeTools: Tool[] = [];
    const functionDeclarations: FunctionDeclaration[] = [];

    // 1. Google Search
    if (config?.useGoogleSearch) {
        activeTools.push({ googleSearch: {} });
    }

    // 2. Function Calling
    if (config?.useFunctionCalling) {
        if (!config.useGoogleSearch) {
            functionDeclarations.push(generateImageTool);

            if (config.allowUIChange) {
                functionDeclarations.push(updateUITool);
            }
        }
    }

    if (functionDeclarations.length > 0) {
        activeTools.push({ functionDeclarations });
    }

    if (activeTools.length > 0) {
        chatConfig.tools = activeTools;
    }

    // Force Function Calling Config
    if (config?.forceFunctionCall && functionDeclarations.length > 0) {
        chatConfig.toolConfig = {
            functionCallingConfig: {
                mode: 'ANY'
            }
        };
    }

    chatSession = ai.chats.create({
        model: chatModel,
        config: chatConfig,
        history: sdkHistory
    });
};

export interface StreamChunk {
    text?: string;
    image?: {
        mimeType: string;
        data: string;
    };
    uiChange?: UIChangeResult;
}

// Helper to generate image (used for both character scene and background)
const generateImageFromPrompt = async (prompt: string, referenceImage?: string): Promise<{ mimeType: string, data: string } | null> => {
    const ai = getAIClient();
    try {
        const parts: Part[] = [{ text: prompt }];
        if (referenceImage) {
            parts.push({
                inlineData: {
                    mimeType: 'image/png',
                    data: referenceImage
                }
            });
        }

        const response = await ai.models.generateContent({
            model: IMAGE_MODEL,
            contents: { parts },
            config: {
                imageConfig: {
                    aspectRatio: referenceImage ? "1:1" : "16:9", // Square for avatar ref, Landscape for BG
                    imageSize: "1K"
                }
            }
        });

        if (response.candidates && response.candidates.length > 0) {
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData) {
                    return {
                        mimeType: part.inlineData.mimeType,
                        data: part.inlineData.data
                    };
                }
            }
        }
        return null;
    } catch (error) {
        console.error("Image Generation Failed:", error);
        return null;
    }
};

export const sendMessageStream = async (message: string, attachments: Attachment[] = [], signal?: AbortSignal): Promise<AsyncGenerator<StreamChunk, void, unknown>> => {
    if (!chatSession) {
        throw new Error("Chat session not initialized");
    }

    try {
        let messagePayload: string | Part[];

        if (attachments.length === 0) {
            messagePayload = message;
        } else {
            const parts: Part[] = [];
            if (message.trim()) {
                parts.push({ text: message });
            }
            attachments.forEach(att => {
                parts.push({
                    inlineData: {
                        mimeType: att.mimeType,
                        data: att.data
                    }
                });
            });
            messagePayload = parts;
        }

        let result = await chatSession.sendMessageStream({ message: messagePayload });

        async function* streamGenerator() {
            // Loop to handle function calls and subsequent text generation
            let keepGoing = true;
            while (keepGoing) {
                if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

                keepGoing = false;
                let functionCallsToProcess: any[] = [];

                // It is possible `result` is just the response object if stream was handled differently, 
                // but sendMessageStream returns Promise<GenerateContentStreamResult> which is iterable.
                for await (const chunk of result) {
                    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

                    const c = chunk as GenerateContentResponse;

                    // Handle Text Content & Direct Image Content
                    if (c.candidates && c.candidates.length > 0 && c.candidates[0].content && c.candidates[0].content.parts) {
                        for (const part of c.candidates[0].content.parts) {
                            if (part.text) {
                                yield { text: part.text };
                            }
                            if (part.inlineData) {
                                yield {
                                    image: {
                                        mimeType: part.inlineData.mimeType,
                                        data: part.inlineData.data
                                    }
                                };
                            }
                        }
                    }

                    // Handle Function Calls (Tool Usage)
                    if (c.functionCalls && c.functionCalls.length > 0) {
                        functionCallsToProcess = c.functionCalls;
                    }
                }

                if (functionCallsToProcess.length > 0) {
                    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

                    const functionResponseParts: Part[] = [];

                    for (const fc of functionCallsToProcess) {
                        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

                        const args = fc.args as any;
                        let toolResult = { result: "Function executed." };

                        if (fc.name === 'generate_character_scene') {
                            if (args.scene_description && currentAvatarBase64) {
                                const prompt = `Draw a high quality illustration of this character: ${args.scene_description}. Maintain the character's facial features and style from the reference image.`;

                                const genImage = await generateImageFromPrompt(prompt, currentAvatarBase64);
                                if (genImage) {
                                    yield { image: genImage };
                                }
                            }
                        }
                        else if (fc.name === 'update_ui_appearance') {
                            const uiChanges: UIChangeResult = {};

                            if (args.bubble_opacity !== undefined) {
                                uiChanges.bubbleOpacity = Number(args.bubble_opacity);
                            }

                            if (args.generate_background_prompt) {
                                const prompt = `A high quality background image for a chat application: ${args.generate_background_prompt}. No characters, scenic view, high resolution.`;
                                const bgImage = await generateImageFromPrompt(prompt, undefined);
                                if (bgImage) {
                                    uiChanges.backgroundImage = `data:${bgImage.mimeType};base64,${bgImage.data}`;
                                }
                            }

                            // Yield the UI change to the app
                            yield { uiChange: uiChanges };
                            toolResult = { result: "UI updated successfully." };
                        }

                        functionResponseParts.push({
                            functionResponse: {
                                name: fc.name,
                                response: toolResult
                            }
                        });
                    }

                    // Send tool response back to the chat model to continue the conversation
                    if (chatSession && functionResponseParts.length > 0 && !signal?.aborted) {
                        result = await chatSession.sendMessageStream({ message: functionResponseParts });
                        keepGoing = true;
                    }
                }
            }
        }

        return streamGenerator();
    } catch (error) {
        console.error("Gemini API Error:", error);
        throw error;
    }
};