
import React, { useState, useEffect, useRef } from 'react';
import { MOCK_CHATS, INITIAL_CONFIG, LOCAL_SERVER_URL, DEFAULT_THEME, DEFAULT_PROFILE, SERVER_SCRIPT_CONTENT } from './constants';
import { ChatSession, Message, Role, ChatConfig, AppTheme, UserProfile, LogEntry, AppData, Attachment, Sticker, DialogueMode } from './types';
import { generateResponse } from './services/geminiService';
import * as GithubService from './services/githubService';
import MessageBubble from './components/MessageBubble';
import ChatSettings from './components/ChatSettings';
import { 
  MessageSquare, 
  SendHorizontal, 
  MoreHorizontal, 
  Search,
  Plus,
  ArrowLeft,
  Loader2,
  Database,
  HardDrive,
  CloudOff,
  User,
  Settings,
  ChevronRight,
  QrCode,
  Palette,
  FileText,
  Check,
  Camera,
  Image as ImageIcon,
  X,
  Pin,
  PinOff,
  Trash2,
  Smile,
  PlusCircle,
  Pencil,
  CreditCard,
  RotateCcw,
  Upload,
  Download,
  Terminal,
  Save,
  RefreshCw,
  AlertTriangle,
  FileJson,
  Wifi,
  WifiOff,
  Scissors,
  ShieldAlert,
  Github,
  Cloud,
  CloudLightning,
  CloudCog,
  ToggleLeft,
  ToggleRight,
  Link,
  Eye,
  EyeOff,
  Copy
} from 'lucide-react';

const LS_KEY = 'wechat_ai_data_v2';
const LS_GITHUB_TOKEN = 'wechat_ai_github_token';
const LS_GIST_ID = 'wechat_ai_gist_id';
const LS_AUTO_SYNC = 'wechat_ai_auto_sync';
const LS_SYNC_MODE = 'wechat_ai_sync_mode'; // 'none' | 'local' | 'github'

// --- UTILS: Image Compression ---
const compressImage = async (base64: string, maxWidth: number, quality: number): Promise<string> => {
    return new Promise((resolve) => {
        const isWebP = base64.startsWith('data:image/webp');
        const sizeKB = (base64.length * 0.75) / 1024;
        if (isWebP && sizeKB < 512) { resolve(base64); return; }
        const img = new Image();
        img.src = base64;
        img.onload = () => {
            let width = img.width;
            let height = img.height;
            if (width > maxWidth) { height = Math.round((height * maxWidth) / width); width = maxWidth; }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) { resolve(base64); return; }
            ctx.drawImage(img, 0, 0, width, height);
            const newBase64 = canvas.toDataURL('image/webp', quality);
            if (newBase64.length < base64.length) { resolve(newBase64); } else { resolve(base64); }
        };
        img.onerror = () => { resolve(base64); };
    });
};

const formatTime = (timestamp?: number) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const isSameDay = date.getDate() === now.getDate() && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  if (isSameDay) { return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }); }
  return date.toLocaleDateString([], { month: '2-digit', day: '2-digit' });
};

const parseTextContent = (text: string, baseId: string, baseTimestamp: number, role: Role, dialogueMode: DialogueMode = 'normal'): Message[] => {
    if (dialogueMode !== 'novel' || role === Role.USER) {
         if (dialogueMode === 'normal') {
             const messages: Message[] = [];
             let counter = 0;
             let processed = text.replace(/([）\)])\s*([（\(])/g, '$1\n$2');
             processed = processed.replace(/([）\)])(?=[^（\(\r\n])/g, '$1\n');
             processed = processed.replace(/([^）\)\r\n])(?=[（\(])/g, '$1\n');
             const lines = processed.split('\n');
             lines.forEach((line) => {
                const trimmed = line.trim();
                if (!trimmed) return;
                const isAction = /^([（\(].*?[）\)])$/.test(trimmed);
                if (isAction) {
                     const content = trimmed.replace(/^[（\(]|[）\)]$/g, '');
                     if (content.trim()) {
                         messages.push({ id: `${baseId}_part_${counter++}`, role: role, content: content.trim(), timestamp: baseTimestamp + counter, metadata: { isAction: true } });
                     }
                 } else {
                     messages.push({ id: `${baseId}_part_${counter++}`, role: role, content: trimmed, timestamp: baseTimestamp + counter });
                 }
            });
            return messages;
         }
         return [{ id: baseId, role: role, content: text, timestamp: baseTimestamp }];
    }
    const messages: Message[] = [];
    let counter = 0;
    const tagRegex = /<(action|say)>(.*?)(?:<\/\1>|(?=<)|$)/gsi;
    let lastIndex = 0;
    let match;
    while ((match = tagRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            const preText = text.substring(lastIndex, match.index).trim();
            if (preText) { messages.push({ id: `${baseId}_part_${counter++}`, role: role, content: preText, timestamp: baseTimestamp + counter }); }
        }
        const tagName = match[1].toLowerCase();
        const content = match[2].trim();
        if (content) {
            if (tagName === 'action') { messages.push({ id: `${baseId}_part_${counter++}`, role: role, content: content, timestamp: baseTimestamp + counter, metadata: { isAction: true } }); } 
            else if (tagName === 'say') { messages.push({ id: `${baseId}_part_${counter++}`, role: role, content: content, timestamp: baseTimestamp + counter }); }
        }
        lastIndex = tagRegex.lastIndex;
    }
    if (lastIndex < text.length) {
        const remaining = text.substring(lastIndex).trim();
        if (remaining) { messages.push({ id: `${baseId}_part_${counter++}`, role: role, content: remaining, timestamp: baseTimestamp + counter }); }
    }
    if (messages.length === 0 && text.trim()) { messages.push({ id: baseId, role: role, content: text.trim(), timestamp: baseTimestamp }); }
    return messages;
};

const splitTextIntoMessages = (fullText: string, baseTimestamp: number, stickers: Sticker[], role: Role, dialogueMode: DialogueMode): Message[] => {
    if (!fullText) return [];
    let cleanText = fullText.replace(/^\[(User|Assistant|System).*?\]\s*$/gm, '').trim();
    cleanText = cleanText.replace(/<ACCEPT_TRANSFER>/g, '').trim();
    cleanText = cleanText.replace(/<REJECT_TRANSFER>/g, '').trim();
    if (!cleanText) return [];
    const tagRegex = /(<STICKER:[^>]+>|<TRANSFER:[^>]+>)/;
    const rawSegments = cleanText.split(tagRegex);
    const messages: Message[] = [];
    let currentIdCounter = 0;
    rawSegments.forEach(segment => {
        if (!segment || !segment.trim()) return;
        const trimmed = segment.trim();
        const stickerMatch = trimmed.match(/^<STICKER:(.+?)>$/);
        const transferMatch = trimmed.match(/^<TRANSFER:(\d+(\.\d+)?)>$/);
        if (stickerMatch) {
            const stickerId = stickerMatch[1];
            const sticker = stickers.find(s => s.id === stickerId);
            if (sticker) { messages.push({ id: (baseTimestamp + currentIdCounter++).toString(), role: role, content: '', timestamp: baseTimestamp + currentIdCounter, attachments: [{ type: 'image', mimeType: 'image/png', data: sticker.data }], metadata: { isSticker: true, stickerDescription: sticker.description } }); } 
            else { messages.push({ id: (baseTimestamp + currentIdCounter++).toString(), role: role, content: '[表情失效]', timestamp: baseTimestamp + currentIdCounter }); }
        } else if (transferMatch) {
            const amount = parseFloat(transferMatch[1]);
            messages.push({ id: (baseTimestamp + currentIdCounter++).toString(), role: role, content: '', timestamp: baseTimestamp + currentIdCounter, metadata: { transferAmount: amount, transferStatus: 'pending' } });
        } else {
            const parsedMsgs = parseTextContent(trimmed, (baseTimestamp + currentIdCounter).toString(), baseTimestamp + currentIdCounter, role, dialogueMode);
            currentIdCounter += parsedMsgs.length;
            messages.push(...parsedMsgs);
        }
    });
    return messages;
};

