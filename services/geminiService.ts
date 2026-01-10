import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { Message, Role, ChatConfig, Sticker } from "../types";

// Helper: Get Base URL with fallback
const getBaseUrl = (config: ChatConfig) => {
    if (config.apiUrl && config.apiUrl.trim() !== '') {
        return config.apiUrl.replace(/\/+$/, '');
    }
    return config.provider === 'google' 
        ? 'https://generativelanguage.googleapis.com'
        : 'https://api.openai.com/v1';
};

// Helper: Trim history based on maxContext
const getTrimmedHistory = (messages: Message[], limit: number = 20) => {
    if (limit <= 0) return messages;
    return messages.slice(-limit);
};

// Helper: Extract Base64 Data (Remove header for Google)
const extractBase64Data = (dataUrl: string) => {
    return dataUrl.split(',')[1];
};

// Helper: Build System Prompt with Sticker Context
const buildSystemInstruction = (config: ChatConfig, stickers?: Sticker[]) => {
    let instruction = config.systemInstruction || '';
    
    // Default to 'normal' if undefined
    const mode = config.dialogueMode || 'normal';

    if (mode === 'novel') {
        instruction += `\n\n[IMMERSIVE/NOVEL DIALOGUE MODE ENABLED]
You are writing a visual novel script. Your output is parsed by a strict code engine.

*** CRITICAL FORMATTING RULES ***
1. YOU MUST ONLY USE THESE TWO TAGS:
   <action> ... </action>  --> For ALL narration, movements, facial expressions, thoughts, and environment descriptions.
   <say> ... </say>        --> For ALL spoken dialogue by the character.

2. FORBIDDEN TAGS (DO NOT USE):
   - NO <smile>, <think>, <look>, <scene>, <emotion>.
   - NO <Action>, <Say> (Tags must be lowercase).
   - NO attributes like <action type="happy">.

3. STRUCTURE:
   - Do NOT use brackets () or quotation marks "" for speech. The tags replace them.
   - Do NOT put any text outside of these tags. Every single word must be inside either <action> or <say>.
   - CLOSE YOUR TAGS properly.

CORRECT EXAMPLE:
<action>She pushes the door open and looks around nervously.</action>
<say>Is anyone home?</say>
<action>Silence answers her. She sighs deeply, thinking to herself.</action>
<say>I guess I'm alone.</say>

INCORRECT EXAMPLE (NEVER DO THIS):
(Opens door)                 <-- WRONG: No brackets.
<smile>Hello</smile>         <-- WRONG: <smile> is not a valid tag. Use <action>She smiles</action>.
<say>Hello           <-- WRONG: Unclosed tag.
Hello?                       <-- WRONG: Text outside tags.`;
    }

    if (config.enableStickers && stickers && stickers.length > 0) {
        const list = stickers.map(s => `- ID: ${s.id}, Meaning: ${s.description}`).join('\n');
        instruction += `\n\n[STICKER PROTOCOL ENABLED]
You have access to a library of sticker images. You can use them to express emotions or reactions.
Here is the list of available stickers:
${list}

IMPORTANT RULES FOR STICKERS:
1. To send a sticker, you MUST output the tag on a NEW LINE: <STICKER:ID>
2. Do not use Markdown image syntax for these stickers. Use ONLY the tag.
3. You can mix text and stickers.
4. Decide whether to use a sticker based on the conversation context. Use them naturally when the emotion fits. Do not use them in every single message.
5. Users may send stickers. These will appear to you as text descriptions like "[User sent a sticker: ...]". Treat this as the user sending a visual expression matching that description.
6. When YOU send a sticker (as the Assistant), it will be recorded in history as "[Assistant sent a sticker: ...]". Do not confuse this with user actions.`;
    }

    if (config.enableTransfer) {
        instruction += `\n\n[TRANSFER PROTOCOL ENABLED]
You have the ability to simulate sending and receiving money transfers (WeChat Pay).
IMPORTANT RULES FOR TRANSFERS:
1. To send money to the user, output this tag on a NEW LINE: <TRANSFER:AMOUNT> (e.g. <TRANSFER:100> to send 100 yuan).
2. If the user sends you a transfer, it will appear in the history as "[User sent a transfer of X...]". 
3. To ACCEPT a pending transfer from the user, you MUST output this tag on a NEW LINE: <ACCEPT_TRANSFER>
4. To REFUND/REJECT a transfer (give it back), output this tag on a NEW LINE: <REJECT_TRANSFER>
5. Do not output any other text inside the tag.
6. Use this feature only when it makes sense in the roleplay (e.g. giving pocket money, paying for dinner, accepting a gift, or refusing a bribe).
7. NEVER repeat the system log text (e.g. "[User sent...]") in your output. Only output your character's response and the tags.`;
    }

    return instruction;
};

