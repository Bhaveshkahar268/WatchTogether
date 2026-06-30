import React, { useState } from 'react';
import { X, User, Lock, Smile, ArrowRight, Sparkles } from 'lucide-react';

const AVATAR_PRESETS = [
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Felix',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Aneka',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Buster',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Coco',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Garfield',
  'https://api.dicebear.com/7.x/adventurer/svg?seed=Cookie',
];

export default function AuthModal({ onClose, onAuthSuccess, serverUrl }) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState(AVATAR_PRESETS[0]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const endpoint = isLogin ? '/api/login' : '/api/register';
    const body = isLogin 
      ? { username, password }
      : { username, password, nickname, avatar: selectedAvatar };

    try {
      const response = await fetch(`${serverUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Something went wrong');
      }

      onAuthSuccess(data.token, data.user);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div className="glass-panel-heavy" style={styles.modal}>
        <button onClick={onClose} style={styles.closeBtn} title="Close">
          <X size={20} />
        </button>

        <div style={styles.header}>
          <Sparkles style={styles.sparkles} size={28} />
          <h2>{isLogin ? 'Welcome Back' : 'Create Account'}</h2>
          <p style={styles.subtitle}>
            {isLogin ? 'Sign in to access your watch rooms' : 'Create a profile to sync rooms & customize your account'}
          </p>
        </div>

        {error && <div style={styles.errorAlert}>{error}</div>}

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Username</label>
            <div style={styles.inputWrapper}>
              <User size={18} style={styles.inputIcon} />
              <input
                type="text"
                className="input-field"
                style={styles.input}
                placeholder="Enter username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Password</label>
            <div style={styles.inputWrapper}>
              <Lock size={18} style={styles.inputIcon} />
              <input
                type="password"
                className="input-field"
                style={styles.input}
                placeholder="Enter password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          {!isLogin && (
            <>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Display Nickname</label>
                <div style={styles.inputWrapper}>
                  <Smile size={18} style={styles.inputIcon} />
                  <input
                    type="text"
                    className="input-field"
                    style={styles.input}
                    placeholder="E.g., MovieMaster"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    required={!isLogin}
                  />
                </div>
              </div>

              <div style={styles.inputGroup}>
                <label style={styles.label}>Choose Avatar</label>
                <div className="avatar-list">
                  {AVATAR_PRESETS.map((avatar) => (
                    <div
                      key={avatar}
                      className={`avatar-option ${selectedAvatar === avatar ? 'selected' : ''}`}
                      onClick={() => setSelectedAvatar(avatar)}
                      style={{ backgroundImage: `url(${avatar})` }}
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          <button type="submit" className="btn btn-primary" style={styles.submitBtn} disabled={loading}>
            {loading ? 'Processing...' : isLogin ? 'Sign In' : 'Sign Up'}
            {!loading && <ArrowRight size={18} />}
          </button>
        </form>

        <div style={styles.footer}>
          <button onClick={() => setIsLogin(!isLogin)} style={styles.toggleBtn}>
            {isLogin ? "Don't have an account? Sign Up" : 'Already have an account? Sign In'}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    width: '100%',
    maxWidth: '440px',
    padding: '36px',
    position: 'relative',
    animation: 'float 6s ease-in-out infinite', // Keep custom float styling or subtle scale transitions
  },
  closeBtn: {
    position: 'absolute',
    top: '20px',
    right: '20px',
    background: 'none',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    padding: '4px',
    borderRadius: '50%',
    transition: 'var(--transition)',
  },
  header: {
    textAlign: 'center',
    marginBottom: '24px',
  },
  sparkles: {
    color: 'var(--secondary)',
    marginBottom: '12px',
  },
  subtitle: {
    fontSize: '0.85rem',
    color: 'var(--text-secondary)',
    marginTop: '6px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    fontSize: '0.85rem',
    fontWeight: '500',
    color: 'var(--text-secondary)',
  },
  inputWrapper: {
    position: 'relative',
  },
  inputIcon: {
    position: 'absolute',
    left: '14px',
    top: '50%',
    transform: 'translateY(-50%)',
    color: 'var(--text-muted)',
  },
  input: {
    paddingLeft: '44px',
  },
  submitBtn: {
    marginTop: '10px',
    width: '100%',
    padding: '12px',
  },
  errorAlert: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    border: '1px solid var(--danger)',
    color: '#fca5a5',
    padding: '10px 14px',
    borderRadius: 'var(--radius-sm)',
    fontSize: '0.85rem',
    marginBottom: '16px',
    textAlign: 'center',
  },
  footer: {
    marginTop: '20px',
    textAlign: 'center',
  },
  toggleBtn: {
    background: 'none',
    border: 'none',
    color: 'var(--primary)',
    fontSize: '0.85rem',
    cursor: 'pointer',
    transition: 'var(--transition)',
    fontWeight: '500',
  },
};
