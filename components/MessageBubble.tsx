import React, { useState, useRef, useEffect } from 'react';
import { Message, Role, DialogueMode } from '../types';
import { Edit2, RefreshCcw, Trash2, ArrowRightLeft, Check, RotateCcw, Save, Play } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface MessageBubbleProps {
  message: Message;
  chatAvatar: string;
  userAvatar: string;
  isLast: boolean;
  isLastUser?: boolean;
  userBubbleColor: string;
  botBubbleColor: string;
  actionTextColor?: string;
  dialogueMode?: DialogueMode;
  onEdit: (newContent: string, shouldRegenerate?: boolean) => void;
  onDelete: () => void;
  onRegenerate?: () => void;
  onTransferClick?: (msg: Message) => void;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ 
  message, 
  chatAvatar, 
  userAvatar,
  isLast, 
  isLastUser,
  userBubbleColor,
  botBubbleColor,
  actionTextColor,
  dialogueMode = 'normal',
  onEdit, 
  onDelete,
  onRegenerate,
  onTransferClick
}) => {
  const isUser = message.role === Role.USER;
  const isSystem = message.role === Role.SYSTEM;
  
  const [showMenu, setShowMenu] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const menuRef = useRef<HTMLDivElement>(null);
  
  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSaveEdit = (shouldRegenerate: boolean = false) => {
    if (editContent.trim() !== message.content || shouldRegenerate) {
      onEdit(editContent, shouldRegenerate);
    }
    setIsEditing(false);
    setShowMenu(false);
  };

  // Determine if regenerate option should be shown
  const canRegenerate = onRegenerate && (isUser || (!isUser && isLast));

  // --- SYSTEM MESSAGE RENDERER ---
  if (isSystem) {
      return (
          <div id={`msg-${message.id}`} className="flex justify-center mb-4 w-full relative group">
              <span 
                className="bg-[#dadada] text-white text-xs px-2.5 py-1 rounded-[4px] shadow-sm max-w-[80%] text-center cursor-pointer select-none"
                onContextMenu={(e) => {
                    e.preventDefault();
                    setShowMenu(true);
                }}
              >
                  {message.content}
              </span>
              
              {showMenu && (
                 <div 
                   ref={menuRef}
                   className="absolute z-10 top-full mt-1 bg-[#2b2b2b] text-white text-xs rounded shadow-lg py-1 px-1 flex items-center animate-fade-in"
                 >
                    <button 
                      onClick={() => { onDelete(); setShowMenu(false); }}
                      className="px-3 py-1.5 hover:bg-white/10 rounded flex items-center gap-1.5 whitespace-nowrap text-red-400 hover:text-red-300"
                    >
                      <Trash2 size={12} /> 删除
                    </button>
                 </div>
              )}
          </div>
      );
  }

  // --- ACTION MESSAGE RENDERER (ONLY IN NOVEL MODE) ---
  if (message.metadata?.isAction && dialogueMode === 'novel') {
      return (
        <div id={`msg-${message.id}`} className={`flex w-full mb-2 ${isUser ? 'justify-end' : 'justify-start'} animate-fade-in relative group`}>
             {!isUser && (
                <div className="w-10 h-10 mr-3 flex-shrink-0" /> // Spacer for alignment
             )}
             
             <div className={`max-w-[75%] ${isUser ? 'text-right' : 'text-left'}`}>
                 {isEditing ? (
                    <div className="relative min-w-[200px]">
                        <textarea
                            value={editContent}
                            onChange={(e) => setEditContent(e.target.value)}
                            className="w-full p-2 bg-white/50 rounded border border-black/10 text-xs italic focus:outline-none focus:ring-1 focus:ring-black/20 resize-none"
                            style={{ color: actionTextColor || '#888888' }}
                            rows={Math.max(2, editContent.length / 40)}
                            autoFocus
                        />
                        <div className="flex justify-end gap-2 mt-1">
                            <button 
                                onClick={() => setIsEditing(false)} 
                                className="text-[10px] px-2 py-0.5 bg-black/10 rounded hover:bg-black/20"
                            >
                                取消
                            </button>
                            <button 
                                onClick={() => handleSaveEdit(false)} 
                                className="text-[10px] px-2 py-0.5 bg-black/80 text-white rounded hover:bg-black"
                            >
                                完成
                            </button>
                             {canRegenerate && isUser && (
                                <button 
                                    onClick={() => handleSaveEdit(true)} 
                                    className="text-[10px] px-2 py-0.5 bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-1"
                                >
                                    <RefreshCcw size={8} /> 保存并重成
                                </button>
                            )}
                        </div>
                    </div>
                 ) : (
                     <div 
                        className="text-xs italic px-2 py-1 cursor-text select-text"
                        style={{ color: actionTextColor || '#888888' }}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            setShowMenu(true);
                        }}
                     >
                         {message.content}
                     </div>
                 )}
             </div>

             {/* Action Message Context Menu */}
              {showMenu && !isEditing && (
                 <div 
                   ref={menuRef}
                   className={`absolute z-10 bg-[#2b2b2b] text-white text-xs rounded shadow-lg py-1 px-1 flex items-center animate-fade-in ${isUser ? 'right-10' : 'left-10'}`}
                 >
                    <button 
                        onClick={() => { setIsEditing(true); setShowMenu(false); }}
                        className="px-3 py-1.5 hover:bg-white/10 rounded flex items-center gap-1.5 whitespace-nowrap"
                    >
                        <Edit2 size={12} /> 编辑
                    </button>
                    <div className="w-[1px] h-3 bg-white/20 mx-1"></div>
                    
                    <button 
                      onClick={() => { onDelete(); setShowMenu(false); }}
                      className="px-3 py-1.5 hover:bg-white/10 rounded flex items-center gap-1.5 whitespace-nowrap text-red-400 hover:text-red-300"
                    >
                      <Trash2 size={12} /> 删除
                    </button>

                    {canRegenerate && (
                        <>
                            <div className="w-[1px] h-3 bg-white/20 mx-1"></div>
                            <button 
                                onClick={() => { onRegenerate && onRegenerate(); setShowMenu(false); }}
                                className="px-3 py-1.5 hover:bg-white/10 rounded flex items-center gap-1.5 whitespace-nowrap"
                            >
                                <RefreshCcw size={12} /> {isUser ? '重新生成' : '重试'}
                            </button>
                        </>
                    )}
                 </div>
              )}
        </div>
      );
  }

  // --- NORMAL MESSAGE LOGIC ---

  // Logic to determine if we should render without a colored bubble
  const hasText = message.content && message.content.trim().length > 0;
  const hasAttachments = message.attachments && message.attachments.length > 0;
  const isTransfer = !!message.metadata?.transferAmount;

  // If it has attachments but NO text, it's a bubble-less sticker/image
  const isBubbleless = (hasAttachments && !hasText && !isEditing) || isTransfer;

  // Error Message Check
  const isError = !isUser && (message.content.startsWith('错误:') || message.content.startsWith('Error:'));

  const renderTransferCard = () => {
      const amount = message.metadata?.transferAmount;
      const status = message.metadata?.transferStatus || 'pending';
      const isAccepted = status === 'accepted';
      const isRefunded = status === 'refunded';
      
      const isInactive = isAccepted || isRefunded;

      let title = "";
      if (isUser) {
          if (isAccepted) title = "转账已被接收";
          else if (isRefunded) title = "转账已被退还";
          else title = "转账";
      } else {
          if (isAccepted) title = "已收款";
          else if (isRefunded) title = "已退还";
          else title = "转账给您";
      }

      const Icon = isRefunded ? RotateCcw : (isAccepted ? Check : ArrowRightLeft);

      return (
          <div 
             className={`w-60 rounded-[10px] overflow-hidden cursor-pointer transition-opacity ${isInactive ? 'opacity-60' : 'opacity-100'}`}
             onClick={() => {
                 if (!isUser && status === 'pending' && onTransferClick) {
                     onTransferClick(message);
                 }
             }}
          >
              <div className="bg-[#f79b1f] p-4 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full border-2 border-white flex items-center justify-center">
                      <Icon className="text-white" size={20}/>
                  </div>
                  <div className="flex flex-col text-white">
                      <span className="text-[15px] font-medium">¥{amount?.toFixed(2)}</span>
                      <span className="text-[12px] opacity-90">{title}</span>
                  </div>
              </div>
              <div className="bg-white p-2 px-4 border-t border-gray-100">
                  <span className="text-[10px] text-gray-400">微信转账</span>
              </div>
          </div>
      );
  };

  return (
    <div id={`msg-${message.id}`} className={`flex w-full mb-5 ${isUser ? 'justify-end' : 'justify-start'} group relative`}>
      
      {/* Avatar (Left - AI) */}
      {!isUser && (
        <img 
          src={chatAvatar} 
          alt="AI" 
          className="w-10 h-10 rounded-md mr-3 object-cover shadow-sm bg-gray-200 flex-shrink-0" 
        />
      )}

      {/* Message Content Wrapper */}
      <div className={`max-w-[75%] relative ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        
        {/* The Bubble */}
        <div
          className={`relative text-[15px] leading-relaxed break-words
            ${isBubbleless 
                ? 'p-0 bg-transparent shadow-none' // Transparent for stickers/transfers
                : `px-4 py-2.5 rounded-lg shadow-sm ${isUser ? 'rounded-tr-none' : 'rounded-tl-none border border-gray-100'}`
            }
          `}
          style={!isBubbleless ? {
             backgroundColor: isError ? '#fee2e2' : (isUser ? userBubbleColor : botBubbleColor),
             color: isError ? '#dc2626' : '#000',
             border: isError ? '1px solid #fca5a5' : undefined
          } : undefined}
          onContextMenu={(e) => {
            e.preventDefault();
            setShowMenu(true);
          }}
        >
          {/* Transfer Card */}
          {isTransfer && renderTransferCard()}

          {/* Image Attachments */}
          {message.attachments && message.attachments.length > 0 && (
             <div className={hasText ? "mb-2 space-y-2" : "space-y-2"}>
                 {message.attachments.map((att, idx) => (
                     <img 
                        key={idx} 
                        src={att.data} 
                        alt="attachment" 
                        className="max-w-full h-auto rounded-lg"
                        style={{ maxHeight: '300px' }}
                     />
                 ))}
             </div>
          )}

          {isEditing ? (
            <div className={`min-w-[200px] ${isBubbleless ? 'bg-white p-2 rounded border border-gray-200 shadow-sm' : ''}`}>
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full p-2 bg-white/50 rounded border border-black/10 text-sm focus:outline-none focus:ring-1 focus:ring-black/20 resize-none"
                rows={Math.max(3, editContent.length / 30)}
                autoFocus
              />
              <div className="flex justify-end gap-2 mt-2">
                <button 
                    onClick={() => setIsEditing(false)} 
                    className="text-xs px-2 py-1 bg-black/10 rounded hover:bg-black/20"
                >
                    取消
                </button>
                <button 
                    onClick={() => handleSaveEdit(false)} 
                    className="text-xs px-2 py-1 bg-black/80 text-white rounded hover:bg-black"
                >
                    完成
                </button>
                {canRegenerate && isUser && (
                    <button 
                        onClick={() => handleSaveEdit(true)} 
                        className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-1"
                    >
                        <RefreshCcw size={10} /> 保存并重成
                    </button>
                )}
              </div>
            </div>
          ) : (
             hasText && (
                 <div className="markdown-body">
                    {isUser ? (
                        <span className="whitespace-pre-wrap">{message.content}</span>
                    ) : (
                        <ReactMarkdown 
                            components={{
                                code({node, inline, className, children, ...props}: any) {
                                    return !inline ? (
                                        <pre className="bg-black/5 p-2 rounded my-2 overflow-x-auto text-xs font-mono">
                                            <code {...props}>{children}</code>
                                        </pre>
                                    ) : (
                                        <code className="bg-black/5 px-1 rounded text-xs font-mono" {...props}>
                                            {children}
                                        </code>
                                    )
                                }
                            }}
                        >
                            {message.content}
                        </ReactMarkdown>
                    )}
                 </div>
             )
          )}
        </div>

        {/* Hover/Context Actions */}
        {(showMenu) && (
           <div 
             ref={menuRef}
             className={`absolute z-10 ${isUser ? 'right-0 origin-top-right' : 'left-0 origin-top-left'} -bottom-10 bg-[#2b2b2b] text-white text-xs rounded shadow-lg py-1 px-1 flex items-center animate-fade-in`}
           >
              {!isTransfer && (
                  <>
                    <button 
                        onClick={() => { setIsEditing(true); setShowMenu(false); }}
                        className="px-3 py-1.5 hover:bg-white/10 rounded flex items-center gap-1.5 whitespace-nowrap"
                    >
                        <Edit2 size={12} /> 编辑
                    </button>
                    <div className="w-[1px] h-3 bg-white/20 mx-1"></div>
                  </>
              )}
              
              <button 
                onClick={() => { onDelete(); setShowMenu(false); }}
                className="px-3 py-1.5 hover:bg-white/10 rounded flex items-center gap-1.5 whitespace-nowrap text-red-400 hover:text-red-300"
              >
                <Trash2 size={12} /> 删除
              </button>
              
              {canRegenerate && (
                 <>
                    <div className="w-[1px] h-3 bg-white/20 mx-1"></div>
                    <button 
                        onClick={() => { onRegenerate && onRegenerate(); setShowMenu(false); }}
                        className="px-3 py-1.5 hover:bg-white/10 rounded flex items-center gap-1.5 whitespace-nowrap"
                    >
                        <RefreshCcw size={12} /> {isUser ? '重新生成' : '重试'}
                    </button>
                 </>
              )}
           </div>
        )}
      </div>

      {/* Avatar (Right - User) */}
      {isUser && (
        <img 
          src={userAvatar} 
          alt="Me" 
          className="w-10 h-10 rounded-md ml-3 object-cover shadow-sm bg-gray-200 flex-shrink-0" 
        />
      )}
    </div>
  );
};

export default MessageBubble;