// OpenAI Messages Formatter
const prepareOpenAIMessages = (messages: Message[], config: ChatConfig, stickers?: Sticker[]) => {
    const contextMessages = getTrimmedHistory(messages, config.historyLimit);
    const systemContent = buildSystemInstruction(config, stickers);
    const totalMsgs = contextMessages.length;
    
    const visualLimit = config.visualMemoryLimit ?? 3;
    const isNovelMode = config.dialogueMode === 'novel';

    return [
        { role: 'system', content: systemContent },
        ...contextMessages.map((m, index) => {
            // Ignore System Role messages in OpenAI history (mostly UI notifications)
            if (m.role === Role.SYSTEM) return null;

            const role = m.role === Role.USER ? 'user' : 'assistant';
            const contentParts: any[] = [];
            
            // Check if this message is "recent" enough to keep heavy image data
            const isRecent = index >= totalMsgs - visualLimit;

            // 1. Handle Metadata (Stickers & Transfers & Actions)
            if (m.metadata?.isSticker && m.metadata?.stickerDescription) {
                const identity = m.role === Role.USER ? 'User' : 'Assistant';
                contentParts.push({ type: 'text', text: `[${identity} sent a sticker: ${m.metadata.stickerDescription}]` });
            } 
            else if (m.metadata?.transferAmount) {
                const identity = m.role === Role.USER ? 'User' : 'Assistant';
                let status = 'Pending';
                if (m.metadata.transferStatus === 'accepted') status = 'Accepted';
                if (m.metadata.transferStatus === 'refunded') status = 'Refunded';
                
                contentParts.push({ type: 'text', text: `[${identity} sent a transfer of ￥${m.metadata.transferAmount}. Status: ${status}]` });
            }
            else {
                // 2. Handle Text Content
                let text = m.content;
                
                // NOVEL MODE: Format history with tags to reinforce the pattern to AI
                if (isNovelMode && text) {
                     if (m.metadata?.isAction) {
                         text = `<action>${text}</action>`;
                     } else {
                         // Regular text is speech
                         text = `<say>${text}</say>`;
                     }
                } else {
                    // Normal mode: wrap actions in parens if they were parsed as actions
                    if (m.metadata?.isAction && text) {
                        text = `(${text})`;
                    }
                }

                if (text) contentParts.push({ type: 'text', text: text });
                
                // 3. Handle Regular Attachments (Real images)
                if (m.attachments && m.attachments.length > 0) {
                    if (isRecent) {
                        // RECENT MESSAGE: Send full image data
                        m.attachments.forEach(att => {
                            if (att.type === 'image') {
                                contentParts.push({
                                    type: 'image_url',
                                    image_url: { url: att.data }
                                });
                            }
                        });
                    } else {
                        // OLD MESSAGE: Optimize by removing image data
                        contentParts.push({ type: 'text', text: `[System: ${role === 'user' ? 'User' : 'Assistant'} sent an image here, but it is archived to save memory.]` });
                    }
                }
            }

            // OpenAI expects content to be string or array. If empty (rare), send empty string.
            if (contentParts.length === 0) return { role, content: "" };
            // If only one text part and no images, simplify to string (optimization)
            if (contentParts.length === 1 && contentParts[0].type === 'text') return { role, content: contentParts[0].text };

            return { role, content: contentParts };
        }).filter(Boolean) as any[]
    ];
};

