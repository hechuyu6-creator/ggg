import React, { useState, useEffect, useRef } from 'react';
import { ChatSession, ChatConfig, ModelOption, ApiProvider, Sticker, Role, Message } from '../types';
import { fetchAvailableModels } from '../services/geminiService';
import { X, RefreshCw, Save, User, Settings2, Link, Key, Globe, Loader2, AlertCircle, CheckCircle2, Upload, Camera, BrainCircuit, History, Wifi, Zap, Layers, Smile, Sliders, Image as ImageIcon, CreditCard, AlignLeft, MessageCircle, Calculator, Shield, ShieldAlert, AlertTriangle } from 'lucide-react';

interface ChatSettingsProps {
  chat: ChatSession;
  stickers: Sticker[]; // Added for token calculation
  onSave: (chatId: string, newConfig: ChatConfig, newName: string, newAvatar: string) => void;
  onClearChat: () => void;
  onClose: () => void;
  onLog: (msg: string, type: 'info' | 'error' | 'success') => void;
}

const ChatSettings: React.FC<ChatSettingsProps> = ({ chat, stickers, onSave, onClearChat, onClose, onLog }) => {
  const [activeTab, setActiveTab] = useState<'connect' | 'character' | 'params'>('connect');
  
  // Config State
  const [config, setConfig] = useState<ChatConfig>(chat.config);
  
  // Character State
  const [charName, setCharName] = useState(chat.name);
  const [charAvatar, setCharAvatar] = useState(chat.avatar);

  // Model Fetching State
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');

  // Clear Confirmation State
  const [isConfirmingClear, setIsConfirmingClear] = useState(false);

  // Token Estimation State
  const [tokenStats, setTokenStats] = useState({ total: 0, system: 0, history: 0, images: 0 });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pre-populate models
  useEffect(() => {
    if (chat.config.model) {
       setAvailableModels([{ id: chat.config.model, name: chat.config.model, description: '当前模型' }]);
    }
  }, [chat.config.model]);

  // Ensure config defaults
  useEffect(() => {
    if (config.provider === 'google' && !config.googleAuthMode) {
        setConfig(prev => ({ ...prev, googleAuthMode: 'key' }));
    }
    if (config.historyLimit === undefined) setConfig(prev => ({ ...prev, historyLimit: 20 }));
    if (config.thinkingBudget === undefined) setConfig(prev => ({ ...prev, thinkingBudget: 0 }));
    if (config.enableSearch === undefined) setConfig(prev => ({ ...prev, enableSearch: false }));
    if (config.enableStream === undefined) setConfig(prev => ({ ...prev, enableStream: true }));
    if (config.enableStickers === undefined) setConfig(prev => ({ ...prev, enableStickers: false }));
    if (config.enableTransfer === undefined) setConfig(prev => ({ ...prev, enableTransfer: false }));
    if (config.dialogueMode === undefined) setConfig(prev => ({ ...prev, dialogueMode: 'normal' }));
    if (config.topP === undefined) setConfig(prev => ({ ...prev, topP: 0.95 }));
    if (config.topK === undefined) setConfig(prev => ({ ...prev, topK: 64 }));
    if (config.visualMemoryLimit === undefined) setConfig(prev => ({ ...prev, visualMemoryLimit: 3 }));
  }, [config.provider, config.googleAuthMode]);

  // --- TOKEN CALCULATION LOGIC ---
  const countTextTokens = (text: string) => {
      if (!text) return 0;
      let cjk = 0;
      let other = 0;
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        // Basic CJK range
        if ((code >= 0x4E00 && code <= 0x9FFF) || 
            (code >= 0x3400 && code <= 0x4DBF) || 
            (code >= 0x20000 && code <= 0x2A6DF)) {
          cjk++;
        } else {
          other++;
        }
      }
      return cjk + Math.ceil(other / 4);
  };

  const estimateTokenCount = () => {
      let sysTokens = 0;
      let histTokens = 0;
      let imageTokens = 0;

      // 1. System Prompt Estimation
      let sysText = config.systemInstruction || '';
      
      // Add approximate protocol text lengths
      if (config.dialogueMode === 'novel') {
          sysText += ` [IMMERSIVE NOVEL MODE] XML TAGS REQUIRED <action> <say> rules constraints examples... `;
      }
      if (config.enableStickers && stickers.length > 0) {
           sysText += ` [STICKER PROTOCOL] Available stickers: ${stickers.map(s => s.id + s.description).join(' ')} rules... `;
      }
      if (config.enableTransfer) {
          sysText += ` [TRANSFER PROTOCOL] <TRANSFER> <ACCEPT> <REJECT> rules... `;
      }
      
      sysTokens = countTextTokens(sysText);

      // 2. History Estimation
      const limit = config.historyLimit ?? 20;
      // Filter out system messages from history count (they are rare/internal)
      let msgs = chat.messages.filter(m => m.role !== Role.SYSTEM);
      
      // Apply History Limit (0 means all)
      if (limit > 0) {
          msgs = msgs.slice(-limit);
      }

      const visualLimit = config.visualMemoryLimit ?? 3;
      const totalMsgs = msgs.length;

      msgs.forEach((m, idx) => {
          const isRecent = idx >= totalMsgs - visualLimit;
          let contentText = m.content || '';

          // Handle Metadata -> Text conversion
          if (m.metadata?.isSticker && m.metadata?.stickerDescription) {
             const identity = m.role === Role.USER ? 'User' : 'Assistant';
             contentText = `[${identity} sent a sticker: ${m.metadata.stickerDescription}]`;
          } 
          else if (m.metadata?.transferAmount) {
             const identity = m.role === Role.USER ? 'User' : 'Assistant';
             contentText = `[${identity} sent a transfer of ￥${m.metadata.transferAmount}]`;
          }
          else if (config.dialogueMode === 'novel' && m.content) {
              // Approx xml tags overhead
              contentText = `<say>${m.content}</say>`; 
          }

          histTokens += countTextTokens(contentText);

          // Handle Images
          if (m.attachments && m.attachments.length > 0 && !m.metadata?.isSticker) {
              if (isRecent) {
                  const cost = 258 * m.attachments.length;
                  imageTokens += cost;
              } else {
                  const placeholder = `[System: Image archived]`;
                  histTokens += countTextTokens(placeholder);
              }
          }
      });

      setTokenStats({
          total: sysTokens + histTokens + imageTokens,
          system: sysTokens,
          history: histTokens,
          images: imageTokens
      });
  };

  useEffect(() => {
      const timer = setTimeout(estimateTokenCount, 300); // Debounce
      return () => clearTimeout(timer);
  }, [config, chat.messages, stickers]);


  const handleFetchModels = async () => {
    if (config.provider === 'google' && config.googleAuthMode === 'key' && !config.apiKey && !config.apiUrl) {
         setConnectionStatus('error');
         setStatusMessage('请输入 API Key 或自定义 API 地址');
         onLog('获取模型失败: 未填写 Key 且无自定义地址', 'error');
         return;
    }

    setIsLoadingModels(true);
    setConnectionStatus('idle');
    setStatusMessage('');
    onLog(`开始获取模型列表 (${config.provider})...`, 'info');

    try {
      const models = await fetchAvailableModels(config);
      if (models.length === 0) {
          throw new Error("未找到任何模型，请检查连接。");
      }
      setAvailableModels(models.map(m => ({ id: m.id, name: m.name, description: m.description || '可用' })));
      setConnectionStatus('success');
      setStatusMessage(`成功获取 ${models.length} 个模型`);
      onLog(`成功获取 ${models.length} 个模型`, 'success');
      
      if (!config.model || !models.find(m => m.id === config.model)) {
          setConfig(prev => ({ ...prev, model: models[0].id }));
      }
    } catch (err: any) {
      console.error(err);
      setConnectionStatus('error');
      setStatusMessage(err.message || '连接失败');
      onLog(`连接失败: ${err.message}`, 'error');
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleSave = () => {
    onSave(chat.id, config, charName, charAvatar);
    onLog('设置已保存', 'success');
    onClose();
  };

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setCharAvatar(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const getDefaultUrl = (provider: ApiProvider) => {
      return provider === 'google' 
        ? 'https://generativelanguage.googleapis.com' 
        : 'https://api.openai.com/v1';
  };

  const isGoogleCookieMode = config.provider === 'google' && config.googleAuthMode === 'cookie';

  const handleClearClick = () => {
      if (isConfirmingClear) {
          onClearChat();
          onLog('聊天记录已清空', 'info');
      } else {
          setIsConfirmingClear(true);
          setTimeout(() => setIsConfirmingClear(false), 3000);
      }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden font-sans">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
          <div className="flex items-center gap-2">
            <Settings2 className="text-gray-600" size={20} />
            <h2 className="text-lg font-bold text-gray-800">对话设置</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X size={22} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 bg-white px-4">
            <button 
                onClick={() => setActiveTab('connect')}
                className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'connect' ? 'border-green-500 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
                <Link size={14} /> 连接
            </button>
            <button 
                onClick={() => setActiveTab('character')}
                className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'character' ? 'border-green-500 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
                <User size={14} /> 角色
            </button>
            <button 
                onClick={() => setActiveTab('params')}
                className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'params' ? 'border-green-500 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            >
                <Settings2 size={14} /> 参数
            </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto flex-1 bg-gray-50/50">
          
          {/* TAB: Connection */}
          {activeTab === 'connect' && (
            <div className="space-y-5 animate-fade-in">
                
                <div className="space-y-2">
                    <label className="block text-xs font-bold text-gray-500 uppercase">API 提供商</label>
                    <div className="grid grid-cols-2 gap-2">
                        <button 
                            onClick={() => setConfig({...config, provider: 'google'})}
                            className={`p-3 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 ${config.provider === 'google' ? 'bg-green-50 border-green-500 text-green-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                        >
                            Google Gemini
                        </button>
                        <button 
                            onClick={() => setConfig({...config, provider: 'openai'})}
                            className={`p-3 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 ${config.provider === 'openai' ? 'bg-green-50 border-green-500 text-green-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                        >
                            OpenAI / 通用
                        </button>
                    </div>
                </div>

                {config.provider === 'google' && (
                    <div className="space-y-2 animate-fade-in">
                        <label className="block text-xs font-bold text-gray-500 uppercase">鉴权方式</label>
                        <div className="flex bg-gray-200 rounded-lg p-1">
                            <button
                                onClick={() => setConfig({...config, googleAuthMode: 'key'})}
                                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-2 ${config.googleAuthMode === 'key' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                <Key size={12} /> API Key
                            </button>
                            <button
                                onClick={() => setConfig({...config, googleAuthMode: 'cookie'})}
                                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all flex items-center justify-center gap-2 ${config.googleAuthMode === 'cookie' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                <Globe size={12} /> 浏览器/Cookie
                            </button>
                        </div>
                    </div>
                )}

                {!isGoogleCookieMode && (
                    <div className="space-y-2 animate-fade-in">
                        <label className="block text-xs font-bold text-gray-500 uppercase">API 地址 (Base URL)</label>
                        <input
                            type="text"
                            value={config.apiUrl}
                            onChange={(e) => setConfig({...config, apiUrl: e.target.value})}
                            className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none text-sm font-mono placeholder-gray-400"
                            placeholder={getDefaultUrl(config.provider)}
                        />
                    </div>
                )}
                
                {!isGoogleCookieMode && (
                    <div className="space-y-2 animate-fade-in">
                        <label className="block text-xs font-bold text-gray-500 uppercase">API Key (可选)</label>
                        <input
                            type="password"
                            value={config.apiKey}
                            onChange={(e) => setConfig({...config, apiKey: e.target.value})}
                            className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none text-sm font-mono"
                            placeholder="如使用自定义接口，可留空"
                        />
                    </div>
                )}

                <div className="pt-2">
                    <button
                        onClick={handleFetchModels}
                        disabled={isLoadingModels}
                        className={`w-full py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-colors ${isLoadingModels ? 'bg-gray-100 text-gray-400' : 'bg-gray-800 text-white hover:bg-gray-900'}`}
                    >
                        {isLoadingModels ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                        {isLoadingModels ? '正在获取...' : '获取模型列表'}
                    </button>
                    
                    {connectionStatus !== 'idle' && (
                        <div className={`mt-2 flex items-center gap-2 text-xs p-2 rounded ${connectionStatus === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                            {connectionStatus === 'success' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                            <span>{statusMessage}</span>
                        </div>
                    )}
                </div>

                <div className="space-y-2 pt-2 border-t border-gray-200 mt-2">
                    <label className="block text-xs font-bold text-gray-500 uppercase">选择模型</label>
                    <div className="relative">
                        <select
                            value={config.model}
                            onChange={(e) => setConfig({...config, model: e.target.value})}
                            className="w-full p-2.5 bg-white border border-gray-300 rounded-lg appearance-none focus:ring-2 focus:ring-green-500 outline-none text-sm pr-8"
                        >
                            <option value="" disabled>请选择模型...</option>
                            {availableModels.map(m => (
                                <option key={m.id} value={m.id}>
                                    {m.name} {m.id !== m.name ? `(${m.id})` : ''}
                                </option>
                            ))}
                        </select>
                        <div className="absolute right-3 top-3 pointer-events-none text-gray-500">
                             <Settings2 size={14} />
                        </div>
                    </div>
                </div>

            </div>
          )}

          {/* TAB: Character */}
          {activeTab === 'character' && (
             <div className="space-y-5 animate-fade-in">
                 <div className="space-y-2">
                    <label className="block text-xs font-bold text-gray-500 uppercase">角色名称</label>
                    <input
                        type="text"
                        value={charName}
                        onChange={(e) => setCharName(e.target.value)}
                        className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none text-sm"
                        placeholder="例如：AI 助手"
                    />
                 </div>
                 
                 <div className="space-y-2">
                    <label className="block text-xs font-bold text-gray-500 uppercase">头像</label>
                    <div className="flex gap-4 items-start">
                        <div 
                            className="relative w-16 h-16 rounded-lg bg-gray-200 overflow-hidden cursor-pointer group border border-gray-200"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <img src={charAvatar} alt="Preview" className="w-full h-full object-cover" />
                             <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <Camera className="text-white w-6 h-6" />
                             </div>
                        </div>
                        <div className="flex-1 space-y-2">
                            <button 
                                onClick={() => fileInputRef.current?.click()}
                                className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium hover:bg-gray-50 flex items-center gap-2"
                            >
                                <Upload size={12} /> 从相册选择
                            </button>
                            <input
                                type="text"
                                value={charAvatar}
                                onChange={(e) => setCharAvatar(e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none text-xs text-gray-500"
                                placeholder="或使用网络图片链接..."
                            />
                            <input 
                                type="file" 
                                ref={fileInputRef} 
                                className="hidden" 
                                accept="image/*"
                                onChange={handleAvatarFileChange}
                            />
                        </div>
                    </div>
                 </div>

                 <div className="space-y-2">
                    <label className="block text-xs font-bold text-gray-500 uppercase">系统设定 (System Prompt)</label>
                    <textarea
                        value={config.systemInstruction}
                        onChange={(e) => setConfig({...config, systemInstruction: e.target.value})}
                        className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none text-sm min-h-[160px] resize-none leading-relaxed"
                        placeholder="你是一个..."
                    />
                 </div>
             </div>
          )}

          {/* TAB: Parameters */}
          {activeTab === 'params' && (
              <div className="space-y-6 animate-fade-in">
                  
                  {/* TOKEN CALCULATOR DISPLAY */}
                  <div className="bg-gray-800 rounded-lg p-3 text-white space-y-2">
                      <div className="flex items-center gap-2 border-b border-gray-600 pb-2 mb-2">
                          <Calculator size={16} className="text-green-400"/>
                          <span className="text-sm font-bold">预估 Token 消耗</span>
                          <span className="ml-auto text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded-full font-mono">
                              Total: {tokenStats.total}
                          </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-xs text-gray-400">
                          <div className="flex flex-col items-center p-1.5 bg-gray-700/50 rounded">
                              <span className="mb-1 text-[10px] uppercase tracking-wider">System</span>
                              <span className="font-mono text-white">{tokenStats.system}</span>
                          </div>
                          <div className="flex flex-col items-center p-1.5 bg-gray-700/50 rounded">
                              <span className="mb-1 text-[10px] uppercase tracking-wider">History</span>
                              <span className="font-mono text-white">{tokenStats.history}</span>
                          </div>
                          <div className="flex flex-col items-center p-1.5 bg-gray-700/50 rounded">
                              <span className="mb-1 text-[10px] uppercase tracking-wider">Images</span>
                              <span className="font-mono text-white">{tokenStats.images}</span>
                          </div>
                      </div>
                      <div className="text-[10px] text-gray-500 text-center pt-1 scale-90">
                          中文按1字符计，英文按0.25字符计，图片按258计。
                      </div>
                  </div>

                  <div className={`bg-white border border-gray-200 p-4 rounded-lg flex items-center justify-between shadow-sm transition-colors`}>
                      <div className="flex items-center gap-3">
                          <Zap size={18} className="text-yellow-500" />
                          <div>
                              <div className="text-sm font-bold text-gray-800">流式传输 (Streaming)</div>
                              <div className="text-xs text-gray-400">打字机效果，响应速度更快</div>
                          </div>
                      </div>
                      <div 
                        onClick={() => setConfig({...config, enableStream: !config.enableStream})}
                        className={`w-10 h-6 rounded-full p-1 transition-colors cursor-pointer ${config.enableStream ? 'bg-green-500' : 'bg-gray-300'}`}
                        >
                        <div className={`w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform ${config.enableStream ? 'translate-x-4' : 'translate-x-0'}`} />
                      </div>
                  </div>

                  {/* Dialogue Mode Selection */}
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-gray-500 uppercase">对话模式</label>
                    <div className="grid grid-cols-2 gap-2">
                        <button 
                            onClick={() => setConfig({...config, dialogueMode: 'normal'})}
                            className={`py-2 px-1 rounded-lg text-sm font-medium border flex flex-col items-center justify-center gap-1 transition-all ${(!config.dialogueMode || config.dialogueMode === 'normal') ? 'bg-blue-50 border-blue-500 text-blue-700 ring-1 ring-blue-500' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                        >
                            <BrainCircuit size={16} /> 标准模式
                        </button>
                        <button 
                            onClick={() => setConfig({...config, dialogueMode: 'novel'})}
                            className={`py-2 px-1 rounded-lg text-sm font-medium border flex flex-col items-center justify-center gap-1 transition-all ${config.dialogueMode === 'novel' ? 'bg-blue-50 border-blue-500 text-blue-700 ring-1 ring-blue-500' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                        >
                            <AlignLeft size={16} /> 沉浸/小说模式
                        </button>
                    </div>
                  </div>

                  <hr className="border-gray-100" />

                  {/* Sticker Settings */}
                  <div className="bg-pink-50 border border-pink-100 p-4 rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                             <div className="flex items-center gap-2">
                                <Smile size={16} className="text-pink-600"/>
                                <label className="text-sm font-bold text-gray-700">允许 AI 发送表情包</label>
                             </div>
                             <div 
                                onClick={() => setConfig({...config, enableStickers: !config.enableStickers})}
                                className={`w-10 h-6 rounded-full p-1 cursor-pointer transition-colors ${config.enableStickers ? 'bg-green-500' : 'bg-gray-300'}`}
                             >
                                <div className={`w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform ${config.enableStickers ? 'translate-x-4' : 'translate-x-0'}`} />
                             </div>
                      </div>
                      <p className="text-[10px] text-gray-500">
                          开启后，AI 将根据对话语境自然地发送表情包。
                      </p>
                  </div>

                  {/* Transfer Settings */}
                   <div className="bg-orange-50 border border-orange-100 p-4 rounded-lg space-y-2">
                      <div className="flex items-center justify-between">
                             <div className="flex items-center gap-2">
                                <CreditCard size={16} className="text-orange-600"/>
                                <label className="text-sm font-bold text-gray-700">允许 AI 发起/接收转账</label>
                             </div>
                             <div 
                                onClick={() => setConfig({...config, enableTransfer: !config.enableTransfer})}
                                className={`w-10 h-6 rounded-full p-1 cursor-pointer transition-colors ${config.enableTransfer ? 'bg-green-500' : 'bg-gray-300'}`}
                             >
                                <div className={`w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform ${config.enableTransfer ? 'translate-x-4' : 'translate-x-0'}`} />
                             </div>
                      </div>
                      <p className="text-[10px] text-gray-500">
                          开启后，AI 可模拟微信转账功能，包括发起转账和点击收款。
                      </p>
                  </div>
                  
                  {/* Google Specific Settings */}
                  {config.provider === 'google' && (
                      <div className="bg-green-50 border border-green-100 p-4 rounded-lg space-y-4">
                          <div className="flex items-center justify-between">
                             <div className="flex items-center gap-2">
                                <Wifi size={16} className="text-green-600"/>
                                <label className="text-sm font-bold text-gray-700">联网搜索 (Grounding)</label>
                             </div>
                             <div 
                                onClick={() => setConfig({...config, enableSearch: !config.enableSearch})}
                                className={`w-10 h-6 rounded-full p-1 cursor-pointer transition-colors ${config.enableSearch ? 'bg-green-500' : 'bg-gray-300'}`}
                             >
                                <div className={`w-4 h-4 bg-white rounded-full shadow-sm transform transition-transform ${config.enableSearch ? 'translate-x-4' : 'translate-x-0'}`} />
                             </div>
                          </div>
                          
                          <div>
                              <div className="flex justify-between mb-1">
                                  <div className="flex items-center gap-2">
                                    <BrainCircuit size={16} className="text-green-600" />
                                    <label className="text-xs font-bold text-gray-700 uppercase">思考预算</label>
                                  </div>
                                  <span className="text-xs font-mono bg-white px-1.5 rounded border border-green-200">{config.thinkingBudget}</span>
                              </div>
                              <input
                                  type="range"
                                  min="0"
                                  max="16384"
                                  step="128"
                                  value={config.thinkingBudget}
                                  onChange={(e) => setConfig({...config, thinkingBudget: parseInt(e.target.value)})}
                                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-600"
                              />
                          </div>
                      </div>
                  )}

                  <div className="space-y-4">
                      {/* Context Limit */}
                      <div>
                          <div className="flex justify-between mb-1">
                               <div className="flex items-center gap-2">
                                    <History size={16} className="text-gray-500" />
                                    <label className="text-xs font-bold text-gray-500 uppercase">上下文记忆窗口</label>
                               </div>
                              <span className="text-xs font-mono bg-gray-100 px-1.5 rounded">
                                {config.historyLimit === 0 ? '无限制 (全部历史)' : `${config.historyLimit} 条`}
                              </span>
                          </div>
                          <input
                              type="range"
                              min="0"
                              max="100"
                              step="2"
                              value={config.historyLimit}
                              onChange={(e) => setConfig({...config, historyLimit: parseInt(e.target.value)})}
                              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-600"
                          />
                          <p className="text-[10px] text-gray-400 mt-1">设置为 0 即发送所有历史记录 (注意 Token 消耗)</p>
                      </div>

                       {/* Visual Memory Limit */}
                       <div>
                          <div className="flex justify-between mb-1">
                               <div className="flex items-center gap-2">
                                    <ImageIcon size={16} className="text-gray-500" />
                                    <label className="text-xs font-bold text-gray-500 uppercase">视觉记忆窗口</label>
                               </div>
                              <span className="text-xs font-mono bg-gray-100 px-1.5 rounded">{config.visualMemoryLimit ?? 3} 条</span>
                          </div>
                          <input
                              type="range"
                              min="0"
                              max="5"
                              step="1"
                              value={config.visualMemoryLimit ?? 3}
                              onChange={(e) => setConfig({...config, visualMemoryLimit: parseInt(e.target.value)})}
                              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-600"
                          />
                           <p className="text-[10px] text-gray-400 mt-1">仅保留最近 N 条消息的图片数据，旧图片转为文本以节省流量。</p>
                      </div>

                      <hr className="border-gray-100" />

                      {/* Standard Params */}
                      <div>
                          <div className="flex justify-between mb-1">
                              <div className="flex items-center gap-2">
                                  <Sliders size={16} className="text-gray-500"/>
                                  <label className="text-xs font-bold text-gray-500 uppercase">Temperature</label>
                              </div>
                              <span className="text-xs font-mono bg-gray-100 px-1.5 rounded">{config.temperature}</span>
                          </div>
                          <input
                              type="range"
                              min="0"
                              max="2"
                              step="0.1"
                              value={config.temperature}
                              onChange={(e) => setConfig({...config, temperature: parseFloat(e.target.value)})}
                              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-600"
                          />
                      </div>

                      <div>
                          <div className="flex justify-between mb-1">
                              <div className="flex items-center gap-2">
                                  <Sliders size={16} className="text-gray-500"/>
                                  <label className="text-xs font-bold text-gray-500 uppercase">Top P</label>
                              </div>
                              <span className="text-xs font-mono bg-gray-100 px-1.5 rounded">{config.topP}</span>
                          </div>
                          <input
                              type="range"
                              min="0"
                              max="1"
                              step="0.05"
                              value={config.topP}
                              onChange={(e) => setConfig({...config, topP: parseFloat(e.target.value)})}
                              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-600"
                          />
                      </div>

                      <div>
                          <div className="flex justify-between mb-1">
                              <div className="flex items-center gap-2">
                                  <Sliders size={16} className="text-gray-500"/>
                                  <label className="text-xs font-bold text-gray-500 uppercase">Top K</label>
                              </div>
                              <span className="text-xs font-mono bg-gray-100 px-1.5 rounded">{config.topK}</span>
                          </div>
                          <input
                              type="range"
                              min="1"
                              max="100"
                              step="1"
                              value={config.topK}
                              onChange={(e) => setConfig({...config, topK: parseInt(e.target.value)})}
                              className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-green-600"
                          />
                      </div>
                  </div>
              </div>
          )}

          <div className="mt-6 pt-4 border-t border-gray-100">
             <button 
                 onClick={handleClearClick}
                 className={`w-full py-3 text-sm font-medium rounded-lg transition-colors mb-2 duration-200 ${
                     isConfirmingClear 
                     ? 'bg-red-600 text-white shadow-inner animate-pulse' 
                     : 'text-red-600 bg-red-50 hover:bg-red-100'
                 }`}
             >
                 {isConfirmingClear ? '再次点击确认清空 (3s后取消)' : '清空聊天记录'}
             </button>
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 bg-white flex justify-end gap-3">
            <button 
                onClick={onClose}
                className="px-5 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
                取消
            </button>
            <button 
                onClick={handleSave}
                className="px-6 py-2.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg shadow-sm shadow-green-200 transition-colors flex items-center gap-2"
            >
                <Save size={16} /> 保存设置
            </button>
        </div>

      </div>
    </div>
  );
};

export default ChatSettings;