const App = () => {
  const [chats, setChats] = useState<ChatSession[]>(MOCK_CHATS);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [theme, setTheme] = useState<AppTheme>(DEFAULT_THEME);
  
  const [activeTab, setActiveTab] = useState<'chat' | 'me'>('chat');
  const [meNavStack, setMeNavStack] = useState<string[]>([]); 

  const [inputMessage, setInputMessage] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [pendingImage, setPendingImage] = useState<Attachment | null>(null);
  const [showStickerPicker, setShowStickerPicker] = useState(false);
  
  const [stickerUpload, setStickerUpload] = useState<{file: File, preview: string} | null>(null);
  const [newStickerDesc, setNewStickerDesc] = useState('');
  const [isManageStickers, setIsManageStickers] = useState(false);
  const [stickerToDelete, setStickerToDelete] = useState<string | null>(null);

  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferAmount, setTransferAmount] = useState('');
  const [transferActionMsg, setTransferActionMsg] = useState<Message | null>(null);

  const [regenerateMsgId, setRegenerateMsgId] = useState<string | null>(null);
  const [showSlimmingModal, setShowSlimmingModal] = useState(false);
  const [isSlimming, setIsSlimming] = useState(false);
  const [slimmingResult, setSlimmingResult] = useState<{ freedKB: number, count: number } | null>(null);
  const [sidebarMenu, setSidebarMenu] = useState<{x: number, y: number, chatId: string} | null>(null);
  const [showClearDataModal, setShowClearDataModal] = useState(false);
  const [chatToDeleteId, setChatToDeleteId] = useState<string | null>(null);

  // Sync State
  const [syncMode, setSyncMode] = useState<'none' | 'local' | 'github'>('none');
  const [syncStatus, setSyncStatus] = useState<'connected' | 'browser-storage' | 'saving' | 'error' | 'offline'>('offline');
  const [statusMsg, setStatusMsg] = useState('');
  const [isFirstLoad, setIsFirstLoad] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isCloudInitialized, setIsCloudInitialized] = useState(false);
  const [isLocalInitialized, setIsLocalInitialized] = useState(false);
  
  const [githubToken, setGithubToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [gistId, setGistId] = useState('');
  const [enableAutoSync, setEnableAutoSync] = useState(false);
  // Refined states: 'idle' | 'checking' | 'uploading' | 'downloading' | 'success' | 'error' | 'disconnected'
  const [githubSyncStatus, setGithubSyncStatus] = useState<string>('disconnected');
  const [githubSyncMsg, setGithubSyncMsg] = useState('');
  
  // Flag to prevent auto-sync loop when downloading data
  const ignoreAutoSyncRef = useRef(false);

  const [logs, setLogs] = useState<LogEntry[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const saveTimeoutRef = useRef<any>(null);
  const githubSaveTimeoutRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatImageInputRef = useRef<HTMLInputElement>(null);
  const stickerInputRef = useRef<HTMLInputElement>(null);
  const bgImageInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const activeChat = chats.find(c => c.id === activeChatId);
  const sortedChats = [...chats].sort((a, b) => {
      if (a.isPinned !== b.isPinned) { return a.isPinned ? -1 : 1; }
      return (b.lastMessageTime || 0) - (a.lastMessageTime || 0);
  });
  
  let lastUserIndex = -1;
  if (activeChat) {
      for (let i = activeChat.messages.length - 1; i >= 0; i--) {
          if (activeChat.messages[i].role === Role.USER) { lastUserIndex = i; break; }
      }
  }

  useEffect(() => {
      const handleClick = () => { setSidebarMenu(null); };
      window.addEventListener('click', handleClick);
      return () => window.removeEventListener('click', handleClick);
  }, []);

  const addLog = (message: string, type: 'info' | 'error' | 'success' = 'info') => {
    const entry: LogEntry = { id: Date.now().toString() + Math.random().toString().slice(2,5), timestamp: new Date().toLocaleTimeString(), message, type };
    setLogs(prev => [entry, ...prev].slice(0, 200));
  };

  // --- LOCAL SYNC ACTIONS ---
  const testLocalConnection = async () => {
      setIsConnecting(true);
      addLog("正在测试本地服务器连接...", "info");
      try {
          const rootUrl = LOCAL_SERVER_URL.replace('/data', '');
          const res = await fetch(`${rootUrl}/ping`, { method: 'GET', mode: 'cors' });
          if (res.ok) {
              setSyncStatus('connected');
              addLog("本地服务器连接成功 (ONLINE)", "success");
          } else {
              setSyncStatus('error');
              addLog(`服务器响应错误: ${res.status}`, "error");
          }
      } catch (e: any) {
          setSyncStatus('offline');
          addLog(`连接失败: ${e.message}`, "error");
          addLog("如果是 'Failed to fetch'，请点击右侧'信任证书'。", "info");
      } finally {
          setIsConnecting(false);
      }
  };
  
  const openTrustCertUrl = () => {
      window.open('https://127.0.0.1:3001', '_blank');
      addLog("已打开新窗口。请点击 '高级' -> '继续前往' 以信任证书。", "info");
  };

  const handleLocalPush = async (isSilent = false) => {
      if (!isSilent) addLog('正在上传到本地服务器...', 'info');
      try {
          const payload: AppData = { chats, profile, theme };
          const res = await fetch(LOCAL_SERVER_URL, {
              method: 'POST',
              mode: 'cors',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
          });
          if (res.ok) {
              setSyncStatus('connected');
              if (!isSilent) addLog('上传成功', 'success');
          } else {
              throw new Error(`Status ${res.status}`);
          }
      } catch (e: any) {
          setSyncStatus('error');
          if (!isSilent) addLog(`上传失败: ${e.message}`, 'error');
      }
  };

  const handleLocalPull = async () => {
      addLog('正在从本地服务器下载...', 'info');
      try {
          // Removed ?t=... to prevent 404s on strict servers
          const res = await fetch(LOCAL_SERVER_URL, { 
              method: 'GET', 
              mode: 'cors',
              cache: 'no-store' 
          });
          
          if (res.ok) {
              const serverData = await res.json();
              if (serverData && serverData.chats) {
                  setChats(serverData.chats);
                  setProfile(prev => ({...prev, ...serverData.profile}));
                  setTheme(prev => ({...prev, ...serverData.theme}));
                  addLog("已从服务器覆盖本地数据", "success");
                  setSyncStatus('connected');
              } else {
                  addLog("服务器数据为空，未执行导入", "info");
              }
          } else {
              throw new Error(`Status ${res.status}`);
          }
      } catch (e: any) {
          setSyncStatus('error');
          addLog(`下载失败: ${e.message}`, 'error');
      }
  };

  const toggleLocalAutoSync = async () => {
      if (syncMode === 'local' && enableAutoSync) {
          setEnableAutoSync(false);
          setSyncMode('none');
          localStorage.setItem(LS_AUTO_SYNC, 'false');
          localStorage.setItem(LS_SYNC_MODE, 'none');
          addLog('已关闭本地自动同步', 'info');
          return;
      }

      if (syncMode === 'github') {
          addLog('已切换至本地模式，GitHub 同步已关闭', 'info');
      }

      setSyncMode('local');
      setIsConnecting(true);

      try {
          // Check connection FIRST to catch certificate errors
          const rootUrl = LOCAL_SERVER_URL.replace('/data', '');
          const ping = await fetch(`${rootUrl}/ping`, { method: 'GET', mode: 'cors' });
          if (!ping.ok) throw new Error("无法连接到服务器");

          // Remove ?t=... parameter to fix 404 error
          const res = await fetch(LOCAL_SERVER_URL, { 
              method: 'GET', 
              mode: 'cors',
              cache: 'no-store'
          });
          
          if (res.ok) {
              const serverData = await res.json();
              if (serverData && !Array.isArray(serverData) && serverData.chats) {
                   setChats(serverData.chats);
                   setProfile(prev => ({...prev, ...serverData.profile}));
                   setTheme(prev => ({...prev, ...serverData.theme}));
                   addLog("自动同步开启：已从服务器拉取现有数据", "success");
              } else {
                   await handleLocalPush(true);
                   addLog("自动同步开启：服务器无备份，已上传当前数据", "success");
              }
              setEnableAutoSync(true);
              localStorage.setItem(LS_AUTO_SYNC, 'true');
              localStorage.setItem(LS_SYNC_MODE, 'local');
              setIsLocalInitialized(true);
              setSyncStatus('connected');
          } else {
               throw new Error(`服务器响应: ${res.status}`);
          }
      } catch(e: any) {
          setSyncMode('none');
          setEnableAutoSync(false);
          setSyncStatus('error');
          const msg = e.message || '';
          if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
              addLog('开启失败：浏览器拦截了请求，请先点击"信任证书"按钮。', 'error');
          } else if (msg.includes('404')) {
              addLog('开启失败：服务器返回 404 (路径错误)，请确保 server.js 已更新。', 'error');
          } else {
              addLog(`开启自动同步失败: ${e.message}`, 'error');
          }
      } finally {
          setIsConnecting(false);
      }
  };

  useEffect(() => {
    const timer = setInterval(async () => {
        if (syncMode === 'local' && (syncStatus === 'connected' || syncStatus === 'error')) {
            try {
                const rootUrl = LOCAL_SERVER_URL.replace('/data', '');
                const res = await fetch(`${rootUrl}/ping`, { method: 'GET', mode: 'cors' });
                if (!res.ok) throw new Error("Ping Failed");
                if (syncStatus === 'error') setSyncStatus('connected');
            } catch (e) {
                setSyncStatus('error');
            }
        }
    }, 10000); 
    return () => clearTimeout(timer);
  }, [syncStatus, syncMode]);

  useEffect(() => {
    const loadData = async () => {
        addLog("WeChat AI 初始化...", "info");
        try {
            const localData = localStorage.getItem(LS_KEY);
            const token = localStorage.getItem(LS_GITHUB_TOKEN);
            const savedGistId = localStorage.getItem(LS_GIST_ID);
            const savedAutoSync = localStorage.getItem(LS_AUTO_SYNC);
            const savedSyncMode = localStorage.getItem(LS_SYNC_MODE) as any;

            if (token) setGithubToken(token);
            if (savedGistId) setGistId(savedGistId);
            
            const mode = savedSyncMode === 'github' || savedSyncMode === 'local' ? savedSyncMode : 'none';
            setSyncMode(mode);
            setEnableAutoSync(savedAutoSync === 'true');

            if (localData) {
                const parsed = JSON.parse(localData);
                setSyncStatus('browser-storage');
                if (parsed.chats) setChats(parsed.chats);
                if (parsed.profile) setProfile({...DEFAULT_PROFILE, ...parsed.profile});
                if (parsed.theme) setTheme({...DEFAULT_THEME, ...parsed.theme});
            } else {
                addLog("未找到本地缓存，初始化新会话", "info");
            }
            
            if (mode === 'github' && savedAutoSync === 'true' && token) {
                // Initial check and download with timeout protection
                try {
                    setGithubSyncStatus('checking');

                    // Add timeout wrapper for all GitHub operations
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error('网络请求超时 (10秒)')), 10000)
                    );

                    const check = await Promise.race([
                        GithubService.validateToken(token),
                        timeoutPromise
                    ]) as any;

                    if (!check.valid) {
                         setGithubSyncStatus('error');
                         setGithubSyncMsg(check.errorMsg || 'Token 无效');
                         addLog(`GitHub 连接失败: ${check.errorMsg}`, 'error');
                         setIsCloudInitialized(true);
                    } else {
                        const cloudGistId = savedGistId || await Promise.race([
                            GithubService.findBackupGist(token),
                            timeoutPromise
                        ]) as any;

                        if (cloudGistId) {
                            setGistId(cloudGistId);
                            localStorage.setItem(LS_GIST_ID, cloudGistId);

                            setGithubSyncStatus('downloading');

                            const cloudData = await Promise.race([
                                GithubService.getGistContent(token, cloudGistId),
                                timeoutPromise
                            ]) as any;

                            if (cloudData) {
                                ignoreAutoSyncRef.current = true;

                                setChats(cloudData.chats);
                                setProfile(cloudData.profile);
                                setTheme(cloudData.theme);
                                setGithubSyncStatus('success');
                                setGithubSyncMsg('已同步云端');
                                addLog('启动时已自动从 GitHub 加载最新数据', 'success');
                            } else {
                                setGithubSyncStatus('error');
                                setGithubSyncMsg('无法下载云端数据');
                                addLog('GitHub 云端数据下载失败', 'error');
                            }
                        } else {
                            setGithubSyncStatus('error');
                            setGithubSyncMsg('未找到备份');
                            addLog('GitHub 未找到备份文件', 'info');
                        }
                        setIsCloudInitialized(true);
                    }
                } catch (e: any) {
                    setGithubSyncStatus('error');
                    const errMsg = e.message || '网络错误';
                    setGithubSyncMsg(errMsg);
                    addLog(`GitHub 初始化失败: ${errMsg}`, 'error');
                    setIsCloudInitialized(true);
                }
            } 
            else if (mode === 'local' && savedAutoSync === 'true') {
                 setIsConnecting(true);
                 try {
                     // Add timeout protection for local server
                     const timeoutPromise = new Promise<Response>((_, reject) =>
                         setTimeout(() => reject(new Error('本地服务器超时')), 8000)
                     );

                     const res = await Promise.race([
                         fetch(LOCAL_SERVER_URL, { method: 'GET', mode: 'cors', cache: 'no-store' }),
                         timeoutPromise
                     ]);

                     if (res.ok) {
                         const serverData = await res.json();
                         if (serverData && serverData.chats) {
                             setChats(serverData.chats);
                             setProfile(prev => ({...prev, ...serverData.profile}));
                             setTheme(prev => ({...prev, ...serverData.theme}));
                             addLog("已恢复本地自动同步并拉取最新数据", "success");
                         }
                         setSyncStatus('connected');
                         setIsLocalInitialized(true);
                     } else {
                         setSyncStatus('error');
                         setIsLocalInitialized(true);
                         addLog("无法连接本地服务器，同步暂停", "error");
                     }
                 } catch(e: any) {
                     setSyncStatus('offline');
                     setIsLocalInitialized(true);
                     const errMsg = e.message || '连接失败';
                     addLog(`无法连接本地服务器: ${errMsg}`, "error");
                 } finally {
                     setIsConnecting(false);
                 }
            } else {
                setIsCloudInitialized(true);
                setIsLocalInitialized(true);
            }
        } catch (e: any) { 
            addLog(`读取初始化数据失败: ${e.message}`, "error");
            setIsCloudInitialized(true);
            setIsLocalInitialized(true);
        }
        setIsFirstLoad(false);
    };
    loadData();
  }, []);

  useEffect(() => {
    if (isFirstLoad) return; 
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    if (githubSaveTimeoutRef.current) clearTimeout(githubSaveTimeoutRef.current);

    setSyncStatus('saving');
    const payload: AppData = { chats, profile, theme };
    localStorage.setItem(LS_KEY, JSON.stringify(payload));

    if (syncMode === 'local' && enableAutoSync && isLocalInitialized) {
        saveTimeoutRef.current = setTimeout(async () => {
            try {
                const res = await fetch(LOCAL_SERVER_URL, {
                    method: 'POST',
                    mode: 'cors',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    setSyncStatus('connected');
                    setStatusMsg('已同步');
                } else {
                    setSyncStatus('error');
                }
            } catch (e) { setSyncStatus('error'); }
        }, 1500);
    } 
    else if (syncMode === 'github' && enableAutoSync && githubToken && isCloudInitialized) {
        // Prevent upload loop if the change was caused by a download
        if (ignoreAutoSyncRef.current) {
            ignoreAutoSyncRef.current = false;
            setSyncStatus('browser-storage'); // Data is "saved" locally (from cloud)
        } else {
            setGithubSyncStatus('uploading'); // Use specific status
            githubSaveTimeoutRef.current = setTimeout(async () => {
                 await performGithubSync(true); 
            }, 4000);
            setSyncStatus('browser-storage');
        }
    } 
    else {
        setSyncStatus('browser-storage');
        setStatusMsg('已保存到浏览器');
    }
    
    return () => {
        clearTimeout(saveTimeoutRef.current);
        clearTimeout(githubSaveTimeoutRef.current);
    };
  }, [chats, profile, theme, isFirstLoad, enableAutoSync, githubToken, isCloudInitialized, isLocalInitialized, syncMode]);

  useEffect(() => {
    if (activeChatId) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeChat?.messages.length, activeChatId]);

  const handleConnectGithub = async () => {
      const cleanToken = githubToken.replace(/[\s\uFEFF\xA0]+/g, '');
      if (!cleanToken) { addLog("请输入 GitHub Token", 'error'); return; }
      setGithubToken(cleanToken);
      localStorage.setItem(LS_GITHUB_TOKEN, cleanToken);
      setGithubSyncStatus('checking');
      setGithubSyncMsg('验证 Token...');
      const check = await GithubService.validateToken(cleanToken);
      if (check.valid) {
          setGithubSyncStatus('success');
          setGithubSyncMsg('Token 有效');
          addLog("GitHub Token 验证成功！正在查找备份...", 'success');
          const foundId = await GithubService.findBackupGist(cleanToken);
          if (foundId) {
              setGistId(foundId);
              localStorage.setItem(LS_GIST_ID, foundId);
              setGithubSyncMsg('已连接备份');
              addLog("发现现有云端备份，请点击“下载”或开启自动同步。", 'info');
          } else {
              setGithubSyncMsg('无备份');
              addLog("Token 有效，但未找到现有备份。点击“上传”即可创建。", 'info');
          }
      } else {
          setGithubSyncStatus('error');
          setGithubSyncMsg('连接失败');
          addLog(`GitHub 连接失败: ${check.errorMsg}`, 'error');
      }
  };

  const performGithubSync = async (isAutoSave = false) => {
      const cleanToken = githubToken.replace(/[\s\uFEFF\xA0]+/g, '');
      if (!cleanToken) { if (!isAutoSave) addLog("GitHub Token 为空", 'error'); return; }
      
      setGithubSyncStatus('uploading'); // Explicitly set to uploading
      if (!isAutoSave) addLog('开始同步到 GitHub...', 'info');
      
      try {
          const payload: AppData = { chats, profile, theme };
          let targetGistId = gistId;
          if (!targetGistId) {
              const foundId = await GithubService.findBackupGist(cleanToken);
              if (foundId) { targetGistId = foundId; setGistId(foundId); localStorage.setItem(LS_GIST_ID, foundId); } 
              else {
                  const newId = await GithubService.createBackupGist(cleanToken, payload);
                  if (newId) { setGistId(newId); localStorage.setItem(LS_GIST_ID, newId); targetGistId = newId; addLog('已创建新的云端备份 Gist', 'success'); } 
                  else { throw new Error("无法创建 Gist (权限不足或网络问题)"); }
              }
          }
          if (targetGistId) {
              const success = await GithubService.updateBackupGist(cleanToken, targetGistId, payload);
              if (success) {
                  setGithubSyncStatus('success');
                  setGithubSyncMsg('已同步');
                  if (!isAutoSave) addLog('数据已成功上传到 GitHub', 'success');
              } else { throw new Error("更新 Gist 失败 (网络错误或权限不足)"); }
          }
      } catch (e: any) {
          setGithubSyncStatus('error');
          setGithubSyncMsg('同步失败');
          if (!isAutoSave) addLog(`GitHub 同步失败: ${e.message}`, 'error');
      }
  };

  const handleGithubPull = async () => {
      const cleanToken = githubToken.replace(/[\s\uFEFF\xA0]+/g, '');
      if (!cleanToken) { addLog("请先输入 Token", 'error'); return; }
      
      setGithubSyncStatus('downloading'); // Explicitly set to downloading
      addLog('正在从 GitHub 下载...', 'info');
      
      // Set flag to ignore the next auto-save triggered by state changes
      ignoreAutoSyncRef.current = true;

      const targetGistId = gistId || await GithubService.findBackupGist(cleanToken);
      if (targetGistId) {
          setGistId(targetGistId);
          localStorage.setItem(LS_GIST_ID, targetGistId);
          const data = await GithubService.getGistContent(cleanToken, targetGistId);
          if (data) {
              setChats(data.chats);
              setProfile(data.profile);
              setTheme(data.theme);
              setGithubSyncStatus('success');
              setGithubSyncMsg('已下载');
              addLog('已从云端覆盖本地数据', 'success');
              setIsCloudInitialized(true); 
          } else {
              setGithubSyncStatus('error');
              addLog('下载数据失败 (无法读取 Gist 内容)', 'error');
          }
      } else {
          setGithubSyncStatus('error');
          addLog('云端未找到备份文件', 'error');
      }
  };

  const toggleGithubAutoSync = async () => {
      if (enableAutoSync && syncMode === 'github') {
          setEnableAutoSync(false);
          setSyncMode('none');
          localStorage.setItem(LS_AUTO_SYNC, 'false');
          localStorage.setItem(LS_SYNC_MODE, 'none');
          addLog('已关闭 GitHub 自动同步', 'info');
          return;
      }
      const cleanToken = githubToken.replace(/[\s\uFEFF\xA0]+/g, '');
      if (!cleanToken) { addLog('请先填写 GitHub Token', 'error'); return; }
      if (syncMode === 'local') {
          setSyncStatus('offline');
          setIsLocalInitialized(false);
          addLog('已切换至 GitHub 模式，本地服务器同步已断开', 'info');
      }
      setSyncMode('github');
      localStorage.setItem(LS_SYNC_MODE, 'github');
      setGithubSyncStatus('checking');
      addLog('正在检查云端备份...', 'info');
      try {
          const foundId = gistId || await GithubService.findBackupGist(cleanToken);
          if (foundId) {
              addLog('发现云端备份，正在下载以同步...', 'info');
              setGistId(foundId);
              localStorage.setItem(LS_GIST_ID, foundId);
              setGithubSyncStatus('downloading'); // Show download status
              
              const data = await GithubService.getGistContent(cleanToken, foundId);
              if (data) {
                  // CRITICAL: Set ignore flag here too
                  ignoreAutoSyncRef.current = true;
                  setChats(data.chats);
                  setProfile(data.profile);
                  setTheme(data.theme);
                  setIsCloudInitialized(true);
                  setEnableAutoSync(true);
                  localStorage.setItem(LS_AUTO_SYNC, 'true');
                  setGithubSyncStatus('success');
                  setGithubSyncMsg('已同步');
                  addLog('已从云端恢复数据，自动同步已开启', 'success');
              } else { throw new Error("无法读取云端数据"); }
          } else {
              addLog('未检测到云端备份，将创建新备份...', 'info');
              await performGithubSync(); 
              setEnableAutoSync(true);
              localStorage.setItem(LS_AUTO_SYNC, 'true');
              setIsCloudInitialized(true);
              addLog('自动同步已开启', 'success');
          }
      } catch (e: any) {
          setGithubSyncStatus('error');
          setGithubSyncMsg('同步开启失败');
          addLog(`开启自动同步失败: ${e.message}`, 'error');
          setEnableAutoSync(false);
      }
  };

  const handleGithubTokenBlur = () => {
      const clean = githubToken.replace(/[\s\uFEFF\xA0]+/g, '');
      setGithubToken(clean);
      localStorage.setItem(LS_GITHUB_TOKEN, clean);
  };
  
  const getTokenFormatHint = () => {
      if (!githubToken) return null;
      if (githubToken.startsWith('ghp_')) return { text: '格式正确 (Classic Token)', color: 'text-green-500' };
      if (githubToken.startsWith('github_pat_')) return { text: '格式正确 (Fine-grained Token)', color: 'text-green-500' };
      return { text: '提示: Token 通常以 ghp_ 或 github_pat_ 开头', color: 'text-orange-500' };
  };

  // ... (Other handlers like processAIResponse, handleSendMessage, etc.)
  const processAIResponse = (currentChatId: string, resultText: string, timestamp: number) => {
      if (resultText.includes('<ACCEPT_TRANSFER>')) {
          setChats(prev => prev.map(chat => {
              if (chat.id === currentChatId) {
                  const msgs = [...chat.messages];
                  let transferFound = false;
                  for (let i = msgs.length - 1; i >= 0; i--) {
                      if (msgs[i].role === Role.USER && msgs[i].metadata?.transferAmount && msgs[i].metadata?.transferStatus === 'pending') {
                          msgs[i] = { ...msgs[i], metadata: { ...msgs[i].metadata, transferStatus: 'accepted' } };
                          const sysMsg: Message = { id: Date.now().toString() + '_sys', role: Role.SYSTEM, content: `${chat.name} 已接收您的转账`, timestamp: msgs[i].timestamp + 1 };
                          msgs.splice(i + 1, 0, sysMsg);
                          transferFound = true;
                          break; 
                      }
                  }
                  if (transferFound) return { ...chat, messages: msgs };
              }
              return chat;
          }));
      }
      if (resultText.includes('<REJECT_TRANSFER>')) {
          setChats(prev => prev.map(chat => {
              if (chat.id === currentChatId) {
                  const msgs = [...chat.messages];
                  let transferFound = false;
                  for (let i = msgs.length - 1; i >= 0; i--) {
                      if (msgs[i].role === Role.USER && msgs[i].metadata?.transferAmount && msgs[i].metadata?.transferStatus === 'pending') {
                          msgs[i] = { ...msgs[i], metadata: { ...msgs[i].metadata, transferStatus: 'refunded' } };
                          const sysMsg: Message = { id: Date.now().toString() + '_sys', role: Role.SYSTEM, content: `对方已退还您的转账`, timestamp: msgs[i].timestamp + 1 };
                          msgs.splice(i + 1, 0, sysMsg);
                          transferFound = true;
                          break; 
                      }
                  }
                  if (transferFound) return { ...chat, messages: msgs };
              }
              return chat;
          }));
      }
      
      const chat = chats.find(c => c.id === currentChatId);
      const mode = chat?.config.dialogueMode || 'normal';
      
      const finalMessages = splitTextIntoMessages(resultText, timestamp + 1, profile.stickers, Role.MODEL, mode);
      return finalMessages;
  };

  const handleSendMessage = async () => {
    if ((!inputMessage.trim() && !pendingImage) || !activeChat || isProcessing) return;
    if (!activeChat.config.model) {
        addLog("发送失败: 未配置 AI 模型。请先在设置中选择模型。", "error");
        setShowSettings(true);
        return;
    }
    const currentChatId = activeChat.id;
    const userText = inputMessage.trim();
    const attachments = pendingImage ? [pendingImage] : undefined;
    const timestamp = Date.now();
    setInputMessage('');
    setPendingImage(null);
    setShowPlusMenu(false);
    if (inputRef.current) inputRef.current.style.height = 'auto';

    const mode = activeChat.config.dialogueMode || 'normal';
    let userMessages: Message[] = [];
    
    if (attachments) {
        userMessages = [{ id: timestamp.toString(), role: Role.USER, content: userText, timestamp: timestamp, attachments: attachments }];
    } else {
        userMessages = parseTextContent(userText, timestamp.toString(), timestamp, Role.USER, mode);
    }
    
    const aiMsgId = (timestamp + userMessages.length + 10).toString(); 
    const aiPlaceholderMsg: Message = { id: aiMsgId, role: Role.MODEL, content: '', timestamp: timestamp + userMessages.length + 11 };

    const currentHistory = activeChat.messages;
    const messagesForApi = [...currentHistory, ...userMessages];

    setChats(prev => prev.map(chat => chat.id === currentChatId ? { ...chat, messages: [...chat.messages, ...userMessages, aiPlaceholderMsg], lastMessagePreview: userText || '[图片]', lastMessageTime: timestamp } : chat));
    setIsProcessing(true);

    try {
      const updateContent = (text: string) => {
          setChats(prev => prev.map(chat => {
              if (chat.id === currentChatId) {
                  return { ...chat, messages: chat.messages.map(m => m.id === aiMsgId ? { ...m, content: text } : m), lastMessagePreview: text };
              }
              return chat;
          }));
      };
      
      const resultText = await generateResponse(messagesForApi, activeChat.config || INITIAL_CONFIG, updateContent, profile.stickers);
      const finalMessages = processAIResponse(currentChatId, resultText, timestamp + userMessages.length + 20);
      
      setChats(prev => prev.map(chat => {
          if (chat.id === currentChatId) {
              const newMessages = chat.messages.filter(m => m.id !== aiMsgId).concat(finalMessages);
              const last = finalMessages[finalMessages.length - 1];
              let preview = last?.content || "";
              if (!preview && last?.attachments) preview = "[表情包]";
              if (!preview && last?.metadata?.transferAmount) preview = "[转账]";
              return { ...chat, messages: newMessages, lastMessagePreview: preview };
          }
          return chat;
      }));
    } catch (error: any) {
       addLog(`生成回复错误: ${error.message}`, 'error');
       setChats(prev => prev.map(chat => {
           if (chat.id === currentChatId) { return { ...chat, messages: chat.messages.map(m => m.id === aiMsgId ? { ...m, content: `错误: ${error.message}` } : m) }; }
           return chat;
       }));
    } finally { setIsProcessing(false); }
  };

  // ... (Other actions like handleSendSticker, handleSendTransfer etc. restored)
  const handleSendSticker = async (sticker: Sticker) => {
      if (!activeChat || isProcessing) return;
      if (!activeChat.config.model) { addLog("发送表情失败: 未配置 AI 模型。", "error"); setShowSettings(true); return; }
      const currentChatId = activeChat.id;
      const timestamp = Date.now();
      setShowPlusMenu(false);
      const userMsg: Message = { id: timestamp.toString(), role: Role.USER, content: '', timestamp: timestamp, attachments: [{ type: 'image', mimeType: 'image/png', data: sticker.data }], metadata: { isSticker: true, stickerDescription: sticker.description } };
      const aiMsgId = (timestamp + 1).toString();
      const aiPlaceholderMsg: Message = { id: aiMsgId, role: Role.MODEL, content: '', timestamp: timestamp + 1 };
      const currentHistory = activeChat.messages;
      setChats(prev => prev.map(chat => chat.id === currentChatId ? { ...chat, messages: [...chat.messages, userMsg, aiPlaceholderMsg], lastMessagePreview: '[表情包]', lastMessageTime: timestamp } : chat));
      setIsProcessing(true);
      try {
          const updateContent = (text: string) => { setChats(prev => prev.map(chat => { if (chat.id === currentChatId) { return { ...chat, messages: chat.messages.map(m => m.id === aiMsgId ? { ...m, content: text } : m), lastMessagePreview: text }; } return chat; })); };
          const resultText = await generateResponse([...currentHistory, userMsg], activeChat.config || INITIAL_CONFIG, updateContent, profile.stickers);
          const finalMessages = processAIResponse(currentChatId, resultText, timestamp);
          setChats(prev => prev.map(chat => { if (chat.id === currentChatId) { const newMessages = chat.messages.filter(m => m.id !== aiMsgId).concat(finalMessages); const last = finalMessages[finalMessages.length - 1]; let preview = last?.content || ""; if (!preview && last?.attachments) preview = "[表情包]"; if (!preview && last?.metadata?.transferAmount) preview = "[转账]"; return { ...chat, messages: newMessages, lastMessagePreview: preview }; } return chat; }));
      } catch (error: any) { addLog(`Error: ${error.message}`, 'error'); setChats(prev => prev.map(chat => { if (chat.id === currentChatId) { return { ...chat, messages: chat.messages.map(m => m.id === aiMsgId ? { ...m, content: `错误: ${error.message}` } : m) }; } return chat; })); } finally { setIsProcessing(false); }
  };

  const handleSendTransfer = async () => {
      const amount = parseFloat(transferAmount);
      if (isNaN(amount) || amount <= 0 || !activeChat) return;
      setShowTransferModal(false); setShowPlusMenu(false); setTransferAmount('');
      const currentChatId = activeChat.id;
      const timestamp = Date.now();
      const userMsg: Message = { id: timestamp.toString(), role: Role.USER, content: '', timestamp: timestamp, metadata: { transferAmount: amount, transferStatus: 'pending' } };
      const aiMsgId = (timestamp + 1).toString();
      const aiPlaceholderMsg: Message = { id: aiMsgId, role: Role.MODEL, content: '', timestamp: timestamp + 1 };
      const currentHistory = activeChat.messages;
      setChats(prev => prev.map(chat => chat.id === currentChatId ? { ...chat, messages: [...chat.messages, userMsg, aiPlaceholderMsg], lastMessagePreview: '[转账]', lastMessageTime: timestamp } : chat));
      setIsProcessing(true);
      try {
          const updateContent = (text: string) => { setChats(prev => prev.map(chat => { if (chat.id === currentChatId) { return { ...chat, messages: chat.messages.map(m => m.id === aiMsgId ? { ...m, content: text } : m), lastMessagePreview: text }; } return chat; })); };
          const resultText = await generateResponse([...currentHistory, userMsg], activeChat.config || INITIAL_CONFIG, updateContent, profile.stickers);
          const finalMessages = processAIResponse(currentChatId, resultText, timestamp);
          setChats(prev => prev.map(chat => { if (chat.id === currentChatId) { const newMessages = chat.messages.filter(m => m.id !== aiMsgId).concat(finalMessages); const last = finalMessages[finalMessages.length - 1]; let preview = last?.content || ""; if (!preview && last?.attachments) preview = "[表情包]"; if (!preview && last?.metadata?.transferAmount) preview = "[转账]"; return { ...chat, messages: newMessages, lastMessagePreview: preview }; } return chat; }));
      } catch (error: any) { addLog(`Error: ${error.message}`, 'error'); setChats(prev => prev.map(chat => { if (chat.id === currentChatId) { return { ...chat, messages: chat.messages.map(m => m.id === aiMsgId ? { ...m, content: `错误: ${error.message}` } : m) }; } return chat; })); } finally { setIsProcessing(false); }
  };

  const handleTransferClick = (msg: Message) => { if (!activeChat || msg.metadata?.transferStatus !== 'pending') return; setTransferActionMsg(msg); };
  const executeTransferAction = (action: 'accept' | 'refund') => { if (!activeChat || !transferActionMsg) return; const newStatus = action === 'accept' ? 'accepted' : 'refunded'; const sysText = action === 'accept' ? '你已领取了对方的转账' : '你退还了对方的转账'; setChats(prev => prev.map(chat => { if (chat.id === activeChat.id) { const msgs = chat.messages.map(m => { if (m.id === transferActionMsg.id) { return { ...m, metadata: { ...m.metadata, transferStatus: newStatus } as any }; } return m; }); const targetIndex = msgs.findIndex(m => m.id === transferActionMsg.id); if (targetIndex !== -1) { const sysMsg: Message = { id: Date.now().toString() + '_sys', role: Role.SYSTEM, content: sysText, timestamp: Date.now() }; msgs.splice(targetIndex + 1, 0, sysMsg); } return { ...chat, messages: msgs }; } return chat; })); setTransferActionMsg(null); };
  const handlePromptRegenerate = (msgId: string) => { setRegenerateMsgId(msgId); };
  
  const executeRegenerate = async (specificMsgId?: string, editedContent?: string) => {
    const targetMsgId = specificMsgId || regenerateMsgId;
    if (!activeChat || isProcessing || !targetMsgId) return;
    if (!activeChat.config.model) { addLog("重试失败: 未配置 AI 模型。", "error"); setShowSettings(true); setRegenerateMsgId(null); return; }
    const targetIndex = activeChat.messages.findIndex(m => m.id === targetMsgId);
    if (targetIndex === -1) { setRegenerateMsgId(null); return; }
    let currentMessages = [...activeChat.messages];
    if (editedContent !== undefined) { currentMessages[targetIndex] = { ...currentMessages[targetIndex], content: editedContent }; }
    const targetMsg = currentMessages[targetIndex];
    setRegenerateMsgId(null); 
    let newContext: Message[] = [];
    if (targetMsg.role === Role.USER) { newContext = currentMessages.slice(0, targetIndex + 1); } 
    else { let userIndex = -1; for (let i = targetIndex - 1; i >= 0; i--) { if (currentMessages[i].role === Role.USER) { userIndex = i; break; } } if (userIndex !== -1) { newContext = currentMessages.slice(0, userIndex + 1); } else { newContext = currentMessages.slice(0, targetIndex); } }
    if (newContext.length > 0) { const lastIndex = newContext.length - 1; const lastMsg = newContext[lastIndex]; if (lastMsg.metadata?.transferAmount && lastMsg.role === Role.USER) { newContext[lastIndex] = { ...lastMsg, metadata: { ...lastMsg.metadata, transferStatus: 'pending' } }; } }
    const timestamp = Date.now();
    const aiMsgId = timestamp.toString();
    const aiPlaceholderMsg: Message = { id: aiMsgId, role: Role.MODEL, content: '', timestamp: timestamp };
    setChats(prev => prev.map(c => c.id === activeChat.id ? { ...c, messages: [...newContext, aiPlaceholderMsg] } : c));
    setIsProcessing(true);
    try { const updateContent = (text: string) => { setChats(prev => prev.map(chat => { if (chat.id === activeChat.id) { return { ...chat, messages: chat.messages.map(m => m.id === aiMsgId ? { ...m, content: text } : m), lastMessagePreview: text }; } return chat; })); }; const resultText = await generateResponse(newContext, activeChat.config, updateContent, profile.stickers); const finalMessages = processAIResponse(activeChat.id, resultText, timestamp); setChats(prev => prev.map(chat => { if (chat.id === activeChat.id) { const newMessages = chat.messages.filter(m => m.id !== aiMsgId).concat(finalMessages); const last = finalMessages[finalMessages.length - 1]; let preview = last?.content || ""; if (!preview && last?.attachments) preview = "[表情包]"; if (!preview && last?.metadata?.transferAmount) preview = "[转账]"; return { ...chat, messages: newMessages, lastMessagePreview: preview }; } return chat; })); } catch (e: any) { addLog(`重试错误: ${e.message}`, 'error'); setChats(prev => prev.map(chat => { if (chat.id === activeChat.id) { return { ...chat, messages: chat.messages.map(m => m.id === aiMsgId ? { ...m, content: `错误: ${e.message}` } : m) }; } return chat; })); } finally { setIsProcessing(false); }
  };

  const handleEditMessage = async (msgId: string, newContent: string, shouldRegenerate: boolean = false) => { if (!activeChat) return; setChats(prev => prev.map(c => c.id === activeChat.id ? { ...c, messages: c.messages.map(m => m.id === msgId ? { ...m, content: newContent } : m) } : c)); setTimeout(() => { const element = document.getElementById(`msg-${msgId}`); if (element) { element.scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, 100); if (shouldRegenerate) { executeRegenerate(msgId, newContent); } };
  const handleDeleteMessage = (msgId: string) => { if (!activeChat) return; setChats(prev => prev.map(c => c.id === activeChat.id ? { ...c, messages: c.messages.filter(m => m.id !== msgId) } : c)); };
  const handleClearChat = (chatId: string) => { setChats(prev => prev.map(c => c.id === chatId ? { ...c, messages: [], lastMessagePreview: '' } : c)); setShowSettings(false); };
  const handleDeleteChatSession = (chatId: string) => { setChatToDeleteId(chatId); setSidebarMenu(null); };
  const executeDeleteChat = () => { if (chatToDeleteId) { setChats(prev => prev.filter(c => c.id !== chatToDeleteId)); if (activeChatId === chatToDeleteId) setActiveChatId(null); setChatToDeleteId(null); } };
  const handleTogglePin = (chatId: string) => setChats(prev => prev.map(c => c.id === chatId ? { ...c, isPinned: !c.isPinned } : c));
  const createNewChat = () => { const newChat: ChatSession = { id: Date.now().toString(), name: '新对话', avatar: `https://picsum.photos/seed/${Date.now()}/200/200`, messages: [], config: { ...INITIAL_CONFIG } }; setChats([newChat, ...chats]); setActiveChatId(newChat.id); setActiveTab('chat'); };
  const onSidebarContextMenu = (e: React.MouseEvent, chatId: string) => { e.preventDefault(); setSidebarMenu({ x: e.clientX, y: e.clientY, chatId }); };

  const handleCopyChatSession = (chatId: string) => {
    const chat = chats.find(c => c.id === chatId);
    if (!chat) return;
    
    // Create deep copy
    const newChat: ChatSession = {
        ...chat,
        id: Date.now().toString(),
        name: `${chat.name} (副本)`,
        messages: JSON.parse(JSON.stringify(chat.messages)), // Deep copy messages to prevent reference issues
        isPinned: false, // Reset pin status
        lastMessageTime: Date.now() // Update timestamp to bring to top
    };
    
    setChats(prev => [newChat, ...prev]);
    setSidebarMenu(null);
    addLog(`已复制对话: ${chat.name}`, 'success');
  };

  // --- RESTORED HANDLERS ---
  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onloadend = async () => { const base64 = reader.result as string; const compressed = await compressImage(base64, 200, 0.8); setProfile(prev => ({ ...prev, avatar: compressed })); }; reader.readAsDataURL(file); } if (fileInputRef.current) fileInputRef.current.value = ''; };
  const handleBgImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onloadend = async () => { const base64 = reader.result as string; const compressed = await compressImage(base64, 1080, 0.7); setTheme(prev => ({ ...prev, backgroundImage: compressed })); }; reader.readAsDataURL(file); } if (bgImageInputRef.current) bgImageInputRef.current.value = ''; };
  const handleChatImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onloadend = async () => { const base64 = reader.result as string; const optimized = await compressImage(base64, 1024, 0.8); setPendingImage({ type: 'image', mimeType: 'image/jpeg', data: optimized }); setShowPlusMenu(false); }; reader.readAsDataURL(file); } if (chatImageInputRef.current) chatImageInputRef.current.value = ''; };
  const handleAddSticker = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onloadend = async () => { const base64 = reader.result as string; const compressed = await compressImage(base64, 256, 0.8); setStickerUpload({ file, preview: compressed }); setNewStickerDesc(''); }; reader.readAsDataURL(file); } if (stickerInputRef.current) stickerInputRef.current.value = ''; };
  const confirmAddSticker = () => { if (!stickerUpload || !newStickerDesc.trim()) return; const newSticker: Sticker = { id: Date.now().toString(), data: stickerUpload.preview, description: newStickerDesc.trim() }; setProfile(prev => ({ ...prev, stickers: [...prev.stickers, newSticker] })); setStickerUpload(null); addLog('表情添加成功', 'success'); };
  const executeDeleteSticker = () => { if (stickerToDelete) { setProfile(prev => ({ ...prev, stickers: prev.stickers.filter(s => s.id !== stickerToDelete) })); setStickerToDelete(null); } };
  const handleExportData = () => { const data: AppData = { chats, profile, theme }; const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `wechat_ai_backup_${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); addLog('数据导出成功', 'success'); };
  const handleImportData = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = (ev) => { try { const json = JSON.parse(ev.target?.result as string); if (json.chats) setChats(json.chats); if (json.profile) setProfile({ ...DEFAULT_PROFILE, ...json.profile }); if (json.theme) setTheme({ ...DEFAULT_THEME, ...json.theme }); addLog('数据导入成功', 'success'); } catch (err) { addLog('数据导入失败: 文件格式错误', 'error'); } }; reader.readAsText(file); if (importInputRef.current) importInputRef.current.value = ''; };
  const handleClearAllData = () => { setShowClearDataModal(true); };
  const executeClearAllData = () => { setChats(MOCK_CHATS); setProfile(DEFAULT_PROFILE); setTheme(DEFAULT_THEME); localStorage.removeItem(LS_KEY); localStorage.removeItem(LS_GITHUB_TOKEN); localStorage.removeItem(LS_GIST_ID); localStorage.removeItem(LS_AUTO_SYNC); localStorage.removeItem(LS_SYNC_MODE); setGithubToken(''); setGistId(''); setEnableAutoSync(false); setSyncMode('none'); setShowClearDataModal(false); addLog('所有数据已清空重置', 'success'); };
  const handleSlimmingClick = () => { setShowSlimmingModal(true); };
  const executeSlimming = async () => { setShowSlimmingModal(false); setIsSlimming(true); addLog('开始瘦身...', 'info'); try { let freedBytes = 0; let count = 0; const newChats = await Promise.all(chats.map(async (chat) => { const newMessages = await Promise.all(chat.messages.map(async (msg) => { if (msg.attachments) { const newAttachments = await Promise.all(msg.attachments.map(async (att) => { if (att.type === 'image') { const oldLen = att.data.length; const newData = await compressImage(att.data, 800, 0.6); const newLen = newData.length; if (newLen < oldLen) { freedBytes += (oldLen - newLen); count++; return { ...att, data: newData }; } } return att; })); return { ...msg, attachments: newAttachments }; } return msg; })); let newAvatar = chat.avatar; if (chat.avatar && chat.avatar.startsWith('data:image')) { const oldLen = chat.avatar.length; newAvatar = await compressImage(chat.avatar, 150, 0.7); if (newAvatar.length < oldLen) { freedBytes += (oldLen - newAvatar.length); count++; } } return { ...chat, messages: newMessages, avatar: newAvatar }; })); const newStickers = await Promise.all(profile.stickers.map(async (s) => { const oldLen = s.data.length; const newData = await compressImage(s.data, 200, 0.7); if (newData.length < oldLen) { freedBytes += (oldLen - newData.length); count++; return { ...s, data: newData }; } return s; })); let newProfileAvatar = profile.avatar; if (profile.avatar && profile.avatar.startsWith('data:image')) { const oldLen = profile.avatar.length; newProfileAvatar = await compressImage(profile.avatar, 150, 0.7); if (newProfileAvatar.length < oldLen) { freedBytes += (oldLen - newProfileAvatar.length); count++; } } let newBg = theme.backgroundImage; if (newBg && newBg.startsWith('data:image')) { const oldLen = newBg.length; newBg = await compressImage(newBg, 1080, 0.6); if (newBg.length < oldLen) { freedBytes += (oldLen - newBg.length); count++; } } setChats(newChats); setProfile(prev => ({ ...prev, stickers: newStickers, avatar: newProfileAvatar })); setTheme(prev => ({ ...prev, backgroundImage: newBg })); const freedKB = Math.round(freedBytes / 1024); setSlimmingResult({ freedKB, count }); addLog(`瘦身完成，释放了 ${freedKB} KB`, 'success'); } catch (e: any) { addLog(`瘦身失败: ${e.message}`, 'error'); } finally { setIsSlimming(false); } };
  const downloadServerScript = () => { const blob = new Blob([SERVER_SCRIPT_CONTENT], { type: 'text/javascript' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = '1102.js'; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); };

  // --- RENDER ME CONTENT (Restored Logic) ---
  const renderMeContent = () => {
      const view = meNavStack.length > 0 ? meNavStack[meNavStack.length - 1] : 'root';
      const goBack = () => { setMeNavStack(prev => prev.slice(0, -1)); setIsManageStickers(false); };

      if (view === 'data_management') {
          const isGithubReady = !!githubToken && (syncMode === 'github' || githubSyncStatus === 'success');
          return (
              <div className="flex flex-col h-full bg-[#f5f5f5]">
                  <div className="h-[50px] bg-[#ededed] flex items-center px-2 border-b border-[#dcdcdc] flex-shrink-0">
                      <button onClick={goBack} className="p-2 -ml-2 hover:bg-black/5 rounded-full"><ArrowLeft size={20} /></button>
                      <span className="font-medium ml-2">数据管理</span>
                  </div>
                  <div className="p-5 space-y-4 overflow-y-auto">
                      
                      {/* GITHUB CARD */}
                      <div className={`bg-white rounded-xl shadow-sm overflow-hidden border transition-all ${syncMode === 'github' ? 'border-green-500 ring-1 ring-green-500' : 'border-gray-100'}`}>
                           <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                  <div className={`p-2 rounded-lg ${githubSyncStatus === 'success' ? 'bg-green-100 text-green-600' : githubSyncStatus === 'syncing' || githubSyncStatus === 'checking' || githubSyncStatus === 'uploading' || githubSyncStatus === 'downloading' ? 'bg-yellow-100 text-yellow-600' : githubSyncStatus === 'error' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600'}`}>
                                      <Github size={20}/>
                                  </div>
                                  <div>
                                      <div className="font-medium text-gray-900">GitHub 云同步</div>
                                      <div className={`text-xs ${githubSyncStatus === 'error' ? 'text-red-500' : 'text-gray-500'}`}>
                                          {syncMode === 'local' ? '已禁用 (本地模式)' : (githubSyncMsg || '未连接')}
                                      </div>
                                  </div>
                              </div>
                              <button onClick={toggleGithubAutoSync} className="transition-all flex items-center gap-2">
                                  <span className={`text-xs font-medium ${(syncMode === 'github' && enableAutoSync) ? 'text-green-600' : 'text-gray-400'}`}>自动同步</span>
                                  {(syncMode === 'github' && enableAutoSync) ? <ToggleRight size={28} className="text-green-500"/> : <ToggleLeft size={28} className="text-gray-300"/>}
                              </button>
                           </div>
                           <div className="p-4 space-y-3">
                               <div className="flex gap-2">
                                   <div className="relative flex-1">
                                       <input 
                                         type={showToken ? "text" : "password"}
                                         placeholder="在此粘贴 GitHub Token" 
                                         value={githubToken}
                                         onChange={(e) => setGithubToken(e.target.value)}
                                         onBlur={handleGithubTokenBlur}
                                         className={`w-full pl-9 pr-9 py-2 bg-gray-50 border rounded-lg text-xs outline-none focus:border-green-500 focus:bg-white transition-colors ${getTokenFormatHint()?.color?.includes('orange') ? 'border-orange-200' : 'border-gray-200'}`}
                                       />
                                       <div className="absolute left-3 top-2 text-gray-400"><Github size={14}/></div>
                                       <button className="absolute right-3 top-2 text-gray-400 hover:text-gray-600" onClick={() => setShowToken(!showToken)} tabIndex={-1}>{showToken ? <EyeOff size={14}/> : <Eye size={14}/>}</button>
                                   </div>
                                   <button onClick={handleConnectGithub} disabled={!githubToken || githubSyncStatus === 'checking'} className="px-3 py-2 bg-gray-800 text-white rounded-lg text-xs font-bold hover:bg-gray-700 flex items-center gap-1">{githubSyncStatus === 'checking' ? <Loader2 size={12} className="animate-spin" /> : <Link size={12} />}连接</button>
                               </div>
                               {githubToken && ( <div className={`text-[10px] pl-1 ${getTokenFormatHint()?.color}`}>{getTokenFormatHint()?.text}</div> )}
                               <div className="flex gap-2">
                                   <button onClick={() => performGithubSync()} disabled={!isGithubReady} className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${!isGithubReady ? 'bg-gray-100 text-gray-400' : 'bg-green-600 text-white hover:bg-green-700'}`}>{githubSyncStatus === 'uploading' ? <Loader2 size={14} className="animate-spin"/> : <Upload size={14}/>}上传 (本地到云端)</button>
                                   <button onClick={handleGithubPull} disabled={!isGithubReady} className={`flex-1 py-2 border rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 ${!isGithubReady ? 'bg-gray-50 text-gray-400 border-gray-200' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'}`}>{githubSyncStatus === 'downloading' ? <Loader2 size={14} className="animate-spin text-gray-600"/> : <Download size={14}/>}下载 (云端到本地)</button>
                               </div>
                           </div>
                      </div>

                      {/* LOCAL SERVER CARD */}
                      <div className={`bg-white rounded-xl shadow-sm overflow-hidden border transition-all ${syncMode === 'local' ? 'border-green-500 ring-1 ring-green-500' : 'border-gray-100'}`}>
                          <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                  <div className={`p-2 rounded-lg ${syncStatus === 'connected' ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-600'}`}>
                                      {syncStatus === 'connected' ? <HardDrive size={20}/> : <WifiOff size={20}/>}
                                  </div>
                                  <div>
                                      <div className="font-medium text-gray-900">本地服务器</div>
                                      <div className={`text-xs ${syncStatus === 'connected' ? 'text-green-600 font-medium' : 'text-gray-500'}`}>
                                          {syncMode === 'github' ? '已禁用 (GitHub 模式)' : (syncStatus === 'connected' ? '已连接 (HTTPS)' : '未连接')}
                                      </div>
                                  </div>
                              </div>
                              <button onClick={toggleLocalAutoSync} className="transition-all flex items-center gap-2">
                                  <span className={`text-xs font-medium ${(syncMode === 'local' && enableAutoSync) ? 'text-green-600' : 'text-gray-400'}`}>自动同步</span>
                                  {(syncMode === 'local' && enableAutoSync) ? <ToggleRight size={28} className="text-green-500"/> : <ToggleLeft size={28} className="text-gray-300"/>}
                              </button>
                          </div>
                          
                          <div className="p-4 space-y-3">
                            <div className="flex gap-2">
                                <button onClick={testLocalConnection} disabled={isConnecting} className={`flex-1 py-2 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors ${isConnecting ? 'bg-gray-100 text-gray-400' : 'bg-gray-800 text-white hover:bg-gray-900'}`}>{isConnecting ? <Loader2 size={16} className="animate-spin"/> : <RefreshCw size={16}/>}{isConnecting ? '正在连接...' : '测试连接'}</button>
                                {syncStatus !== 'connected' && (<button onClick={openTrustCertUrl} className="px-4 py-2 bg-orange-100 text-orange-700 rounded-lg text-sm font-medium hover:bg-orange-200 flex items-center justify-center gap-1" title="点击此按钮去浏览器中接受自签名证书"><ShieldAlert size={16} /> 信任证书</button>)}
                            </div>
                            <div className="flex gap-2">
                                   <button onClick={() => handleLocalPush()} disabled={syncStatus !== 'connected'} className={`flex-1 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${syncStatus === 'connected' ? 'bg-green-600 text-white hover:bg-green-700' : 'bg-gray-100 text-gray-400'}`}><Upload size={14}/>上传 (本地到服务器)</button>
                                   <button onClick={handleLocalPull} disabled={syncStatus !== 'connected'} className={`flex-1 py-2 border rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 ${syncStatus === 'connected' ? 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50' : 'bg-gray-50 text-gray-400 border-gray-200'}`}><Download size={14}/>下载 (服务器到本地)</button>
                            </div>
                          </div>
                      </div>

                      {/* SLIMMING CARD */}
                      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                           <div className="p-4 border-b border-gray-100 flex items-center gap-3">
                               <div className="bg-purple-100 text-purple-600 p-2 rounded-lg"><Scissors size={20}/></div>
                               <div><div className="font-medium text-gray-900">文件瘦身</div><div className="text-xs text-gray-500">压缩所有图片/表情包以释放内存</div></div>
                           </div>
                           <div className="p-4"><button onClick={handleSlimmingClick} disabled={isSlimming} className="w-full py-2.5 bg-purple-50 text-purple-600 border border-purple-200 rounded-lg text-sm font-medium hover:bg-purple-100 flex items-center justify-center gap-2">{isSlimming ? <Loader2 size={16} className="animate-spin"/> : <Scissors size={16}/>}{isSlimming ? '正在处理...' : '开始瘦身'}</button></div>
                      </div>

                      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                           <div className="p-4 border-b border-gray-100 flex items-center gap-3">
                               <div className="bg-blue-100 text-blue-600 p-2 rounded-lg"><Save size={20}/></div>
                               <div><div className="font-medium text-gray-900">文件导入导出</div><div className="text-xs text-gray-500">手动备份为 JSON 文件</div></div>
                           </div>
                           <div className="p-4 flex gap-3"><button onClick={handleExportData} className="flex-1 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center justify-center gap-2"><Upload size={16} className="text-gray-500"/> 导出</button><button onClick={() => importInputRef.current?.click()} className="flex-1 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 flex items-center justify-center gap-2"><Download size={16}/> 导入</button><input type="file" ref={importInputRef} onChange={handleImportData} className="hidden" accept=".json"/></div>
                      </div>

                      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                           <div className="p-4 border-b border-gray-100 flex items-center gap-3">
                               <div className="bg-red-100 text-red-600 p-2 rounded-lg"><AlertTriangle size={20}/></div>
                               <div><div className="font-medium text-gray-900">危险区域</div><div className="text-xs text-gray-500">不可逆的操作</div></div>
                           </div>
                           <div className="p-4"><button onClick={handleClearAllData} className="w-full py-2.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-sm font-medium hover:bg-red-100 flex items-center justify-center gap-2"><Trash2 size={16}/> 清空所有数据</button></div>
                      </div>
                  </div>
              </div>
          );
      }
      
      if (view === 'tutorial') {
          return (
              <div className="flex flex-col h-full bg-[#f5f5f5]">
                  <div className="h-[50px] bg-[#ededed] flex items-center px-2 border-b border-[#dcdcdc] flex-shrink-0">
                      <button onClick={goBack} className="p-2 -ml-2 hover:bg-black/5 rounded-full"><ArrowLeft size={20} /></button>
                      <span className="font-medium ml-2">数据备份教程</span>
                  </div>
                  <div className="p-5 overflow-y-auto space-y-6">
                      <div className="bg-white p-6 rounded-xl shadow-sm space-y-6">
                          <div>
                              <div className="flex items-center gap-2 mb-2 font-bold text-lg text-gray-800"><Github size={20}/> <span>GitHub Gist 同步指南</span></div>
                              <p className="text-sm text-gray-500 mb-4">通过 GitHub Gist 功能，你可以免费将聊天记录和设置同步到云端，在任何设备上通过 Token 找回。</p>
                              <div className="flex items-center gap-2 bg-yellow-50 text-yellow-800 p-2 rounded text-xs border border-yellow-200"><Wifi size={14} className="flex-shrink-0"/><span>注意：此功能需要连接到 api.github.com，请确保你的网络环境支持访问 GitHub (通常需要开启 VPN)。</span></div>
                          </div>
                          <div className="space-y-4">
                              <div className="border-l-4 border-green-500 pl-4 py-1"><h4 className="font-bold text-gray-800">1. 获取 GitHub Token</h4><p className="text-sm text-gray-600 mt-1">登录 GitHub -> Settings -> Developer settings -> Personal access tokens (Classic)。</p><p className="text-sm text-gray-600 mt-1">或者复制以下链接在浏览器打开：</p><div className="bg-gray-800 text-green-400 p-2 rounded text-[10px] font-mono break-all select-all mt-1">https://github.com/settings/tokens/new?scopes=gist&description=WeChatAIBackup</div></div>
                              <div className="border-l-4 border-green-500 pl-4 py-1"><h4 className="font-bold text-gray-800">2. 配置权限</h4><p className="text-sm text-gray-600 mt-1">在生成页面：</p><ul className="list-disc list-inside text-xs text-gray-600 mt-1 space-y-1"><li>Note: 随便填 (例如 WeChatAI)</li><li>Expiration: 建议选 No expiration (永不过期)</li><li><b>Select scopes: 必须勾选 `gist`</b> (关键一步)</li></ul></div>
                              <div className="border-l-4 border-green-500 pl-4 py-1"><h4 className="font-bold text-gray-800">3. 填入 Token</h4><p className="text-sm text-gray-600 mt-1">点击页面底部的 Generate token，复制生成的 `ghp_` 开头的字符串。</p><p className="text-sm text-gray-600 mt-1">回到本应用的 <b>数据管理</b> 页面，填入 Token 并点击“连接”。</p></div>
                          </div>
                      </div>
                      <div className="bg-white p-6 rounded-xl shadow-sm space-y-6">
                          <div>
                              <div className="flex items-center gap-2 mb-2 font-bold text-lg text-gray-800"><HardDrive size={20}/> <span>本地服务器部署指南 (高级)</span></div>
                              <p className="text-sm text-gray-500 mb-4">如果你想将数据保存在本地设备的文件系统中，可以使用 Node.js 运行一个微型服务器。</p>
                          </div>
                          <div className="space-y-4">
                              <div className="border-l-4 border-orange-500 pl-4 py-1"><h4 className="font-bold text-gray-800">1. 准备环境</h4><p className="text-sm text-gray-600 mt-1">Android 用户安装 <b>Termux</b>，电脑用户安装 <b>Node.js</b>。</p><p className="text-xs font-mono bg-gray-100 p-1 mt-1 rounded">pkg install nodejs-lts openssl-tool</p></div>
                              <div className="border-l-4 border-orange-500 pl-4 py-1"><h4 className="font-bold text-gray-800">2. 下载脚本</h4><button onClick={downloadServerScript} className="mt-2 px-3 py-1.5 bg-gray-800 text-white rounded text-xs font-medium flex items-center gap-2"><Download size={12}/> 下载 server.js</button><p className="text-sm text-gray-600 mt-1">将下载的脚本放到 Termux 或电脑的一个文件夹中。</p></div>
                              <div className="border-l-4 border-orange-500 pl-4 py-1"><h4 className="font-bold text-gray-800">3. 运行服务器</h4><p className="text-sm text-gray-600 mt-1">在终端中运行：</p><p className="text-xs font-mono bg-gray-100 p-1 mt-1 rounded">node 1102.js</p></div>
                              <div className="border-l-4 border-orange-500 pl-4 py-1"><h4 className="font-bold text-gray-800">4. 信任证书</h4><p className="text-sm text-gray-600 mt-1">首次运行时会自动生成证书。你需要点击“数据管理”页面的“信任证书”按钮，并在浏览器中选择“高级 -> 继续前往”来允许 HTTPS 连接。</p></div>
                          </div>
                      </div>
                  </div>
              </div>
          );
      }
      if (view === 'stickers') {
          return (
              <div className="flex flex-col h-full bg-[#f5f5f5]">
                  <div className="h-[50px] bg-[#ededed] flex items-center justify-between px-2 border-b border-[#dcdcdc]">
                      <div className="flex items-center"><button onClick={goBack} className="p-2 -ml-2 hover:bg-black/5 rounded-full"><ArrowLeft size={20} /></button><span className="font-medium ml-2">表情管理</span></div>
                      <div className="flex gap-2"><button onClick={() => setIsManageStickers(!isManageStickers)} className={`font-medium text-sm px-2 py-1 rounded ${isManageStickers ? 'bg-gray-200 text-gray-800' : 'text-gray-600 hover:bg-gray-200'}`}>{isManageStickers ? '完成' : '管理'}</button><button onClick={() => stickerInputRef.current?.click()} className="text-green-600 font-medium text-sm px-2">添加</button></div>
                  </div>
                  <div className="p-4 grid grid-cols-4 gap-4 overflow-y-auto content-start">
                      {profile.stickers.map(s => (
                          <div key={s.id} className="relative group bg-white p-2 rounded-lg shadow-sm border border-gray-100 aspect-square flex items-center justify-center animate-fade-in"><img src={s.data} className="w-full h-full object-contain" />{isManageStickers && ( <button onClick={() => setStickerToDelete(s.id)} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 transition z-10 animate-pulse-once"><X size={14}/></button> )}<div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[9px] text-center truncate px-1 rounded-b-lg opacity-0 group-hover:opacity-100 pointer-events-none">{s.description}</div></div>
                      ))}
                      <div onClick={() => stickerInputRef.current?.click()} className="flex items-center justify-center bg-gray-200 rounded-lg aspect-square cursor-pointer hover:bg-gray-300 transition-colors"><Plus size={24} className="text-gray-500"/></div>
                  </div>
                  <input type="file" ref={stickerInputRef} className="hidden" accept="image/*" onChange={handleAddSticker} />
              </div>
          );
      }
      if (view === 'settings') {
        return (
            <div className="flex flex-col h-full bg-[#f5f5f5]">
                <div className="h-[50px] bg-[#ededed] flex items-center px-2 border-b border-[#dcdcdc]"><button onClick={goBack} className="p-2 -ml-2 hover:bg-black/5 rounded-full"><ArrowLeft size={20} /></button><span className="font-medium ml-2">设置</span></div>
                <div className="mt-2 space-y-px bg-[#f5f5f5]">
                    <div onClick={() => setMeNavStack(prev => [...prev, 'data_management'])} className="bg-white p-4 flex items-center justify-between active:bg-gray-50 cursor-pointer"><div className="flex items-center gap-3"><div className="bg-orange-500 p-1.5 rounded text-white"><Database size={18} /></div><span className="text-[15px]">数据管理</span></div><ChevronRight size={16} className="text-gray-400" /></div>
                    <div onClick={() => setMeNavStack(prev => [...prev, 'tutorial'])} className="bg-white p-4 flex items-center justify-between active:bg-gray-50 cursor-pointer"><div className="flex items-center gap-3"><div className="bg-gray-700 p-1.5 rounded text-white"><Terminal size={18} /></div><span className="text-[15px]">配置教程 (GitHub/本地)</span></div><ChevronRight size={16} className="text-gray-400" /></div>
                    <div onClick={() => setMeNavStack(prev => [...prev, 'logs'])} className="bg-white p-4 flex items-center justify-between active:bg-gray-50 cursor-pointer"><div className="flex items-center gap-3"><div className="bg-blue-500 p-1.5 rounded text-white"><FileText size={18} /></div><span className="text-[15px]">系统日志</span></div><ChevronRight size={16} className="text-gray-400" /></div>
                    <div onClick={() => setMeNavStack(prev => [...prev, 'theme'])} className="bg-white p-4 flex items-center justify-between active:bg-gray-50 cursor-pointer"><div className="flex items-center gap-3"><div className="bg-purple-500 p-1.5 rounded text-white"><Palette size={18} /></div><span className="text-[15px]">界面个性化</span></div><ChevronRight size={16} className="text-gray-400" /></div>
                </div>
            </div>
        );
      }
      if (view === 'logs') {
         return (
             <div className="flex flex-col h-full bg-[#f5f5f5]">
                 <div className="h-[50px] bg-[#ededed] flex items-center px-2 border-b border-[#dcdcdc]"><button onClick={goBack} className="p-2 -ml-2 hover:bg-black/5 rounded-full"><ArrowLeft size={20} /></button><span className="font-medium ml-2">运行日志</span></div>
                 <div className="flex-1 overflow-auto p-2 font-mono text-xs space-y-1 bg-[#1e1e1e] text-green-400">
                     {logs.length === 0 && <div className="text-gray-500 text-center pt-4">暂无日志记录</div>}
                     {logs.map(log => (<div key={log.id} className="flex gap-2 border-b border-gray-800 pb-1 mb-1 last:border-0"><span className="text-gray-500">[{log.timestamp}]</span><span className={log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-green-300' : 'text-gray-300'}>{log.message}</span></div>))}
                 </div>
             </div>
         );
      }
      if (view === 'theme') {
        const bubblePresets = ['#95ec69', '#3b82f6', '#8b5cf6', '#ec4899', '#f97316'];
        const actionPresets = ['#888888', '#6b7280', '#9ca3af', '#475569', '#374151', '#f87171', '#60a5fa'];
        const bgPresets = ['#f5f5f5', '#ffffff', '#e5e7eb', '#fdf2f8', '#ecfdf5'];

        return (
             <div className="flex flex-col h-full bg-[#f5f5f5]">
                 <div className="h-[50px] bg-[#ededed] flex items-center px-2 border-b border-[#dcdcdc]"><button onClick={goBack} className="p-2 -ml-2 hover:bg-black/5 rounded-full"><ArrowLeft size={20} /></button><span className="font-medium ml-2">界面个性化</span></div>
                 <div className="p-4 space-y-6">
                     
                     {/* User Bubble Color */}
                     <div className="space-y-2">
                        <label className="text-xs text-gray-500 uppercase font-bold">用户气泡颜色</label>
                        <div className="flex gap-3 overflow-x-auto pb-2 items-center no-scrollbar">
                            {bubblePresets.map(c => (
                                <button key={c} onClick={() => setTheme(prev => ({...prev, userBubbleColor: c}))} className={`w-10 h-10 rounded-full border-2 ${theme.userBubbleColor === c ? 'border-gray-900' : 'border-transparent'} flex-shrink-0 transition-all`} style={{backgroundColor: c}} />
                            ))}
                            {/* Color Picker */}
                             <div className={`relative w-10 h-10 rounded-full border-2 flex items-center justify-center overflow-hidden flex-shrink-0 transition-all ${!bubblePresets.includes(theme.userBubbleColor) ? 'border-gray-900 ring-1 ring-gray-900' : 'border-gray-300'}`} title="自定义颜色">
                                <div className="absolute inset-0 bg-gradient-to-tr from-pink-500 via-red-500 to-yellow-500 opacity-90" />
                                <input 
                                    type="color" 
                                    value={theme.userBubbleColor} 
                                    onChange={(e) => setTheme(prev => ({...prev, userBubbleColor: e.target.value}))}
                                    className="absolute inset-0 w-[150%] h-[150%] -top-1/4 -left-1/4 opacity-0 cursor-pointer p-0 border-0"
                                />
                                <Plus size={18} className="text-white relative z-10 pointer-events-none drop-shadow-md" />
                             </div>
                        </div>
                     </div>

                     {/* Action Text Color */}
                     <div className="space-y-2">
                        <label className="text-xs text-gray-500 uppercase font-bold">旁白文字颜色</label>
                        <div className="flex gap-3 overflow-x-auto pb-2 items-center no-scrollbar">
                            {actionPresets.map(c => (
                                <button key={c} onClick={() => setTheme(prev => ({...prev, actionTextColor: c}))} className={`w-10 h-10 rounded-full border-2 ${theme.actionTextColor === c ? 'border-gray-900' : 'border-transparent'} flex-shrink-0 transition-all`} style={{backgroundColor: c}} />
                            ))}
                             {/* Color Picker */}
                             <div className={`relative w-10 h-10 rounded-full border-2 flex items-center justify-center overflow-hidden flex-shrink-0 transition-all ${!actionPresets.includes(theme.actionTextColor || '') ? 'border-gray-900 ring-1 ring-gray-900' : 'border-gray-300'}`} title="自定义颜色">
                                <div className="absolute inset-0 bg-gradient-to-tr from-blue-400 via-indigo-500 to-purple-500 opacity-90" />
                                <input 
                                    type="color" 
                                    value={theme.actionTextColor || '#888888'} 
                                    onChange={(e) => setTheme(prev => ({...prev, actionTextColor: e.target.value}))}
                                    className="absolute inset-0 w-[150%] h-[150%] -top-1/4 -left-1/4 opacity-0 cursor-pointer p-0 border-0"
                                />
                                <Plus size={18} className="text-white relative z-10 pointer-events-none drop-shadow-md" />
                             </div>
                        </div>
                     </div>

                     {/* Background Color */}
                     <div className="space-y-2">
                        <label className="text-xs text-gray-500 uppercase font-bold">聊天背景色 (备用)</label>
                        <div className="flex gap-3 overflow-x-auto pb-2 items-center no-scrollbar">
                            {bgPresets.map(c => (
                                <button key={c} onClick={() => setTheme(prev => ({...prev, backgroundColor: c}))} className={`w-10 h-10 rounded-full border-2 ${theme.backgroundColor === c ? 'border-gray-900' : 'border-transparent'} flex-shrink-0 transition-all`} style={{backgroundColor: c}} />
                            ))}
                            {/* Color Picker */}
                             <div className={`relative w-10 h-10 rounded-full border-2 flex items-center justify-center overflow-hidden flex-shrink-0 transition-all ${!bgPresets.includes(theme.backgroundColor) ? 'border-gray-900 ring-1 ring-gray-900' : 'border-gray-300'}`} title="自定义颜色">
                                <div className="absolute inset-0 bg-gradient-to-tr from-gray-200 via-gray-400 to-gray-600 opacity-90" />
                                <input 
                                    type="color" 
                                    value={theme.backgroundColor} 
                                    onChange={(e) => setTheme(prev => ({...prev, backgroundColor: e.target.value}))}
                                    className="absolute inset-0 w-[150%] h-[150%] -top-1/4 -left-1/4 opacity-0 cursor-pointer p-0 border-0"
                                />
                                <Plus size={18} className="text-white relative z-10 pointer-events-none drop-shadow-md" />
                             </div>
                        </div>
                     </div>

                     {/* Background Image (Existing) */}
                     <div className="space-y-2 pt-2 border-t border-gray-200"><label className="text-xs text-gray-500 uppercase font-bold">聊天背景图</label><div className="flex items-center gap-4"><div className="relative w-24 h-40 bg-gray-200 rounded-lg overflow-hidden border border-gray-300 flex items-center justify-center">{theme.backgroundImage ? ( <img src={theme.backgroundImage} className="w-full h-full object-cover" /> ) : ( <div className="text-gray-400 text-xs">无背景图</div> )}</div><div className="flex flex-col gap-2"><button onClick={() => bgImageInputRef.current?.click()} className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-xs font-medium hover:bg-gray-50 flex items-center gap-2"> <Camera size={14} /> 选择图片 </button>{theme.backgroundImage && ( <button onClick={() => setTheme(prev => ({ ...prev, backgroundImage: undefined }))} className="px-3 py-2 bg-red-50 border border-red-200 text-red-600 rounded-lg text-xs font-medium hover:bg-red-100 flex items-center gap-2"> <Trash2 size={14} /> 移除背景 </button> )}</div><input type="file" ref={bgImageInputRef} className="hidden" accept="image/*" onChange={handleBgImageSelect} /></div></div>
                 </div>
             </div>
        );
      }

      return (
        <div className="flex flex-col h-full bg-[#f5f5f5]">
             <div className="bg-white pt-10 pb-6 px-6 flex items-center gap-5 mb-2 cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                 <div className="relative group flex-shrink-0"><img src={profile.avatar} alt="Me" className="w-16 h-16 rounded-lg object-cover bg-gray-200 border border-gray-100 shadow-sm" /><div className="absolute inset-0 bg-black/20 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 rounded-lg transition-opacity"><Camera size={20} /></div></div>
                 <div className="flex-1 min-w-0"><div className="flex items-center gap-2 mb-1.5" onClick={(e) => e.stopPropagation()}><input value={profile.name} onChange={(e) => setProfile({...profile, name: e.target.value})} className="font-bold text-xl text-gray-900 bg-transparent border-none outline-none hover:bg-gray-50 focus:bg-white focus:ring-1 focus:ring-green-500 rounded px-1 -ml-1 w-full truncate" /></div><div className="flex items-center justify-between text-gray-500 text-sm"><span className="truncate">微信号: {profile.wechatId}</span><div className="flex gap-4 items-center"><QrCode size={16} /><ChevronRight size={16} className="text-gray-400" /></div></div></div>
                 <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleAvatarFileChange} />
             </div>
             
             <div className="space-y-px bg-[#f5f5f5]">
                 <div className="bg-white p-4 flex items-center justify-between active:bg-gray-50 cursor-pointer"><div className="flex items-center gap-3"><div className="bg-[#07c160] p-1.5 rounded text-white"><Check size={18} /></div><span className="text-[15px]">服务</span></div><ChevronRight size={16} className="text-gray-400" /></div>
                 <div onClick={() => setMeNavStack(prev => [...prev, 'stickers'])} className="mt-2 bg-white p-4 flex items-center justify-between active:bg-gray-50 cursor-pointer"><div className="flex items-center gap-3"><div className="bg-yellow-500 p-1.5 rounded text-white"><Smile size={18} /></div><span className="text-[15px]">表情</span></div><ChevronRight size={16} className="text-gray-400" /></div>
                 <div onClick={() => setMeNavStack(prev => [...prev, 'settings'])} className="mt-2 bg-white p-4 flex items-center justify-between active:bg-gray-50 cursor-pointer"><div className="flex items-center gap-3"><div className="bg-blue-500 p-1.5 rounded text-white"><Settings size={18} /></div><span className="text-[15px]">设置</span></div><ChevronRight size={16} className="text-gray-400" /></div>
             </div>
        </div>
      );
  };
  
  return (
    <div className="flex h-full bg-white text-gray-900 font-sans overflow-hidden">
      
      {/* SIDEBAR */}
      <div className={`flex-col h-full border-r border-gray-200 bg-[#ededed] w-full md:w-[320px] relative ${activeChatId ? 'hidden md:flex' : 'flex'}`}>
        {/* Sidebar Header */}
        <div className="bg-[#f5f5f5] p-3 flex justify-between items-center h-[50px] flex-shrink-0">
          <div className="font-medium flex items-center gap-2">
              <span className="font-medium">{activeTab === 'chat' ? '微信' : ''}</span>
              {activeTab === 'chat' && (
                  <div className="flex items-center gap-1">
                      {githubToken && ( 
                          <div className="px-1.5 py-0.5 rounded bg-gray-200/50 cursor-help" title={`GitHub: ${githubSyncMsg || githubSyncStatus}`}>
                              {githubSyncStatus === 'success' ? <Cloud className="text-green-600" size={16} /> 
                               : githubSyncStatus === 'uploading' ? <RefreshCw className="text-green-600 animate-spin" size={16} /> 
                               : githubSyncStatus === 'downloading' ? <RefreshCw className="text-gray-900 animate-spin" size={16} />
                               : githubSyncStatus === 'checking' ? <Loader2 className="text-yellow-500 animate-spin" size={16} />
                               : githubSyncStatus === 'error' ? <CloudOff className="text-red-500" size={16} /> 
                               : <CloudCog className="text-gray-400" size={16} />}
                          </div> 
                      )}
                      <div className="px-1.5 py-0.5 rounded bg-gray-200/50 cursor-help" title={`存储: ${statusMsg || syncStatus}`}>{syncStatus === 'connected' ? <HardDrive className="text-green-600" size={16} /> : syncStatus === 'saving' ? <Loader2 className="text-blue-500 animate-spin" size={16} /> : syncStatus === 'browser-storage' ? <Database className="text-orange-500" size={16} /> : <WifiOff className="text-red-400" size={16} />}</div>
                  </div>
              )}
          </div>
          {activeTab === 'chat' && (<button onClick={createNewChat} className="bg-[#ededed] p-1.5 rounded hover:bg-[#d6d6d6] transition"><Plus size={18} /></button>)}
        </div>
        {activeTab === 'chat' && (<div className="px-3 pb-2 bg-[#f5f5f5] flex-shrink-0"><div className="bg-white rounded px-2 py-1.5 flex items-center gap-2 border border-gray-200"><Search size={14} className="text-gray-400" /><input placeholder="搜索" className="text-sm w-full outline-none placeholder-gray-400" /></div></div>)}
        
        {/* Sidebar List */}
        <div className="flex-1 overflow-y-auto bg-white md:bg-[#ededed]">
            {activeTab === 'chat' ? (
                <div>{sortedChats.map(chat => (
                    <div key={chat.id} onClick={() => setActiveChatId(chat.id)} onContextMenu={(e) => onSidebarContextMenu(e, chat.id)} className={`flex items-center p-3 cursor-pointer hover:bg-[#dcdcdc] transition-colors ${activeChatId === chat.id ? 'bg-[#c6c6c6] md:bg-[#c6c6c6]' : chat.isPinned ? 'bg-[#f7f7f7] md:bg-[#f3f3f3]' : 'bg-white md:bg-[#ededed]'}`}>
                      <div className="relative"><img src={chat.avatar} alt="Avatar" className="w-12 h-12 rounded mr-3 object-cover bg-gray-300" /></div>
                      <div className="flex-1 min-w-0 border-b border-gray-100 md:border-gray-300/50 pb-3 pt-1"><div className="flex justify-between items-baseline mb-0.5"><h3 className="font-medium text-[16px] text-gray-900 truncate">{chat.name}</h3><span className="text-[11px] text-gray-400">{formatTime(chat.lastMessageTime)}</span></div><p className="text-[13px] text-gray-500 truncate">{chat.lastMessagePreview || "暂无消息"}</p></div>
                    </div>))}</div>
            ) : (renderMeContent())}
        </div>
        
        {/* Sidebar Footer (Tabs) */}
        <div className="h-[56px] border-t border-gray-300 bg-[#f7f7f7] grid grid-cols-2 flex-shrink-0">
             <button onClick={() => { setActiveTab('chat'); setMeNavStack([]); }} className={`flex flex-col items-center justify-center gap-1 ${activeTab === 'chat' ? 'text-[#07c160]' : 'text-gray-500'}`}><MessageSquare size={22} fill={activeTab === 'chat' ? 'currentColor' : 'none'} /><span className="text-[10px]">微信</span></button>
             <button onClick={() => setActiveTab('me')} className={`flex flex-col items-center justify-center gap-1 ${activeTab === 'me' ? 'text-[#07c160]' : 'text-gray-500'}`}><User size={22} fill={activeTab === 'me' ? 'currentColor' : 'none'} /><span className="text-[10px]">我</span></button>
        </div>
        
        {/* Context Menu */}
        {sidebarMenu && (
            <div className="fixed z-50 bg-[#2b2b2b] text-white text-sm rounded shadow-xl py-1 w-32 animate-fade-in" style={{ top: sidebarMenu.y, left: sidebarMenu.x }} onClick={(e) => e.stopPropagation()}>
                <button onClick={() => { handleTogglePin(sidebarMenu.chatId); setSidebarMenu(null); }} className="w-full text-left px-4 py-2 hover:bg-white/10 flex items-center gap-2">
                    {chats.find(c => c.id === sidebarMenu.chatId)?.isPinned ? <PinOff size={14}/> : <Pin size={14}/>}
                    {chats.find(c => c.id === sidebarMenu.chatId)?.isPinned ? '取消置顶' : '置顶'}
                </button>
                <button onClick={() => handleCopyChatSession(sidebarMenu.chatId)} className="w-full text-left px-4 py-2 hover:bg-white/10 flex items-center gap-2">
                    <Copy size={14} /> 复制对话
                </button>
                <div className="h-[1px] bg-white/10 my-1"></div>
                <button onClick={() => { handleDeleteChatSession(sidebarMenu.chatId); }} className="w-full text-left px-4 py-2 hover:bg-white/10 text-red-400 hover:text-red-300 flex items-center gap-2">
                    <Trash2 size={14} /> 删除对话
                </button>
            </div>
        )}
      </div>

      {/* CHAT ROOM */}
      <div className={`flex-1 flex-col h-full relative bg-[#f5f5f5] ${activeChatId ? 'flex' : 'hidden md:flex'}`} style={{ backgroundColor: theme.backgroundColor, backgroundImage: theme.backgroundImage ? `url(${theme.backgroundImage})` : 'none', backgroundSize: 'cover', backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}>
        {activeChat ? (
          <>
            <div className="h-[50px] border-b border-gray-200/80 bg-[#f5f5f5]/90 backdrop-blur flex items-center justify-between px-4 z-10 sticky top-0"><div className="flex items-center gap-3"><button className="md:hidden text-gray-800" onClick={() => setActiveChatId(null)}><ArrowLeft size={22} /></button><h2 className="font-medium text-[16px]">{isProcessing ? '对方正在输入...' : activeChat.name}</h2></div><button onClick={() => setShowSettings(true)} className="text-gray-800 hover:bg-gray-200 p-1 rounded-full transition"><MoreHorizontal size={20} /></button></div>
            <div className="flex-1 overflow-y-auto p-4 scroll-smooth" onClick={() => setShowPlusMenu(false)}>
               {activeChat.messages.length === 0 && (<div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-60"><MessageSquare size={48} className="mb-2" /><p>打个招呼吧</p></div>)}
              {activeChat.messages.map((msg, idx) => ( <MessageBubble key={msg.id} message={msg} chatAvatar={activeChat.avatar} userAvatar={profile.avatar} isLast={idx === activeChat.messages.length - 1} isLastUser={idx === lastUserIndex} userBubbleColor={theme.userBubbleColor} botBubbleColor={theme.botBubbleColor} actionTextColor={theme.actionTextColor} dialogueMode={activeChat.config.dialogueMode} onEdit={(newContent, shouldRegenerate) => handleEditMessage(msg.id, newContent, shouldRegenerate)} onDelete={() => handleDeleteMessage(msg.id)} onRegenerate={() => handlePromptRegenerate(msg.id)} onTransferClick={handleTransferClick} /> ))}
              <div ref={messagesEndRef} />
            </div>
            <div className="bg-[#f7f7f7] border-t border-gray-200 p-3 pb-safe relative z-20">
              {pendingImage && (<div className="absolute bottom-full left-0 right-0 bg-white/90 backdrop-blur border-t border-gray-200 p-3 flex items-start gap-3 animate-fade-in shadow-sm"><div className="relative group"><img src={pendingImage.data} alt="Preview" className="h-20 w-20 object-cover rounded-lg border border-gray-200" /><button onClick={() => setPendingImage(null)} className="absolute -top-2 -right-2 bg-gray-500 text-white rounded-full p-0.5 hover:bg-red-500 transition-colors"><X size={14} /></button></div><div className="text-xs text-gray-500 mt-1">已选择 1 张图片<br/>可以在下方输入文字一同发送</div></div>)}
              {showStickerPicker && ( <div className="absolute bottom-full left-0 right-0 bg-white border-t border-gray-200 p-3 animate-fade-in shadow-lg max-h-[300px] overflow-y-auto"><div className="flex justify-between items-center mb-2"><span className="text-xs text-gray-500 font-bold uppercase">选择表情</span><button onClick={() => setShowStickerPicker(false)}><X size={16}/></button></div>{profile.stickers.length === 0 ? ( <div className="text-center py-4 text-gray-400 text-sm">暂无表情，请去"我" -> "表情"添加</div> ) : ( <div className="grid grid-cols-5 gap-2">{profile.stickers.map(s => ( <div key={s.id} onClick={() => { handleSendSticker(s); setShowStickerPicker(false); }} className="cursor-pointer hover:bg-gray-100 p-1 rounded"><img src={s.data} className="w-full h-12 object-contain" /></div> ))}</div> )}</div> )}
              <div className="flex items-end gap-2"><div className="flex-1 flex items-end bg-white rounded-xl border border-gray-200 p-2 shadow-sm focus-within:ring-2 focus-within:ring-green-100 transition-shadow"><textarea ref={inputRef} value={inputMessage} onChange={(e) => { setInputMessage(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }} placeholder={activeChat.config.model ? "" : "未连接模型..."} disabled={!activeChat.config.model} className="flex-1 max-h-[120px] bg-transparent border-none outline-none resize-none p-1 text-[16px] leading-6 min-h-[24px]" rows={1} /></div>{inputMessage.trim() || pendingImage ? (<button onClick={handleSendMessage} className="mb-0.5 py-2 px-3 rounded-lg bg-[#07c160] text-white font-medium text-sm transition-colors hover:bg-[#06ad56] flex-shrink-0">发送</button>) : (<button onClick={() => setShowPlusMenu(!showPlusMenu)} className={`mb-1 p-1.5 rounded-full border transition-all flex-shrink-0 ${showPlusMenu ? 'rotate-45 border-gray-400 bg-gray-200 text-gray-600' : 'border-gray-400 text-gray-600 hover:bg-gray-100'}`}><Plus size={24} /></button>)}</div>
              {showPlusMenu && ( <div className="mt-4 pt-2 border-t border-gray-200 grid grid-cols-4 gap-4 animate-fade-in h-[180px]"><div className="flex flex-col items-center gap-2 cursor-pointer" onClick={() => chatImageInputRef.current?.click()}><div className="w-14 h-14 bg-white rounded-xl border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50"><ImageIcon size={28} /></div><span className="text-xs text-gray-500">相册</span></div><div className="flex flex-col items-center gap-2 cursor-pointer" onClick={() => setShowStickerPicker(true)}><div className="w-14 h-14 bg-white rounded-xl border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50"><Smile size={28} /></div><span className="text-xs text-gray-500">表情</span></div><div className="flex flex-col items-center gap-2 cursor-pointer" onClick={() => { setShowTransferModal(true); }}><div className="w-14 h-14 bg-white rounded-xl border border-gray-200 flex items-center justify-center text-gray-600 hover:bg-gray-50"><CreditCard size={28} /></div><span className="text-xs text-gray-500">转账</span></div><div className="flex flex-col items-center gap-2 opacity-50"><div className="w-14 h-14 bg-white rounded-xl border border-gray-200 flex items-center justify-center text-gray-600"><Camera size={28} /></div><span className="text-xs text-gray-500">拍摄</span></div></div> )}
              <input type="file" ref={chatImageInputRef} className="hidden" accept="image/*" onChange={handleChatImageSelect} />
            </div>
            {showSettings && (<ChatSettings chat={activeChat} stickers={profile.stickers} onSave={(id, cfg, name, av) => { setChats(prev => prev.map(c => c.id === id ? { ...c, config: cfg, name, avatar: av } : c)); setShowSettings(false); }} onClearChat={() => handleClearChat(activeChat.id)} onClose={() => setShowSettings(false)} onLog={addLog} />)}
          </>
        ) : (<div className="flex-1 flex items-center justify-center bg-[#f5f5f5] text-gray-300 select-none"><div className="text-center"><div className="opacity-20 mb-4"><MessageSquare size={64} className="mx-auto" /></div><p className="text-sm">WeChat AI</p></div></div>)}
      </div>

      {regenerateMsgId && ( <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-fade-in"><div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm text-center"><h3 className="font-bold text-lg mb-2 text-gray-900">确认重新生成</h3><p className="text-gray-500 mb-6 text-sm">这将删除该消息之后的所有对话记录，并让 AI 重新回复此消息。<br/><span className="text-xs text-orange-500 mt-1 block">提示：如果这是转账消息，状态将恢复为“未领取”。</span></p><div className="flex justify-center gap-3"><button onClick={() => setRegenerateMsgId(null)} className="px-5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition">取消</button><button onClick={() => executeRegenerate()} className="px-5 py-2 text-sm font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 shadow-sm shadow-green-200 transition">确认生成</button></div></div></div> )}
      {stickerUpload && ( <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-fade-in"><div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm"><h3 className="font-bold text-lg mb-4 text-center">添加表情</h3><div className="flex justify-center mb-6 bg-gray-50 p-4 rounded-lg border border-gray-100"><img src={stickerUpload.preview} className="h-32 object-contain" alt="Preview" /></div><div className="space-y-2 mb-6"><label className="text-xs font-bold text-gray-500 uppercase">表情含义 (必填)</label><input autoFocus value={newStickerDesc} onChange={e => setNewStickerDesc(e.target.value)} className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-green-500 outline-none" placeholder="例如：开心、点赞、震惊 (这有助于AI理解)" /></div><div className="flex justify-end gap-3"><button onClick={() => setStickerUpload(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition">取消</button><button onClick={confirmAddSticker} className="px-5 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 shadow-sm shadow-green-200 transition">完成</button></div></div></div> )}
      {stickerToDelete && ( <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-fade-in"><div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm text-center"><h3 className="font-bold text-lg mb-2 text-gray-900">删除表情</h3><p className="text-gray-500 mb-6 text-sm">确定要删除这个表情包吗？</p><div className="flex justify-center gap-3"><button onClick={() => setStickerToDelete(null)} className="px-5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition">取消</button><button onClick={executeDeleteSticker} className="px-5 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 shadow-sm shadow-red-200 transition">删除</button></div></div></div> )}
      {showTransferModal && ( <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-fade-in"><div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm"><h3 className="font-bold text-lg mb-4 text-center">转账</h3><div className="space-y-2 mb-6"><label className="text-xs font-bold text-gray-500 uppercase">金额</label><div className="relative"><span className="absolute left-3 top-3 text-xl font-bold">¥</span><input autoFocus type="number" value={transferAmount} onChange={e => setTransferAmount(e.target.value)} className="w-full border border-gray-300 rounded-lg p-3 pl-8 text-xl font-bold focus:ring-2 focus:ring-green-500 outline-none" placeholder="0.00" /></div></div><div className="flex justify-end gap-3"><button onClick={() => setShowTransferModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition">取消</button><button onClick={handleSendTransfer} className="px-5 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 shadow-sm shadow-green-200 transition">转账</button></div></div></div> )}
      {transferActionMsg && ( <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-fade-in"><div className="bg-white rounded-xl shadow-2xl w-full max-w-xs overflow-hidden"><div className="bg-[#f79b1f] p-6 text-center text-white"><div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mx-auto mb-3"><CreditCard size={32} /></div><div className="text-sm opacity-90 mb-1">转账金额</div><div className="text-3xl font-bold">¥{transferActionMsg.metadata?.transferAmount?.toFixed(2)}</div></div><div className="p-4 space-y-3"><button onClick={() => executeTransferAction('accept')} className="w-full py-3 bg-[#07c160] text-white rounded-lg font-bold shadow-md hover:bg-[#06ad56] transition">确认收款</button><button onClick={() => executeTransferAction('refund')} className="w-full py-3 bg-gray-100 text-gray-600 rounded-lg font-bold hover:bg-gray-200 transition">退还给对方</button><button onClick={() => setTransferActionMsg(null)} className="w-full py-2 text-gray-400 text-sm hover:text-gray-600">取消</button></div></div></div> )}
      {showClearDataModal && ( <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in"><div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm text-center"><div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4"><AlertTriangle size={32} /></div><h3 className="font-bold text-xl mb-2 text-gray-900">危险操作</h3><p className="text-gray-500 mb-6 text-sm">这将永久删除所有聊天记录、表情包、设置和图片数据。<br/><span className="font-bold text-red-500 mt-2 block">此操作无法撤销！</span></p><div className="space-y-3"><button onClick={executeClearAllData} className="w-full py-3 bg-red-600 text-white rounded-lg font-bold shadow-md hover:bg-red-700 transition">确认清空所有数据</button><button onClick={() => setShowClearDataModal(false)} className="w-full py-3 bg-gray-100 text-gray-600 rounded-lg font-bold hover:bg-gray-200 transition">取消</button></div></div></div> )}
      {showSlimmingModal && ( <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in"><div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm text-center"><div className="w-16 h-16 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center mx-auto mb-4"><Scissors size={32} /></div><h3 className="font-bold text-xl mb-2 text-gray-900">文件瘦身</h3><p className="text-gray-500 mb-6 text-sm">此操作将压缩所有聊天记录中的图片、表情包以及您收藏的表情。<br/>这可能需要几秒钟的时间，且会轻微降低图片清晰度以节省空间。</p><div className="space-y-3"><button onClick={executeSlimming} className="w-full py-3 bg-purple-600 text-white rounded-lg font-bold shadow-md hover:bg-purple-700 transition">开始瘦身</button><button onClick={() => setShowSlimmingModal(false)} className="w-full py-3 bg-gray-100 text-gray-600 rounded-lg font-bold hover:bg-gray-200 transition">取消</button></div></div></div> )}
      {slimmingResult && ( <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in"><div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm text-center"><div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4"><Check size={32} /></div><h3 className="font-bold text-xl mb-2 text-gray-900">瘦身完成</h3><div className="text-gray-600 mb-6 text-sm"><div className="mb-2">成功处理了 <span className="font-bold text-gray-900">{slimmingResult.count}</span> 张图片</div><div className="text-2xl font-bold text-green-600">-{slimmingResult.freedKB} KB</div><div className="text-xs text-gray-400 mt-1">已为您释放存储空间</div></div><button onClick={() => setSlimmingResult(null)} className="w-full py-3 bg-gray-100 text-gray-900 rounded-lg font-bold hover:bg-gray-200 transition">关闭</button></div></div> )}
      {chatToDeleteId && ( <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-fade-in"><div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-sm text-center"><h3 className="font-bold text-lg mb-2 text-gray-900">删除对话</h3><p className="text-gray-500 mb-6 text-sm">确定要删除这个对话吗？聊天记录将无法找回。</p><div className="flex justify-center gap-3"><button onClick={() => setChatToDeleteId(null)} className="px-5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition">取消</button><button onClick={executeDeleteChat} className="px-5 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 shadow-sm shadow-red-200 transition">删除</button></div></div></div> )}

    </div>
  );
};

export default App;