// OpenAI Streaming & Non-Streaming Logic
const fetchOpenAIResponse = async (
    messages: Message[], 
    config: ChatConfig, 
    onUpdate?: (text: string) => void,
    stickers?: Sticker[]
): Promise<string> => {
  // Allow empty key if user provided custom URL (implied)
  const headers: Record<string, string> = {
      'Content-Type': 'application/json'
  };
  if (config.apiKey) {
      headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  const openAIMessages = prepareOpenAIMessages(messages, config, stickers);
  const baseUrl = getBaseUrl(config);
  const endpoint = `${baseUrl}/chat/completions`;

  const body: any = {
      model: config.model,
      messages: openAIMessages,
      temperature: config.temperature,
      top_p: config.topP,
      max_tokens: config.thinkingBudget ? undefined : 2048,
      stream: config.enableStream
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: { message: response.statusText } }));
    throw new Error(err.error?.message || `API 请求失败: ${response.status}`);
  }

  // Handle Streaming
  if (config.enableStream && response.body && onUpdate) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let fullText = "";
      let buffer = "";

      try {
          while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              
              const lines = buffer.split('\n');
              buffer = lines.pop() || ""; // Keep the incomplete line

              for (const line of lines) {
                  const trimmed = line.trim();
                  if (!trimmed.startsWith('data: ')) continue;
                  
                  const jsonStr = trimmed.replace('data: ', '');
                  if (jsonStr === '[DONE]') continue;

                  try {
                      const json = JSON.parse(jsonStr);
                      const content = json.choices?.[0]?.delta?.content || "";
                      if (content) {
                          fullText += content;
                          onUpdate(fullText);
                      }
                  } catch (e) {
                      console.warn("SSE Parse Error", e);
                  }
              }
          }
      } catch (err) {
          console.error("Stream reading failed", err);
      }
      return fullText;
  } 
  // Handle Non-Streaming
  else {
      const data = await response.json();
      return data.choices?.[0]?.message?.content || "";
  }
};

const fetchOpenAIModels = async (apiUrl: string, apiKey: string): Promise<any[]> => {
    let baseUrl = apiUrl;
    if (!baseUrl || baseUrl.trim() === '') {
        baseUrl = 'https://api.openai.com/v1';
    }
    baseUrl = baseUrl.replace(/\/+$/, '');
    
    const endpoint = `${baseUrl}/models`;
    
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
    }

    try {
        const response = await fetch(endpoint, {
            method: 'GET',
            headers: headers
        });
        if (!response.ok) throw new Error("Fetch failed");
        const data = await response.json();
        if (Array.isArray(data.data)) {
            return data.data.map((m: any) => ({ id: m.id, name: m.id }));
        }
        return [];
    } catch (e) {
        console.warn("Failed to fetch OpenAI models list, returning empty.", e);
        return [];
    }
};

