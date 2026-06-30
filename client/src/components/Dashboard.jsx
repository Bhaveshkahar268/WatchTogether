import React, { useState, useEffect } from 'react';
import { Play, LogIn, User, Settings, Shield, ShieldOff, Plus, ArrowRight, RefreshCw, Star, Film } from 'lucide-react';

const AVATAR_PRESETS = [
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Felix',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Aneka',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Buster',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Coco',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Garfield',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Cookie',
];

export default function Dashboard({ 
  user, 
  onAuthClick, 
  onLogout, 
  onJoinRoom, 
  serverUrl, 
  updateUser 
}) {
  const [roomName, setRoomName] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [joinId, setJoinId] = useState('');
  const [publicRooms, setPublicRooms] = useState([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  
  // Local profile edits for guest or logged-in user
  const [editNickname, setEditNickname] = useState(user?.nickname || 'Guest-' + Math.floor(1000 + Math.random() * 9000));
  const [editAvatar, setEditAvatar] = useState(user?.avatar || AVATAR_PRESETS[0]);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  // Sync user values if they change (e.g. after login)
  useEffect(() => {
    if (user) {
      setEditNickname(user.nickname);
      setEditAvatar(user.avatar);
    }
  }, [user]);

  // Fetch public rooms
  const fetchPublicRooms = async () => {
    setLoadingRooms(true);
    try {
      const res = await fetch(`${serverUrl}/api/rooms`);
      if (res.ok) {
        const data = await res.json();
        setPublicRooms(data);
      }
    } catch (err) {
      console.error('Error fetching public rooms:', err);
    } finally {
      setLoadingRooms(false);
    }
  };

  useEffect(() => {
    fetchPublicRooms();
    const interval = setInterval(fetchPublicRooms, 8000);
    return () => clearInterval(interval);
  }, []);

  const handleCreateRoom = (e) => {
    e.preventDefault();
    const roomId = Math.random().toString(36).substring(2, 10);
    const finalNickname = editNickname.trim() || 'Anonymous';
    onJoinRoom({
      roomId,
      nickname: finalNickname,
      avatar: editAvatar,
      roomName: roomName.trim() || `${finalNickname}'s Party`,
      isPublic
    });
  };

  const handleJoinById = (e) => {
    e.preventDefault();
    if (!joinId.trim()) return;
    onJoinRoom({
      roomId: joinId.trim(),
      nickname: editNickname || 'Anonymous',
      avatar: editAvatar,
    });
  };

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    // If user is registered (has token)
    const token = localStorage.getItem('wt_token');
    if (token) {
      try {
        const res = await fetch(`${serverUrl}/api/profile`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ nickname: editNickname, avatar: editAvatar })
        });
        if (res.ok) {
          const updatedUser = await res.json();
          updateUser(updatedUser);
          setShowProfileSettings(false);
        }
      } catch (err) {
        console.error('Error saving profile:', err);
      }
    } else {
      // Just local update for Guest
      updateUser({
        ...user,
        nickname: editNickname,
        avatar: editAvatar
      });
      setShowProfileSettings(false);
    }
    setSavingProfile(false);
  };

  return (
    <div className="dashboard-container">
      {/* Top Header */}
      <header style={styles.header}>
        <div style={styles.logo}>
          <Film size={32} style={{ color: 'var(--primary)' }} />
          <h1 style={styles.logoText}>Watch<span>Together</span></h1>
        </div>
        
        <div style={styles.profileSection}>
          {user && user.username ? (
            <div style={styles.userProfileCard}>
              <img src={editAvatar} alt="avatar" style={styles.profileAvatar} onClick={() => setShowProfileSettings(true)} />
              <div style={styles.userInfo}>
                <span style={styles.userName}>{user.nickname}</span>
                <span style={styles.userRole}>Member</span>
              </div>
              <button onClick={() => setShowProfileSettings(!showProfileSettings)} style={styles.settingsBtn} title="Settings">
                <Settings size={18} />
              </button>
              <button onClick={onLogout} className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem' }}>
                Logout
              </button>
            </div>
          ) : (
            <div style={styles.guestProfileCard}>
              <img src={editAvatar} alt="avatar" style={styles.profileAvatar} onClick={() => setShowProfileSettings(true)} />
              <div style={styles.userInfo}>
                <span style={styles.userName}>{editNickname}</span>
                <span style={styles.userRole}>Guest Mode</span>
              </div>
              <button onClick={() => setShowProfileSettings(!showProfileSettings)} style={styles.settingsBtn} title="Customize Avatar">
                <Settings size={18} />
              </button>
              <button onClick={onAuthClick} className="btn btn-primary" style={{ padding: '8px 16px', fontSize: '0.85rem' }}>
                <LogIn size={14} /> Sign In
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Grid Options */}
      <main style={styles.mainGrid}>
        
        {/* Left Side: Create / Join Forms */}
        <div style={styles.formCol}>
          
          {/* Profile Settings Modal-like panel inside dashboard */}
          {showProfileSettings && (
            <div className="glass-panel" style={styles.settingsPanel}>
              <h3 style={styles.panelTitle}>Customize Profile</h3>
              
              <div style={styles.formGroup}>
                <label style={styles.label}>Display Nickname</label>
                <input 
                  type="text" 
                  className="input-field" 
                  value={editNickname} 
                  onChange={(e) => setEditNickname(e.target.value)}
                />
              </div>

              <div style={styles.formGroup}>
                <label style={styles.label}>Choose Avatar Character</label>
                <div className="avatar-list">
                  {AVATAR_PRESETS.map((av) => (
                    <div 
                      key={av} 
                      className={`avatar-option ${editAvatar === av ? 'selected' : ''}`}
                      onClick={() => setEditAvatar(av)}
                      style={{ backgroundImage: `url(${av})` }}
                    />
                  ))}
                </div>
              </div>

              <div style={styles.settingsActionRow}>
                <button onClick={handleSaveProfile} className="btn btn-primary" style={{ padding: '8px 16px' }} disabled={savingProfile}>
                  {savingProfile ? 'Saving...' : 'Save Profile'}
                </button>
                <button onClick={() => setShowProfileSettings(false)} className="btn btn-secondary" style={{ padding: '8px 16px' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Create Room Card */}
          <div className="glass-panel" style={styles.card}>
            <div style={styles.cardHeader}>
              <h3 style={styles.cardTitle}>Host a Watch Party</h3>
              <p style={styles.cardDesc}>Start a new room and stream films, TV series or share your screen.</p>
            </div>
            
            <form onSubmit={handleCreateRoom} style={styles.form}>
              <div style={styles.formGroup}>
                <label style={styles.label}>Room Name</label>
                <input 
                  type="text" 
                  className="input-field" 
                  placeholder="E.g., Friday Movie Night"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value)}
                />
              </div>

              <div style={styles.privacyRow}>
                <div style={styles.privacyOption} onClick={() => setIsPublic(true)}>
                  <input 
                    type="radio" 
                    id="public" 
                    name="privacy" 
                    checked={isPublic} 
                    onChange={() => setIsPublic(true)} 
                    style={styles.radioInput}
                  />
                  <div style={styles.radioLabelWrapper}>
                    <Shield size={16} style={{ color: 'var(--success)' }} />
                    <div>
                      <span style={styles.radioTitle}>Public Room</span>
                      <span style={styles.radioDesc}>Appears in the public rooms list.</span>
                    </div>
                  </div>
                </div>

                <div style={styles.privacyOption} onClick={() => setIsPublic(false)}>
                  <input 
                    type="radio" 
                    id="private" 
                    name="privacy" 
                    checked={!isPublic} 
                    onChange={() => setIsPublic(false)}
                    style={styles.radioInput}
                  />
                  <div style={styles.radioLabelWrapper}>
                    <ShieldOff size={16} style={{ color: 'var(--danger)' }} />
                    <div>
                      <span style={styles.radioTitle}>Private Room</span>
                      <span style={styles.radioDesc}>Access only via direct invite link.</span>
                    </div>
                  </div>
                </div>
              </div>

              <button type="submit" className="btn btn-primary" style={styles.actionBtn}>
                <Plus size={18} /> Host Party
              </button>
            </form>
          </div>

          {/* Join Room Card */}
          <div className="glass-panel" style={styles.card}>
            <div style={styles.cardHeader}>
              <h3 style={styles.cardTitle}>Join by Room ID</h3>
              <p style={styles.cardDesc}>Enter your friend's room ID or link to join instantly.</p>
            </div>
            
            <form onSubmit={handleJoinById} style={styles.formInline}>
              <input 
                type="text" 
                className="input-field" 
                placeholder="Enter Room ID"
                value={joinId}
                onChange={(e) => setJoinId(e.target.value)}
                required
              />
              <button type="submit" className="btn btn-accent" style={styles.joinBtn}>
                Join <ArrowRight size={16} />
              </button>
            </form>
          </div>

        </div>

        {/* Right Side: Public Rooms List */}
        <div style={styles.roomsCol}>
          <div style={styles.roomsHeader}>
            <div style={styles.roomsTitleContainer}>
              <h2 style={styles.sectionTitle}>Active Parties</h2>
              <span className="badge badge-primary">{publicRooms.length} Live</span>
            </div>
            <button onClick={fetchPublicRooms} className="btn btn-secondary btn-icon" style={{ width: '32px', height: '32px' }} title="Refresh list">
              <RefreshCw size={14} className={loadingRooms ? 'spin' : ''} style={loadingRooms ? styles.spin : {}} />
            </button>
          </div>

          <div style={styles.roomsList}>
            {publicRooms.length === 0 ? (
              <div className="glass-panel" style={styles.emptyRooms}>
                <Play size={36} style={styles.emptyIcon} />
                <h4>No active public rooms</h4>
                <p>Host your own room and invite friends, or toggle privacy to public to be seen here!</p>
              </div>
            ) : (
              publicRooms.map((room) => (
                <div key={room.id} className="glass-panel" style={styles.roomCard}>
                  <div style={styles.roomCardInfo}>
                    <h4 style={styles.roomCardName}>{room.name}</h4>
                    <div style={styles.roomCardMeta}>
                      <span style={styles.metaItem}>Room ID: {room.id}</span>
                      <span style={styles.dot}>•</span>
                      <span style={styles.metaItem}>{room.userCount} {room.userCount === 1 ? 'viewer' : 'viewers'}</span>
                    </div>
                    {room.currentVideoUrl && room.currentVideoUrl !== 'None' && (
                      <div style={styles.playingBadge}>
                        <Film size={12} />
                        <span style={styles.playingText} title={room.currentVideoUrl}>
                          Streaming: {room.currentVideoUrl.substring(0, 32)}...
                        </span>
                      </div>
                    )}
                  </div>
                  <button 
                    onClick={() => onJoinRoom({ roomId: room.id, nickname: editNickname, avatar: editAvatar })} 
                    className="btn btn-accent"
                    style={{ padding: '8px 14px', fontSize: '0.85rem' }}
                  >
                    Join
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

      </main>
    </div>
  );
}

const styles = {
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '40px',
    flexWrap: 'wrap',
    gap: '20px',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  logoText: {
    fontSize: '1.8rem',
    fontWeight: '800',
    background: 'linear-gradient(135deg, #fff 30%, var(--text-secondary) 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
  },
  profileSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  userProfileCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 16px 8px 8px',
    backgroundColor: 'rgba(25, 28, 51, 0.5)',
    border: '1px solid var(--border-glass)',
    borderRadius: '40px',
  },
  guestProfileCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px 16px 8px 8px',
    backgroundColor: 'rgba(25, 28, 51, 0.3)',
    border: '1px solid var(--border-glass)',
    borderRadius: '40px',
  },
  profileAvatar: {
    width: '38px',
    height: '38px',
    borderRadius: '50%',
    backgroundColor: 'var(--bg-tertiary)',
    cursor: 'pointer',
    transition: 'var(--transition)',
    border: '2px solid transparent',
  },
  userInfo: {
    display: 'flex',
    flexDirection: 'column',
  },
  userName: {
    fontSize: '0.9rem',
    fontWeight: '600',
  },
  userRole: {
    fontSize: '0.7rem',
    color: 'var(--text-secondary)',
  },
  settingsBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'var(--transition)',
    marginRight: '4px',
  },
  mainGrid: {
    display: 'grid',
    gridTemplateColumns: '550px 1fr',
    gap: '30px',
    alignItems: 'start',
  },
  formCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: '24px',
  },
  roomsCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
  },
  card: {
    padding: '28px',
  },
  cardHeader: {
    marginBottom: '20px',
  },
  cardTitle: {
    fontSize: '1.25rem',
    fontWeight: '600',
    marginBottom: '4px',
  },
  cardDesc: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    fontSize: '0.8rem',
    fontWeight: '500',
    color: 'var(--text-secondary)',
  },
  privacyRow: {
    display: 'flex',
    gap: '12px',
    margin: '4px 0',
  },
  privacyOption: {
    flex: 1,
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    padding: '12px',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    border: '1px solid var(--border-glass)',
    borderRadius: 'var(--radius-sm)',
    cursor: 'pointer',
    transition: 'var(--transition)',
  },
  radioInput: {
    marginTop: '3px',
    accentColor: 'var(--primary)',
  },
  radioLabelWrapper: {
    display: 'flex',
    gap: '6px',
  },
  radioTitle: {
    display: 'block',
    fontSize: '0.85rem',
    fontWeight: '600',
  },
  radioDesc: {
    display: 'block',
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    marginTop: '2px',
  },
  actionBtn: {
    width: '100%',
    padding: '12px',
    marginTop: '8px',
  },
  formInline: {
    display: 'flex',
    gap: '12px',
  },
  joinBtn: {
    flexShrink: 0,
    padding: '0 24px',
  },
  roomsHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  roomsTitleContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  sectionTitle: {
    fontSize: '1.4rem',
    fontWeight: '700',
  },
  roomsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  emptyRooms: {
    padding: '60px 40px',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '10px',
  },
  emptyIcon: {
    color: 'var(--text-muted)',
    opacity: 0.4,
  },
  roomCard: {
    padding: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    transition: 'var(--transition)',
  },
  roomCardInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    overflow: 'hidden',
  },
  roomCardName: {
    fontSize: '1.05rem',
    fontWeight: '600',
  },
  roomCardMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  metaItem: {
    fontSize: '0.8rem',
    color: 'var(--text-secondary)',
  },
  dot: {
    color: 'var(--text-muted)',
    fontSize: '0.8rem',
  },
  playingBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    background: 'rgba(99, 102, 241, 0.15)',
    border: '1px solid rgba(99, 102, 241, 0.25)',
    padding: '4px 8px',
    borderRadius: '4px',
    marginTop: '6px',
    width: 'fit-content',
    color: '#a5b4fc',
    fontSize: '0.75rem',
    overflow: 'hidden',
  },
  playingText: {
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },
  settingsPanel: {
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  panelTitle: {
    fontSize: '1.1rem',
    borderBottom: '1px solid var(--border-glass)',
    paddingBottom: '8px',
  },
  settingsActionRow: {
    display: 'flex',
    gap: '12px',
    marginTop: '8px',
  },
  spin: {
    animation: 'spin 1.5s linear infinite',
  },
};

// Add raw CSS keyframe animations for react styling support if needed, but standard css file covers it.
