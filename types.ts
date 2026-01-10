
export enum Role {
  USER = 'user',
  MODEL = 'model',
  SYSTEM = 'system', // New role for gray notifications
}

export interface Attachment {
  type: 'image';
  mimeType: string;
  data: string; // Base64 string
}

export interface Sticker {
  id: string;
  data: string; // Base64 string
  description: string; // The semantic meaning
}

export interface MessageMetadata {
  isSticker?: boolean;
  stickerDescription?: string;
  isAction?: boolean; // New: Identifies parsed action messages (from brackets)
  // Transfer fields
  transferAmount?: number;
  transferStatus?: 'pending' | 'accepted' | 'refunded';
  [key: string]: any;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
  attachments?: Attachment[];
  metadata?: MessageMetadata;
}

export type ApiProvider = 'google' | 'openai';

export type DialogueMode = 'normal' | 'novel';

export interface ChatConfig {
  provider: ApiProvider;
  googleAuthMode?: 'key' | 'cookie';
  apiUrl: string;
  apiKey: string;
  model: string;
  systemInstruction: string;
  temperature: number;
  topP: number;
  topK: number;
  // New features
  enableSearch?: boolean;      
  historyLimit?: number;       
  thinkingBudget?: number;     
  enableStream?: boolean;      
  enableStickers?: boolean;
  enableTransfer?: boolean; // New config
  dialogueMode?: DialogueMode; 
  // Performance
  visualMemoryLimit?: number;
}

export interface ChatSession {
  id: string;
  name: string;
  avatar: string;
  messages: Message[];
  lastMessagePreview?: string;
  lastMessageTime?: number;
  config: ChatConfig;
  isPinned?: boolean;
}

export interface ModelOption {
  id: string;
  name: string;
  description: string;
}

export interface AppTheme {
  userBubbleColor: string;
  botBubbleColor: string;
  actionTextColor?: string; // New: Custom color for action/narration text
  backgroundColor: string;
  backgroundImage?: string; // Custom background image (Base64)
}

export interface UserProfile {
  name: string;
  avatar: string;
  wechatId: string;
  stickers: Sticker[];
}

export interface LogEntry {
  id: string;
  timestamp: string;
  message: string;
  type: 'info' | 'error' | 'success';
}

export interface AppData {
  chats: ChatSession[];
  profile: UserProfile;
  theme: AppTheme;
}