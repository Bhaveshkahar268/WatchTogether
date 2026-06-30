import React, { useRef, useEffect, useState } from 'react';
import { Send, Smile, Users } from 'lucide-react';

const REACTION_EMOJIS = ['❤️', '😂', '😮', '😢', '🎉', '👍', '🔥', '👏'];

export default function Chat({
  socket,
  user,
  roomUsers,
  messages,
}) {
  const [msgInput, setMsgInput] = useState('');
  const chatEndRef = useRef(null);

  // Auto-scroll chat to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!msgInput.trim()) return;

    socket.emit('chat-message', {
      text: msgInput.trim(),
      sender: user?.nickname || 'Anonymous',
      avatar: user?.avatar || 'https://api.dicebear.com/7.x/adventurer/svg?seed=Felix',
    });

    setMsgInput('');
  };

  const handleSendReaction = (emoji) => {
    socket.emit('emoji-reaction', {
      emoji,
      sender: user?.nickname || 'Anonymous',
    });
  };

  return (
    <div className="glass-panel" style={styles.chatContainer}>
      {/* Participant List Summary Header */}
      <div style={styles.chatHeader}>
        <div style={styles.headerInfo}>
          <Users size={18} style={{ color: 'var(--primary)' }} />
          <h3>Chat & Activity</h3>
        </div>
        <span className="badge badge-primary">{roomUsers.length} online</span>
      </div>

      {/* Messages Window */}
      <div style={styles.messagesList}>
        {messages.map((msg) => {
          const isSystem = msg.sender === 'System';
          
          if (isSystem) {
            return (
              <div key={msg.id} style={styles.systemMsg}>
                <span style={styles.systemText}>{msg.text}</span>
              </div>
            );
          }

          return (
            <div key={msg.id} style={styles.chatMsg}>
              <img src={msg.avatar} alt="avatar" style={styles.msgAvatar} />
              <div style={styles.msgContent}>
                <div style={styles.msgMeta}>
                  <span style={styles.msgSender}>{msg.sender}</span>
                  <span style={styles.msgTime}>{msg.time}</span>
                </div>
                <p style={styles.msgText}>{msg.text}</p>
              </div>
            </div>
          );
        })}
        <div ref={chatEndRef} />
      </div>

      {/* Emoji Reactions Toolbar */}
      <div style={styles.reactionToolbar}>
        {REACTION_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            onClick={() => handleSendReaction(emoji)}
            style={styles.reactionBtn}
            title={`React with ${emoji}`}
          >
            {emoji}
          </button>
        ))}
      </div>

      {/* Send Message Input */}
      <form onSubmit={handleSendMessage} style={styles.inputForm}>
        <input
          type="text"
          className="input-field"
          placeholder="Send a message..."
          value={msgInput}
          onChange={(e) => setMsgInput(e.target.value)}
          style={styles.input}
        />
        <button type="submit" className="btn btn-primary btn-icon" style={styles.sendBtn}>
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}

const styles = {
  chatContainer: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  chatHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    borderBottom: '1px solid var(--border-glass)',
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
  },
  headerInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  messagesList: {
    flex: 1,
    padding: '20px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  chatMsg: {
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-start',
  },
  msgAvatar: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    backgroundColor: 'var(--bg-tertiary)',
    flexShrink: 0,
  },
  msgContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    padding: '8px 12px',
    borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.03)',
    maxWidth: '85%',
  },
  msgMeta: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
  },
  msgSender: {
    fontSize: '0.85rem',
    fontWeight: '600',
    color: '#e2e8f0',
  },
  msgTime: {
    fontSize: '0.7rem',
    color: 'var(--text-muted)',
  },
  msgText: {
    fontSize: '0.9rem',
    color: 'var(--text-primary)',
    wordBreak: 'break-word',
  },
  systemMsg: {
    display: 'flex',
    justifyContent: 'center',
    margin: '4px 0',
  },
  systemText: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
    fontStyle: 'italic',
    textAlign: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    padding: '4px 12px',
    borderRadius: '20px',
  },
  reactionToolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '8px 16px',
    borderTop: '1px solid var(--border-glass)',
    backgroundColor: 'rgba(0, 0, 0, 0.1)',
  },
  reactionBtn: {
    background: 'none',
    border: 'none',
    fontSize: '1.25rem',
    cursor: 'pointer',
    transition: 'transform 0.1s ease',
    padding: '4px',
  },
  inputForm: {
    display: 'flex',
    padding: '16px',
    borderTop: '1px solid var(--border-glass)',
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
    gap: '10px',
  },
  input: {
    flex: 1,
  },
  sendBtn: {
    flexShrink: 0,
    width: '42px',
    height: '42px',
  },
};
