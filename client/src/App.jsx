import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import { ArrowLeft, Share2, Shield, ShieldOff, Sparkles, Copy, Check, Users, Maximize, Minimize, MessageSquare, MessageSquareOff } from 'lucide-react';
import Dashboard from './components/Dashboard';
import AuthModal from './components/AuthModal';
import VideoPlayer from './components/VideoPlayer';
import WebcamGrid from './components/WebcamGrid';
import Chat from './components/Chat';

// In a real development setup, we point to our local backend server.
const SERVER_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:5001' 
  : window.location.protocol + '//' + window.location.hostname + ':5001';

export default function App() {
  const [user, setUser] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  
  // Room state
  const [room, setRoom] = useState(null); // { id, name, isPublic, hostSocketId }
  const [roomUsers, setRoomUsers] = useState([]);
  const [videoState, setVideoState] = useState({ url: '', currentTime: 0, playing: false, isScreenShare: false });
  const [messages, setMessages] = useState([]);
  const [socket, setSocket] = useState(null);
  const [copied, setCopied] = useState(false);

  // Screen share stream reference (passed from WebcamGrid to VideoPlayer)
  const [screenShareStream, setScreenShareStream] = useState(null);
  const [localScreenStream, setLocalScreenStream] = useState(null);
  const [isScreenShareActive, setIsScreenShareActive] = useState(false);

  // Floating emojis for reaction bursts on screen
  const [floatingEmojis, setFloatingEmojis] = useState([]);

  // Check URL parameters for direct room joining (e.g. watchtogether.com?room=abc)
  const [urlRoomId, setUrlRoomId] = useState(null);

  // Fullscreen and Sidebar Room Layout states
  const roomContainerRef = React.useRef(null);
  const [isFullscreenRoom, setIsFullscreenRoom] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [unreadMessages, setUnreadMessages] = useState(false);
  
  // Auto-hide controls in fullscreen room mode
  const [showControls, setShowControls] = useState(true);
  const userActivityTimeout = React.useRef(null);

  const resetUserActivityTimeout = () => {
    setShowControls(true);
    if (userActivityTimeout.current) {
      clearTimeout(userActivityTimeout.current);
    }
    if (isFullscreenRoom) {
      userActivityTimeout.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  };

  useEffect(() => {
    const handleMouseMove = () => {
      resetUserActivityTimeout();
    };

    if (isFullscreenRoom) {
      window.addEventListener('mousemove', handleMouseMove);
      resetUserActivityTimeout();
    } else {
      setShowControls(true);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (userActivityTimeout.current) {
        clearTimeout(userActivityTimeout.current);
      }
    };
  }, [isFullscreenRoom]);

  const showSidebarRef = React.useRef(showSidebar);
  useEffect(() => {
    showSidebarRef.current = showSidebar;
    if (showSidebar) {
      setUnreadMessages(false);
    }
  }, [showSidebar]);

  // Listen for native Fullscreen events to keep state synced
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreenRoom(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreenRoom = () => {
    const element = roomContainerRef.current;
    if (!element) return;

    if (!document.fullscreenElement) {
      element.requestFullscreen().catch(err => {
        console.error('Error entering fullscreen:', err);
      });
    } else {
      document.exitFullscreen();
    }
  };

  // 1. Initial authentication load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setUrlRoomId(roomParam);
    }

    const token = localStorage.getItem('wt_token');
    if (token) {
      fetch(`${SERVER_URL}/api/profile`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
        .then(res => {
          if (res.ok) return res.json();
          throw new Error('Invalid token');
        })
        .then(data => {
          setUser(data);
        })
        .catch(() => {
          // Token expired or server restarted, clear it
          localStorage.removeItem('wt_token');
          // Set standard guest profile
          createGuestProfile();
        });
    } else {
      createGuestProfile();
    }
  }, []);

  const createGuestProfile = () => {
    setUser({
      id: null,
      username: null,
      nickname: 'Guest-' + Math.floor(1000 + Math.random() * 9000),
      avatar: 'https://api.dicebear.com/7.x/adventurer/svg?seed=' + Math.random().toString(36).substring(7),
      favorites: [],
      history: []
    });
  };

  // If user loads a room link direct, join once user is loaded
  useEffect(() => {
    if (urlRoomId && user && !room) {
      // Clear URL parameter so they don't get forced back to it
      window.history.replaceState({}, document.title, window.location.pathname);
      handleJoinRoom({
        roomId: urlRoomId,
        nickname: user.nickname,
        avatar: user.avatar
      });
    }
  }, [urlRoomId, user]);

  const handleAuthSuccess = (token, authenticatedUser) => {
    localStorage.setItem('wt_token', token);
    setUser(authenticatedUser);
  };

  const handleLogout = () => {
    localStorage.removeItem('wt_token');
    createGuestProfile();
  };

  // 2. Room Join (Connect socket)
  const handleJoinRoom = ({ roomId, nickname, avatar, roomName, isPublic }) => {
    const newSocket = io(SERVER_URL);
    setSocket(newSocket);
    setMessages([]);

    newSocket.emit('join-room', {
      roomId,
      nickname,
      avatar,
      userId: user?.id,
      roomName,
      isPublic
    });

    setRoom({
      id: roomId,
      name: roomName || `${nickname}'s Watch Party`,
      isPublic: isPublic !== undefined ? isPublic : true,
      hostSocketId: null,
    });

    // Setup listeners
    newSocket.on('room-update', ({ roomId, roomName, isPublic, hostSocketId, users, videoState }) => {
      setRoom(prev => ({
        ...prev,
        name: roomName,
        isPublic,
        hostSocketId
      }));
      setRoomUsers(users);
      setVideoState(videoState);
    });

    newSocket.on('chat-message', (message) => {
      setMessages(prev => [...prev, message]);
      if (!showSidebarRef.current) {
        setUnreadMessages(true);
      }
    });

    // Handle high-fidelity reaction bursts
    newSocket.on('emoji-reaction', ({ emoji, sender }) => {
      const id = '_' + Math.random().toString(36).substr(2, 9);
      const randomLeft = Math.floor(20 + Math.random() * 60); // 20% to 80% screen width
      const randomDelay = Math.random() * 0.5;

      setFloatingEmojis(prev => [...prev, { id, emoji, left: `${randomLeft}%`, delay: `${randomDelay}s` }]);

      // Automatically clean up floating emojis after animation completes
      setTimeout(() => {
        setFloatingEmojis(prev => prev.filter(e => e.id !== id));
      }, 3000);
    });

    newSocket.on('video-state-update', (state) => {
      setVideoState(state);
    });
  };

  const handleLeaveRoom = () => {
    if (socket) {
      socket.disconnect();
      setSocket(null);
    }
    setRoom(null);
    setRoomUsers([]);
    setMessages([]);
    setScreenShareStream(null);
    if (localScreenStream) {
      localScreenStream.getTracks().forEach(t => t.stop());
      setLocalScreenStream(null);
    }
    setIsScreenShareActive(false);
  };

  const handleCopyLink = () => {
    const link = `${window.location.origin}${window.location.pathname}?room=${room.id}`;
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleUpdateRoomMeta = (updates) => {
    if (!socket || socket.id !== room.hostSocketId) return;
    socket.emit('update-room-meta', updates);
  };

  const isHost = socket && socket.id === room?.hostSocketId;

  return (
    <div>
      {/* 1. Dashboard View */}
      {!room ? (
        <Dashboard 
          user={user} 
          onAuthClick={() => setShowAuth(true)} 
          onLogout={handleLogout} 
          onJoinRoom={handleJoinRoom} 
          serverUrl={SERVER_URL}
          updateUser={setUser}
        />
      ) : (
        /* 2. Room View Layout */
        <div ref={roomContainerRef} style={styles.roomContainer} className={isFullscreenRoom ? 'fullscreen-active' : ''}>
          {/* Room Header bar */}
          <header className="glass-panel" style={{
            ...styles.roomHeader,
            opacity: isFullscreenRoom ? (showControls ? 1 : 0) : 1,
            pointerEvents: isFullscreenRoom ? (showControls ? 'auto' : 'none') : 'auto',
            transition: 'opacity 0.4s ease, transform 0.4s ease',
            transform: isFullscreenRoom && !showControls ? 'translateY(-20px)' : 'translateY(0)',
          }}>
            <button onClick={handleLeaveRoom} style={styles.backBtn}>
              <ArrowLeft size={18} /> Leave Room
            </button>

            <div style={styles.roomInfo}>
              <div style={styles.roomTitleSection}>
                {isHost ? (
                  <input
                    type="text"
                    value={room.name}
                    onChange={(e) => handleUpdateRoomMeta({ name: e.target.value })}
                    style={styles.roomNameInput}
                    title="Rename Watch Party"
                  />
                ) : (
                  <h2 style={styles.roomNameDisplay}>{room.name}</h2>
                )}
                
                <button 
                  onClick={() => isHost && handleUpdateRoomMeta({ isPublic: !room.isPublic })} 
                  style={isHost ? styles.privacyToggleHost : styles.privacyToggleViewer}
                  title={isHost ? "Toggle Privacy" : ""}
                >
                  {room.isPublic ? (
                    <span style={styles.badgeSuccessWrapper}>
                      <Shield size={12} /> Public
                    </span>
                  ) : (
                    <span style={styles.badgeDangerWrapper}>
                      <ShieldOff size={12} /> Private
                    </span>
                  )}
                </button>
              </div>
              <span style={styles.roomIdText}>Room ID: {room.id}</span>
            </div>

            <div style={styles.headerActions}>
              <button 
                onClick={() => setShowSidebar(!showSidebar)} 
                className={`btn ${unreadMessages && !showSidebar ? 'btn-accent glow-btn' : 'btn-secondary'}`} 
                style={{ 
                  ...styles.actionBtn, 
                  marginRight: '10px',
                  position: 'relative'
                }}
                title={showSidebar ? "Hide Chat" : "Show Chat"}
              >
                {showSidebar ? <MessageSquareOff size={16} /> : <MessageSquare size={16} />}
                {showSidebar ? 'Hide Chat' : 'Show Chat'}
                {unreadMessages && !showSidebar && (
                  <span className="pulse-dot" style={styles.notificationDot} />
                )}
              </button>

              <button 
                onClick={toggleFullscreenRoom} 
                className="btn btn-secondary" 
                style={{ ...styles.actionBtn, marginRight: '10px' }}
                title={isFullscreenRoom ? "Exit Full Screen" : "Room Full Screen"}
              >
                {isFullscreenRoom ? <Minimize size={16} /> : <Maximize size={16} />}
                {isFullscreenRoom ? 'Room Full Screen' : 'Room Full Screen'}
              </button>

              <button onClick={handleCopyLink} className="btn btn-secondary" style={styles.actionBtn}>
                {copied ? <Check size={16} style={{ color: 'var(--success)' }} /> : <Share2 size={16} />}
                {copied ? 'Copied!' : 'Copy Invite Link'}
              </button>
            </div>
          </header>

          {/* Main Stage Grid */}
          <div style={{
            ...styles.stageGrid,
            gridTemplateColumns: showSidebar && !isFullscreenRoom ? '1fr 360px' : '1fr',
            position: 'relative'
          }}>
            
            {/* Left Panel: Movie Player + Webcam Feeds */}
            <div style={{ 
              ...styles.playerStage, 
              height: isFullscreenRoom ? '100%' : 'calc(100vh - 70px)',
              padding: isFullscreenRoom ? '0' : '20px',
              gap: isFullscreenRoom ? '0' : '20px',
              overflow: isFullscreenRoom ? 'hidden' : 'auto',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
            }}>
              
              {/* Floating Emojis Burst Render Target */}
              <div style={{ ...styles.playerWrapper, height: isFullscreenRoom ? '100%' : 'auto' }}>
                <VideoPlayer
                  socket={socket}
                  roomId={room.id}
                  videoState={videoState}
                  isHost={isHost}
                  screenShareStream={screenShareStream}
                  showSidebar={showSidebar}
                  isFullscreenRoom={isFullscreenRoom}
                />
                
                {/* Floating Emojis Grid Overlay */}
                <div style={styles.floatingEmojisOverlay}>
                  {floatingEmojis.map((e) => (
                    <div
                      key={e.id}
                      className="floating-emoji"
                      style={{
                        position: 'absolute',
                        left: e.left,
                        bottom: '20px',
                        animationDelay: e.delay,
                      }}
                    >
                      {e.emoji}
                    </div>
                  ))}
                </div>
              </div>

              {/* Webcam mesh grids wrapper */}
              <div className={isFullscreenRoom ? 'webcam-fullscreen-container' : 'webcam-standard-wrapper'}>
                <WebcamGrid
                  socket={socket}
                  roomId={room.id}
                  user={user}
                  roomUsers={roomUsers}
                  hostSocketId={room.hostSocketId}
                  isScreenShareActive={videoState.isScreenShare}
                  onScreenShareStream={setScreenShareStream}
                  onScreenShareToggle={setIsScreenShareActive}
                  localScreenStream={localScreenStream}
                  setLocalScreenStream={setLocalScreenStream}
                  isFullscreenRoom={isFullscreenRoom}
                  showControls={showControls}
                />
              </div>
            </div>

            {/* Right Panel: Side Chat & Users directory */}
            {showSidebar && (
              <aside style={isFullscreenRoom ? styles.sidebarFullscreen : styles.sidebar} className="sidebar">
                <Chat
                  socket={socket}
                  user={user}
                  roomUsers={roomUsers}
                  messages={messages}
                />
              </aside>
            )}

          </div>
        </div>
      )}

      {/* Login modal overlay */}
      {showAuth && (
        <AuthModal 
          onClose={() => setShowAuth(false)} 
          onAuthSuccess={handleAuthSuccess} 
          serverUrl={SERVER_URL}
        />
      )}
    </div>
  );
}

const styles = {
  roomContainer: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    backgroundColor: '#05070c',
  },
  roomHeader: {
    height: '70px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 24px',
    borderRadius: '0',
    borderTop: 'none',
    borderLeft: 'none',
    borderRight: 'none',
    zIndex: 100,
    backgroundColor: 'rgba(10, 12, 22, 0.8)',
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '0.9rem',
    fontWeight: '500',
    transition: 'var(--transition)',
    padding: '6px 12px',
    borderRadius: 'var(--radius-sm)',
  },
  roomInfo: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
  roomTitleSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  roomNameInput: {
    background: 'transparent',
    border: 'none',
    borderBottom: '1px dashed var(--border-glass-light)',
    color: '#fff',
    fontFamily: 'Outfit, sans-serif',
    fontSize: '1.2rem',
    fontWeight: '700',
    textAlign: 'center',
    outline: 'none',
    padding: '2px 0',
  },
  roomNameDisplay: {
    fontSize: '1.2rem',
    color: '#fff',
    fontWeight: '700',
  },
  privacyToggleHost: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
  },
  privacyToggleViewer: {
    background: 'none',
    border: 'none',
  },
  badgeSuccessWrapper: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '0.7rem',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    color: '#6ee7b7',
    fontWeight: '600',
    border: '1px solid rgba(16, 185, 129, 0.25)',
  },
  badgeDangerWrapper: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '0.7rem',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    color: '#fca5a5',
    fontWeight: '600',
    border: '1px solid rgba(239, 68, 68, 0.25)',
  },
  roomIdText: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    marginTop: '2px',
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
  },
  actionBtn: {
    padding: '8px 16px',
    fontSize: '0.85rem',
  },
  stageGrid: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: '1fr 360px',
    overflow: 'hidden',
  },
  playerStage: {
    padding: '20px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  playerWrapper: {
    position: 'relative',
    borderRadius: 'var(--radius-md)',
    overflow: 'hidden',
  },
  floatingEmojisOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'none',
    zIndex: 999,
  },
  sidebar: {
    borderLeft: '1px solid var(--border-glass)',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: 'rgba(10, 12, 22, 0.4)',
  },
  sidebarFullscreen: {
    position: 'absolute',
    right: '20px',
    top: '20px',
    bottom: '20px',
    width: '320px',
    height: 'calc(100% - 40px)',
    zIndex: 1000,
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-glass-light)',
    backgroundColor: 'rgba(10, 12, 22, 0.85)',
    backdropFilter: 'blur(16px)',
    overflow: 'hidden',
  },
  notificationDot: {
    position: 'absolute',
    top: '-3px',
    right: '-3px',
    width: '10px',
    height: '10px',
    backgroundColor: 'var(--danger)',
    borderRadius: '50%',
    boxShadow: '0 0 8px var(--danger)',
    zIndex: 10,
  },
};