const fetchGoogleModels = async (apiKey: string, apiUrl: string, useCookie: boolean): Promise<any[]> => {
    let baseUrl = apiUrl;
    if (!baseUrl || baseUrl.trim() === '') {
        baseUrl = 'https://generativelanguage.googleapis.com';
    }
    baseUrl = baseUrl.replace(/\/+$/, '');

    let url = `${baseUrl}/v1beta/models`;
    
    const headers: Record<string, string> = {};
    if (!useCookie && apiKey) {
        url += `?key=${apiKey}`;
    }

    try {
        const response = await fetch(url, {
            method: 'GET',
            credentials: useCookie ? 'include' : 'same-origin',
            headers: headers
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Google API Error (${response.status}): ${errText}`);
        }
        
        const data = await response.json();
        if (data && Array.isArray(data.models)) {
            return data.models.map((m: any) => {
                const id = m.name.replace('models/', '');
                return {
                    id: id,
                    name: m.displayName || id,
                    description: m.description
                };
            });
        }
        return [];
    } catch (e: any) {
        console.error("Failed to fetch Google models:", e);
        throw new Error(e.message || "获取 Google 模型列表失败");
    }
};

export const generateResponse = async (
  messages: Message[],
  config: ChatConfig,
  onUpdate?: (text: string) => void,
  stickers?: Sticker[]
): Promise<string> => {
  
  // VALIDATION: Check for empty model before doing anything
  if (!config.model || config.model.trim() === '') {
      throw new Error("未配置模型。请在设置中获取并选择模型。");
  }

  if (config.provider === 'openai') {
    return await fetchOpenAIResponse(messages, config, onUpdate, stickers);
  }

  // Google Gemini Mode
  let apiKey = config.apiKey || process.env.API_KEY;
  const isCookieMode = config.googleAuthMode === 'cookie';

  if (isCookieMode) apiKey = 'COOKIE';
  
  // Allow empty API key if user is using a custom URL
  const baseUrl = (config.apiUrl && config.apiUrl.trim() !== '') ? config.apiUrl : undefined;
  
  // CRITICAL: If no key is present but we have a custom URL, we MUST provide a dummy string
  // because the GoogleGenAI SDK throws an error if apiKey is undefined/empty in constructor.
  if (!apiKey && baseUrl) {
      apiKey = 'no-key-needed';
  }

  if (!apiKey && !baseUrl) throw new Error("未找到 API Key，也未配置自定义 API 地址。");

  // Prepare History
  const allContext = messages.slice(0, -1);
  const trimmedContext = getTrimmedHistory(allContext, config.historyLimit);
  const totalMsgs = trimmedContext.length;
  const visualLimit = config.visualMemoryLimit ?? 3;
  const isNovelMode = config.dialogueMode === 'novel';

  const history = trimmedContext.map((msg, index) => {
    // Skip System messages in Google history
    if (msg.role === Role.SYSTEM) return null;

    const parts: any[] = [];
    
    // VISUAL MEMORY OPTIMIZATION:
    // Only keep heavy image data for the last few messages.
    // Older messages get their images replaced by text placeholders.
    const isRecent = index >= totalMsgs - visualLimit;

    // Check Metadata for Sticker
    if (msg.metadata?.isSticker && msg.metadata?.stickerDescription) {
        const identity = msg.role === Role.USER ? 'User' : 'Assistant';
        parts.push({ text: `[${identity} sent a sticker: ${msg.metadata.stickerDescription}]` });
    }
    else if (msg.metadata?.transferAmount) {
        const identity = msg.role === Role.USER ? 'User' : 'Assistant';
        let status = 'Pending';
        if (msg.metadata.transferStatus === 'accepted') status = 'Accepted';
        if (msg.metadata.transferStatus === 'refunded') status = 'Refunded';
        
        parts.push({ text: `[${identity} sent a transfer of ￥${msg.metadata.transferAmount}. Status: ${status}]` });
    } 
    else {
        let text = msg.content;
        
        // NOVEL MODE: Format history with tags
        if (isNovelMode && text) {
             if (msg.metadata?.isAction) {
                 text = `<action>${text}</action>`;
             } else {
                 text = `<say>${text}</say>`;
             }
        } else {
             // Normal mode: wrap actions in parens if they were parsed as actions
             if (msg.metadata?.isAction && text) {
                 text = `(${text})`;
             }
        }

        if (text) parts.push({ text: text });
        
        if (msg.attachments) {
            if (isRecent) {
                // RECENT: Send full data
                msg.attachments.forEach(att => {
                    if (att.type === 'image') {
                        parts.push({
                            inlineData: {
                                mimeType: att.mimeType,
                                data: extractBase64Data(att.data)
                            }
                        });
                    }
                });
            } else {
                 // OLD: Archive image
                 const identity = msg.role === Role.USER ? 'User' : 'Assistant';
                 parts.push({ text: `[System: ${identity} previously sent an image here. Image data archived to save context window.]` });
            }
        }
    }

    return {
        role: msg.role === Role.USER ? 'user' : 'model',
        parts: parts
    };
  }).filter(Boolean) as any[];

  // Prepare Current Prompt (User's latest message)
  const lastMessage = messages[messages.length - 1];
  const promptParts: any[] = [];

  if (lastMessage.metadata?.isSticker && lastMessage.metadata?.stickerDescription) {
      promptParts.push({ text: `[User sent a sticker: ${lastMessage.metadata.stickerDescription}]` });
  } 
  else if (lastMessage.metadata?.transferAmount) {
      promptParts.push({ text: `[User sent a transfer of ￥${lastMessage.metadata.transferAmount}]` });
  }
  else {
      let text = lastMessage.content;
      
      // If it's the current prompt, we check if the user manually input tags or brackets.
      // If the User is in Novel mode, we can try to wrap their text if they didn't. 
      // But typically, the prompt is raw user input.
      // However, if the user message was *already* parsed into an action (e.g. they typed (Look)),
      // we should wrap it.
      if (isNovelMode && text) {
          if (lastMessage.metadata?.isAction) {
               text = `<action>${text}</action>`;
          } else {
               // For user input, if they just typed text, we treat it as speech <say>.
               // But we don't want to double wrap if they typed tags.
               if (!text.trim().toLowerCase().startsWith('<say>') && !text.trim().toLowerCase().startsWith('<action>')) {
                   text = `<say>${text}</say>`;
               }
          }
      } else {
          // Normal mode bracket handling
          if (lastMessage.metadata?.isAction && text) {
              text = `(${text})`;
          }
      }
      
      if (text) promptParts.push({ text: text });
      if (lastMessage.attachments) {
          lastMessage.attachments.forEach(att => {
              if (att.type === 'image') {
                  promptParts.push({
                      inlineData: {
                          mimeType: att.mimeType,
                          data: extractBase64Data(att.data)
                      }
                  });
              }
          });
      }
  }

  const systemInstruction = buildSystemInstruction(config, stickers);
  
  const genConfig: any = {
    systemInstruction: systemInstruction,
    temperature: config.temperature,
    topP: config.topP,
    topK: config.topK,
  };

  if (config.thinkingBudget && config.thinkingBudget > 0) {
      genConfig.thinkingConfig = { thinkingBudget: config.thinkingBudget };
  }

  if (config.enableSearch) {
      genConfig.tools = [{ googleSearch: {} }];
  }

  try {
    const ai = new GoogleGenAI({ apiKey, baseUrl });
    const chat = ai.chats.create({
      model: config.model,
      history: history,
      config: genConfig,
    });

    if (config.enableStream && onUpdate) {
        const streamResponse = await chat.sendMessageStream({ message: { parts: promptParts } });
        let fullText = "";
        for await (const chunk of streamResponse) {
            if (chunk.text) {
                fullText += chunk.text;
                onUpdate(fullText);
            }
        }
        return fullText;
    } else {
        const result: GenerateContentResponse = await chat.sendMessage({
          message: { parts: promptParts }
        });
        const text = result.text || "";
        if (onUpdate) onUpdate(text);
        return text;
    }

  } catch (error: any) {
    console.error("Gemini API Error:", error);
    let msg = error.message || "生成回复失败";
    if (msg.includes("403") || msg.includes("PERMISSION_DENIED")) {
        msg = "权限被拒绝 (403)。请检查您的 API Key 是否正确，以及该 Key 是否有权访问当前选择的模型。";
    }
    // Specific error for Safety Block
    if (msg.includes("SAFETY") || msg.includes("blocked")) {
        msg = "内容已被安全过滤器拦截。";
    }
    throw new Error(msg);
  }
};

export const fetchAvailableModels = async (config: ChatConfig): Promise<any[]> => {
  const { provider, apiUrl, apiKey, googleAuthMode } = config;

  if (provider === 'openai') {
      return await fetchOpenAIModels(apiUrl, apiKey);
  }

  const isCookieMode = googleAuthMode === 'cookie';
  return await fetchGoogleModels(apiKey, apiUrl, isCookieMode);
};